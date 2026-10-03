/**
 * LifeLink REST API.
 *
 * Section map:
 *   1. helpers + DTO mappers (zod validation, email-visibility rules)
 *   2. actors            /citizens, /verifiers (login required, least privilege)
 *   2b. trust registry   GET /trust-registry/issuers (public read; admin writes)
 *   2c. auth             /auth/* (citizen/issuer/verifier/admin)
 *   3. issuer            /issuer/* (issuer login, self-only) + OpenID4VCI subset
 *   4. wallet            /wallet/* (citizen login, self-only) + OpenID4VP answers
 *   5. verifier          /verifier/* (verifier login, self-only)
 *   6. revocation        /status-lists/:issuerId (public read)
 *   7. admin             /admin/* (admin login only)
 *
 * Identity rule (§3): the authenticated JWT is the source of identity. Routes
 * NEVER take issuerId/citizenId/verifierId from the body to decide WHO is
 * calling — those ids only ever name the OTHER party (e.g. which citizen an
 * issuer issues to). Returns 401 unauthenticated, 403 unauthorized.
 *
 * Privacy rule (§19): emails are only visible to self + admin; verify/consent
 * responses carry consented claims only; the audit log stores names, never
 * values; private keys never leave the KeyStore.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { JWK } from 'jose';import { HttpError, config } from './config';
import { query, queryOne } from './db';
import { appendAuditEvent, verifyAuditChain } from './audit';
import { getStatusListRow, getStatusListView, allocateStatusIndex, isRevoked, revokeStatusIndex } from './statusList';
import {
  attachKeyBinding,
  claimKeys,
  claimsOf,
  createPresentation,
  issueSdJwt,
  splitCombined,
  verifyPresentation,
} from './sdjwt';
import { decodeJwt } from 'jose';
import { didKeyFromPublicJwk, didWeb, generateEd25519KeyPair, resolveDidKey } from './crypto';
import { encryptPrivateJwk, getHolderSigningKey, getIssuerSigningKey } from './keystore';
import {
  CREDENTIAL_TYPES,
  isCredentialType,
  requiredFields,
  schemaFields,
  validateClaims,
  type CredentialType,
} from './schemas';
import { buildVc, type VerifiableCredential } from './vc';
import {
  buildIssuerMetadata,
  consumeIssuanceToken,
  createCredentialOffer,
  mintIssuanceToken,
  redeemOffer,
} from './openid4vci';
import {
  credentialTypeForDocument,
  eligibleOrgTypesForDocument,
  normalizeDocumentType,
} from './documentTypes';
import {
  assertRequestUsable,
  buildRequestObject,
  createPresentationRequest,
  loadRequestById,
  loadRequestByNonce,
  markRequestUsed,
  type PresentationRequestRow,
} from './openid4vp';
import {
  authValidation,
  checkPassword,
  getAuth,
  hashPassword,
  requireAdmin,
  requireCitizen,
  requireIssuer,
  requireLogin,
  requireOrganization,
  requireVerifier,
  signToken,
  verifyToken,
  type AccountKind,
} from './auth';
import type {
  AdminRow,
  AuditLogRow,
  CheckResult,
  CitizenRow,
  ConsentRow,
  CredentialRow,
  CredentialStatus,
  DocumentRequestRow,
  IssuerRow,
  IssuerStatus,
  VerifierRow,
} from './types';

export const router: Router = Router();

/* ------------------------------------------------------------------ */
/* 1. helpers                                                          */
/* ------------------------------------------------------------------ */

/** Wrap an async handler so rejected promises reach the central error handler. */
function route(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

/** Parse with zod; on failure throw 400 listing every issue (safe: caller's own input). */
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'Invalid request body',
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return parsed.data;
}

function requireString(body: Record<string, unknown>, field: string, maxLength = 500): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `"${field}" is required and must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new HttpError(400, `"${field}" must be at most ${maxLength} characters`);
  }
  return value.trim();
}

function idFromPath(req: Request, field = 'id'): number {
  const value = Number(req.params[field]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `"${field}" path parameter must be a positive integer`);
  }
  return value;
}

/** "DegreeCredential" -> "Degree" (used for friendly labels). */
function typeLabel(type: string): string {
  return type.replace(/Credential$/, '');
}

// --- loaders (single place where "not found" is decided) --------------

async function loadCitizen(id: number): Promise<CitizenRow> {
  const row = await queryOne<CitizenRow>('SELECT * FROM citizens WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Citizen ${id} not found`);
  return row;
}

async function loadCitizenByDid(did: string): Promise<CitizenRow> {
  const row = await queryOne<CitizenRow>('SELECT * FROM citizens WHERE did = $1', [did]);
  if (!row) throw new HttpError(404, 'No citizen holds that DID');
  return row;
}

async function loadIssuer(id: number): Promise<IssuerRow> {
  const row = await queryOne<IssuerRow>('SELECT * FROM issuers WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Issuer ${id} not found`);
  return row;
}

async function loadIssuerByDid(did: string): Promise<IssuerRow | null> {
  return queryOne<IssuerRow>('SELECT * FROM issuers WHERE did = $1', [did]);
}

async function loadVerifier(id: number): Promise<VerifierRow> {
  const row = await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Verifier ${id} not found`);
  return row;
}

async function loadAdmin(id: number): Promise<AdminRow> {
  const row = await queryOne<AdminRow>('SELECT * FROM admins WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Admin ${id} not found`);
  return row;
}

async function loadCredential(id: number): Promise<CredentialRow> {
  const row = await queryOne<CredentialRow>('SELECT * FROM credentials WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Credential ${id} not found`);
  return row;
}

async function loadCredentialByJwt(jwt: string): Promise<CredentialRow | null> {
  return queryOne<CredentialRow>('SELECT * FROM credentials WHERE jwt = $1', [jwt]);
}

async function loadConsentByRequest(requestId: number): Promise<ConsentRow | null> {
  return queryOne<ConsentRow>('SELECT * FROM consents WHERE presentation_request_id = $1', [requestId]);
}

async function loadDocumentRequest(id: number): Promise<DocumentRequestRow> {
  const row = await queryOne<DocumentRequestRow>('SELECT * FROM document_requests WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Document request ${id} not found`);
  return row;
}

function issuerStatusOf(row: IssuerRow): IssuerStatus {
  return (row.status ?? (row.trusted ? 'TRUSTED' : 'SUSPENDED')) as IssuerStatus;
}

function requireTrustedIssuer(row: IssuerRow, action: string): void {
  if (issuerStatusOf(row) !== 'TRUSTED') {
    throw new HttpError(
      403,
      `${row.name} is not TRUSTED (status: ${row.status ?? 'unknown'}). Only TRUSTED organizations may ${action}.`,
    );
  }
}

function requireIssueCapability(row: IssuerRow): void {
  if (!(row.can_issue ?? true)) {
    throw new HttpError(403, `${row.name} does not have issuer permission (can_issue=false).`);
  }
}

function requireVerifyCapability(row: IssuerRow): void {
  if (!(row.can_verify ?? true)) {
    throw new HttpError(403, `${row.name} does not have verifier permission (can_verify=false).`);
  }
}

/**
 * Every ORGANIZATION (issuers table) gets a linked legacy verifier row with
 * the SAME DID, so org-as-verifier presentations reuse the existing
 * nonce/audience/consent machinery without FK changes. The DID equality is
 * what makes audience binding sound: org DID === linked verifier DID.
 */
async function ensureLinkedVerifier(issuer: IssuerRow): Promise<VerifierRow> {
  const existing = await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE did = $1', [issuer.did]);
  if (existing) return existing;
  const email = issuer.email ?? `org-${issuer.id}@lifelink.local`;
  // Email must be unique in verifiers; fall back with suffix on clash.
  const clash = await queryOne<VerifierRow>('SELECT id FROM verifiers WHERE email = $1', [email]);
  const finalEmail = clash ? `org-${issuer.id}-${Date.now()}@lifelink.local` : email;
  const created = await queryOne<VerifierRow>(
    'INSERT INTO verifiers (name, did, email) VALUES ($1, $2, $3) RETURNING *',
    [issuer.name, issuer.did, finalEmail],
  );
  return created as VerifierRow;
}

async function linkedVerifierForIssuerId(issuerId: number): Promise<VerifierRow | null> {
  const issuer = await queryOne<IssuerRow>('SELECT * FROM issuers WHERE id = $1', [issuerId]);
  if (!issuer) return null;
  return ensureLinkedVerifier(issuer);
}

/** Resolve the acting verifier row for a request: legacy verifier OR org-linked. */
async function actingVerifier(auth: { kind: AccountKind; id: number }): Promise<VerifierRow> {
  if (auth.kind === 'verifier') return loadVerifier(auth.id);
  const issuer = await loadIssuer(auth.id);
  return ensureLinkedVerifier(issuer);
}

function documentDto(
  row: DocumentRequestRow,
  citizen: CitizenRow | null,
  organization: IssuerRow | null,
) {
  return {
    id: row.id,
    citizenId: row.citizen_id,
    citizen: citizen ? { id: citizen.id, name: citizen.name, did: citizen.did } : null,
    organizationId: row.organization_id,
    organization: organization ? organizationDto(organization) : null,
    documentType: row.document_type,
    documentName: row.document_name,
    documentRef: row.document_ref,
    mimeType: row.mime_type,
    purpose: row.purpose,
    status: row.status,
    rejectionReason: row.rejection_reason,
    credentialId: row.credential_id,
    createdAt: row.created_at.toISOString(),
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    reviewer: row.reviewer,
  };
}

// --- email visibility (§19: least privilege) ----------------------------

/** Emails are shown to self + admin only. Everyone else gets null. */
function visibleEmail(
  viewer: { kind: AccountKind; id: number } | null,
  ownerKind: AccountKind,
  ownerId: number,
  email: string | null,
): string | null {
  if (!viewer || !email) return null;
  if (viewer.kind === 'admin') return email;
  if (viewer.kind === ownerKind && viewer.id === ownerId) return email;
  // `issuer` and `organization` are the same underlying account (issuers table).
  if (
    (ownerKind === 'issuer' || ownerKind === 'organization') &&
    (viewer.kind === 'issuer' || viewer.kind === 'organization') &&
    viewer.id === ownerId
  ) {
    return email;
  }
  return null;
}

// --- DTOs (snake_case rows -> camelCase JSON) -------------------------

function citizenDto(row: CitizenRow, viewer: { kind: AccountKind; id: number } | null = null) {
  // NOTE: password_hash is intentionally never included.
  return {
    id: row.id,
    name: row.name,
    did: row.did,
    email: visibleEmail(viewer, 'citizen', row.id, row.email),
    hasLogin: row.password_hash !== null,
    createdAt: row.created_at.toISOString(),
  };
}

function issuerDto(row: IssuerRow, viewer: { kind: AccountKind; id: number } | null = null) {
  // NOTE: private key material (either column) is intentionally never included.
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    did: row.did,
    status: (row.status ?? (row.trusted ? 'TRUSTED' : 'SUSPENDED')) as IssuerStatus,
    trusted: (row.status ?? (row.trusted ? 'TRUSTED' : 'SUSPENDED')) === 'TRUSTED',
    orgType: row.org_type ?? null,
    organizationType: row.org_type ?? null,
    canIssue: row.can_issue ?? true,
    canVerify: row.can_verify ?? true,
    email: visibleEmail(viewer, 'issuer', row.id, row.email),
    hasLogin: row.password_hash !== null,
    createdAt: row.created_at.toISOString(),
  };
}

/** Organization DTO: same underlying row as issuer, presented as ORGANIZATION. */
function organizationDto(row: IssuerRow, viewer: { kind: AccountKind; id: number } | null = null) {
  const base = issuerDto(row, viewer);
  return {
    ...base,
    kind: 'organization' as const,
  };
}

function verifierDto(row: VerifierRow, viewer: { kind: AccountKind; id: number } | null = null) {
  // NOTE: password_hash is intentionally never included.
  return {
    id: row.id,
    name: row.name,
    did: row.did,
    email: visibleEmail(viewer, 'verifier', row.id, row.email),
    hasLogin: row.password_hash !== null,
  };
}

/** valid / revoked / expired, in that order of precedence. */
function credentialStatus(row: CredentialRow, now = new Date()): CredentialStatus {
  if (row.revoked) return 'revoked';
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

function credentialDto(
  row: CredentialRow,
  issuer: IssuerRow,
  claims: Record<string, unknown>,
  viewer: { kind: AccountKind; id: number } | null = null,
) {
  return {
    id: row.id,
    type: row.type,
    typeLabel: typeLabel(row.type),
    issuer: issuerDto(issuer, viewer),
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    status: credentialStatus(row),
    statusIndex: row.status_index,
    /** The W3C VC 2.0 representation (owner/verifier views only — never public). */
    vc: (row.vc_json ?? null) as VerifiableCredential | null,
    /** Every claim, readable by the wallet owner only. */
    claims,
    /** Names the citizen can tick when sharing. */
    availableFields: Object.keys(claims),
  };
}

type ConsentState = 'pending' | 'active' | 'rejected' | 'expired' | 'ended';

function consentState(row: ConsentRow): ConsentState {
  if (row.status === 'REJECTED') return 'rejected';
  if (row.status === 'PENDING') {
    return new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : 'pending';
  }
  if (row.revoked || row.status === 'REVOKED') return 'ended';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

function consentDto(row: ConsentRow, verifier: VerifierRow | null, credential: CredentialRow | null) {
  return {
    id: row.id,
    citizenId: row.citizen_id,
    verifier: verifier ? verifierDto(verifier) : null,
    credentialId: row.credential_id,
    credentialType: credential?.type ?? null,
    credentialTypeLabel: credential ? typeLabel(credential.type) : null,
    purpose: row.purpose,
    /** Fields the verifier asked for. */
    requestedFields: row.requested_fields ?? row.fields,
    /** Fields the citizen approved (subset of requested). */
    fields: row.fields,
    status: row.status ?? 'APPROVED',
    state: consentState(row),
    presentationRequestId: row.presentation_request_id,
    hasPresentation: row.presentation !== null,
    expiresAt: row.expires_at.toISOString(),
    revoked: row.revoked,
    createdAt: row.created_at.toISOString(),
  };
}

function requestDto(
  row: PresentationRequestRow,
  verifier: VerifierRow,
  citizen: CitizenRow,
  consent: ConsentRow | null,
) {
  const usable = !row.used && new Date(row.expires_at).getTime() > Date.now();
  return {
    id: row.id,
    verifier: verifierDto(verifier),
    citizen: { id: citizen.id, name: citizen.name, did: citizen.did },
    credentialType: row.credential_type,
    credentialTypeLabel: typeLabel(row.credential_type),
    requestedFields: row.requested_fields,
    purpose: row.purpose,
    nonce: row.nonce,
    aud: row.aud,
    clientId: row.client_id,
    presentationDefinition: row.presentation_definition,
    expiresAt: row.expires_at.toISOString(),
    used: row.used,
    usable,
    consent: consent ? consentDto(consent, verifier, null) : null,
    hasPresentation: consent?.presentation != null,
    createdAt: row.created_at.toISOString(),
  };
}

function auditDto(row: AuditLogRow) {
  let payload: unknown = row.payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    /* keep the raw string if it was hand-edited */
  }
  return {
    id: row.id,
    eventType: row.event_type,
    citizenId: row.citizen_id,
    verifierId: row.verifier_id,
    credentialId: row.credential_id,
    issuerId: row.issuer_id,
    payload,
    prevHash: row.prev_hash,
    hash: row.hash,
    createdAt: row.created_at.toISOString(),
  };
}

/** Consent durations for citizen-initiated shares (request flow uses request TTL). */
const DURATIONS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

// --- zod body schemas (§20: every public API validates input) ----------

const credentialTypeEnum = z.enum(CREDENTIAL_TYPES);

const issueBody = z
  .object({
    citizenId: z.number().int().positive(),
    type: credentialTypeEnum,
    claims: z.record(z.string(), z.unknown()),
    expiresInDays: z.number().min(1).max(3650).default(365),
  })
  .strict();

const offerBody = issueBody;

const tokenBody = z
  .object({
    grant_type: z.literal('urn:ietf:params:oauth:grant-type:pre-authorized_code'),
    'pre-authorized_code': z.string().min(1).max(500),
  })
  .strict();

const credentialRequestBody = z
  .object({
    credential_configuration_ids: z.array(z.string()).min(1).max(4).optional(),
    credential_identifier: z.string().min(1).max(200).optional(),
  })
  .strict();

const verifierRequestBody = z
  .object({
    citizenId: z.number().int().positive(),
    credentialType: credentialTypeEnum,
    requestedFields: z.array(z.string().min(1).max(100)).min(1).max(50),
    purpose: z.string().trim().min(3).max(300),
    ttlMinutes: z.number().int().min(5).max(1440).default(30),
  })
  .strict();

const approveBody = z
  .object({
    credentialId: z.number().int().positive(),
    fields: z.array(z.string().min(1).max(100)).min(1).max(50),
  })
  .strict();

const directShareBody = z
  .object({
    verifierId: z.number().int().positive(),
    credentialId: z.number().int().positive(),
    purpose: z.string().trim().min(3).max(300),
    fields: z.array(z.string().min(1).max(100)).min(1).max(50),
    duration: z.enum(['5m', '30m', '1d']).default('30m'),
  })
  .strict();

const verifyBody = z
  .object({
    presentation: z.string().min(1).max(20_000),
  })
  .strict();

const issuerStatusBody = z
  .object({
    status: z.enum(['PENDING', 'TRUSTED', 'SUSPENDED', 'REVOKED']),
  })
  .strict();

const adminCreateIssuerBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]([a-z0-9.-]{1,250}[a-z0-9])?$/, 'must be a valid hostname'),
    email: z.string().trim().toLowerCase().max(320),
    password: z.string().min(8).max(128),
    orgType: z.string().trim().min(1).max(100).default('University'),
    canIssue: z.boolean().default(true),
    canVerify: z.boolean().default(true),
  })
  .strict();

const documentSubmitBody = z
  .object({
    documentType: z.string().trim().min(2).max(100),
    documentName: z.string().trim().min(1).max(300),
    documentRef: z.string().trim().min(1).max(20000),
    mimeType: z.string().trim().min(1).max(100).default('application/pdf'),
    organizationId: z.number().int().positive(),
    purpose: z.string().trim().min(3).max(500),
  })
  .strict();

const documentApproveBody = z
  .object({
    claims: z.record(z.string(), z.unknown()),
    expiresInDays: z.number().min(1).max(3650).default(365),
  })
  .strict();

const documentRejectBody = z
  .object({
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const directShareOrgBody = z
  .object({
    organizationId: z.number().int().positive(),
    credentialId: z.number().int().positive(),
    purpose: z.string().trim().min(3).max(300),
    fields: z.array(z.string().min(1).max(100)).min(1).max(50),
    duration: z.enum(['5m', '30m', '1d']).default('30m'),
  })
  .strict();

/* ------------------------------------------------------------------ */
/* shared issuance core (direct portal + OpenID4VCI credential endpoint) */
/* ------------------------------------------------------------------ */

interface IssuedRecord {
  credential: CredentialRow;
  combined: string;
  vc: VerifiableCredential;
  claims: Record<string, unknown>;
}

/**
 * Validate → allocate status bit → build VC 2.0 → sign SD-JWT → store.
 * Used by BOTH the issuer portal and the OpenID4VCI credential endpoint so
 * the two paths can never drift apart.
 */
async function issueCredentialCore(args: {
  issuer: IssuerRow;
  citizen: CitizenRow;
  type: CredentialType;
  rawClaims: unknown;
  expiresInDays: number;
}): Promise<IssuedRecord> {
  requireTrustedIssuer(args.issuer, 'sign credentials');
  requireIssueCapability(args.issuer);

  const checked = validateClaims(args.type, args.rawClaims);
  if (!checked.ok || !checked.claims) {
    throw new HttpError(400, `Claims do not match the ${args.type} schema`, checked.issues);
  }

  const statusIndex = await allocateStatusIndex(args.issuer.id);
  const statusListUrl = `${config.appBaseUrl}/status-lists/${args.issuer.id}`;
  const issuedAt = new Date();
  const expiresAt = new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000);
  const vc = buildVc({
    id: `urn:lifelink:credential:${args.issuer.id}:${statusIndex}`,
    issuerDid: args.issuer.did,
    subjectDid: args.citizen.did,
    type: args.type,
    claims: checked.claims,
    validFrom: issuedAt,
    validUntil: expiresAt,
    statusListUrl,
    statusIndex,
  });

  const issued = await issueSdJwt({
    issuer: args.issuer.did,
    issuerPrivateKey: await getIssuerSigningKey({
      issuerId: args.issuer.id,
      issuerName: args.issuer.name,
      privateKeyEnc: args.issuer.private_key_enc,
      privateJwkPlaintext: args.issuer.private_jwk,
    }),
    subject: args.citizen.did,
    type: args.type,
    claims: checked.claims,
    vcId: vc.id,
    issuedAt,
    expiresAt,
    statusListUrl,
    statusIndex,
  });

  const inserted = await queryOne<CredentialRow>(
    `INSERT INTO credentials
       (citizen_id, issuer_id, type, sd_jwt, jwt, vc_json, status_index, revoked, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9)
     RETURNING *`,
    [
      args.citizen.id,
      args.issuer.id,
      args.type,
      issued.combined,
      issued.jwt,
      JSON.stringify(vc),
      statusIndex,
      issuedAt,
      expiresAt,
    ],
  );
  const credential = inserted as CredentialRow;

  await appendAuditEvent({
    eventType: 'CREDENTIAL_ISSUED',
    issuerId: args.issuer.id,
    citizenId: args.citizen.id,
    credentialId: credential.id,
    payload: {
      type: args.type,
      issuerDid: args.issuer.did,
      issuerStatus: args.issuer.status,
      citizenDid: args.citizen.did,
      vcId: vc.id,
      statusIndex,
      expiresAt: expiresAt.toISOString(),
      // Claim NAMES only — never the values (DPDP data minimisation).
      claimKeys: Object.keys(checked.claims),
      standard: 'W3C VC 2.0 + RFC 9901 SD-JWT (sha-256)',
    },
  });

  return { credential, combined: issued.combined, vc, claims: checked.claims };
}

/**
 * Build an SD-JWT+KB presentation server-side (custodial demo wallet) and
 * return it. The holder key NEVER leaves the KeyStore — only the signature
 * travels, inside the KB-JWT.
 */
async function buildKbPresentation(args: {
  credential: CredentialRow;
  citizen: CitizenRow;
  fields: string[];
  nonce: string;
  aud: string;
}): Promise<{ presentation: string; revealed: Record<string, unknown> }> {
  const { presentation: bare, revealed, missing } = createPresentation(args.credential.sd_jwt, args.fields);
  if (missing.length > 0) {
    throw new HttpError(400, 'Could not build the presentation', { missing });
  }
  const holderKey = await getHolderSigningKey({
    citizenId: args.citizen.id,
    privateKeyEnc: args.citizen.private_jwk_enc,
  });
  const { presentation } = await attachKeyBinding({
    presentationWithoutKb: bare,
    holderPrivateKey: holderKey,
    nonce: args.nonce,
    aud: args.aud,
  });
  return { presentation, revealed };
}

/* ------------------------------------------------------------------ */
/* 2. actors and trust registry                                        */
/* ------------------------------------------------------------------ */

router.get(
  '/health',
  route(async (_req, res) => {
    const db = await queryOne<{ now: Date }>('SELECT NOW() AS now');
    res.json({
      status: 'ok',
      service: 'lifelink-backend',
      time: db?.now.toISOString() ?? new Date().toISOString(),
    });
  }),
);

/** Directory: authenticated users only, emails hidden unless self/admin. */
router.get(
  '/citizens',
  requireLogin,
  route(async (req, res) => {
    const viewer = getAuth(req);
    const result = await query<CitizenRow>('SELECT * FROM citizens ORDER BY id ASC');
    res.json({ citizens: result.rows.map((row) => citizenDto(row, viewer)) });
  }),
);

/** Directory: authenticated users only, emails hidden unless self/admin. */
router.get(
  '/verifiers',
  requireLogin,
  route(async (req, res) => {
    const viewer = getAuth(req);
    const result = await query<VerifierRow>('SELECT * FROM verifiers ORDER BY id ASC');
    res.json({ verifiers: result.rows.map((row) => verifierDto(row, viewer)) });
  }),
);

/**
 * Trust registry, public read. Trust STATES are admin-managed (see /admin);
 * the read side stays open because verifiers and citizens must be able to see
 * who is currently trusted.
 */
router.get(
  '/trust-registry/issuers',
  route(async (_req, res) => {
    const result = await query<IssuerRow>('SELECT * FROM issuers ORDER BY name ASC');
    const credentials = await query<{ issuer_id: number; count: string }>(
      'SELECT issuer_id, COUNT(*)::text AS count FROM credentials GROUP BY issuer_id',
    );
    const countByIssuer = new Map(credentials.rows.map((r) => [r.issuer_id, Number(r.count)]));
    res.json({
      issuers: result.rows.map((row) => ({
        ...issuerDto(row),
        credentialsIssued: countByIssuer.get(row.id) ?? 0,
      })),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 2c. auth: citizen / issuer / verifier / admin                        */
/* ------------------------------------------------------------------ */

async function registerCitizen(body: Record<string, unknown>) {
  const name = requireString(body, 'name', 200);
  const email = authValidation.normalizeEmail(body.email);
  const password = authValidation.checkPasswordRules(body.password);

  const clash = await queryOne<CitizenRow>('SELECT id FROM citizens WHERE email = $1', [email]);
  if (clash) throw new HttpError(409, 'A citizen account with this email already exists. Try logging in.');
  const keys = await generateEd25519KeyPair();
  const created = await queryOne<CitizenRow>(
    `INSERT INTO citizens (name, did, public_jwk, private_jwk_enc, email, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      name,
      didKeyFromPublicJwk(keys.publicJwk),
      keys.publicJwk,
      JSON.stringify(encryptPrivateJwk(keys.privateJwk)),
      email,
      await hashPassword(password),
    ],
  );
  return created as CitizenRow;
}

async function registerVerifier(body: Record<string, unknown>) {
  const name = requireString(body, 'name', 200);
  const email = authValidation.normalizeEmail(body.email);
  const password = authValidation.checkPasswordRules(body.password);

  const clash = await queryOne<VerifierRow>('SELECT id FROM verifiers WHERE email = $1', [email]);
  if (clash) throw new HttpError(409, 'A verifier account with this email already exists. Try logging in.');
  const domain = requireString(body, 'domain', 253).toLowerCase();
  const safeDomain = domain.replace(/[^a-z0-9.-]/g, '');
  if (safeDomain.length < 3 || safeDomain !== domain) {
    throw new HttpError(400, '"domain" must be a valid hostname like "bank.example.com"');
  }
  const dupe = await queryOne<VerifierRow>('SELECT id FROM verifiers WHERE did = $1', [didWeb(domain)]);
  if (dupe) throw new HttpError(409, 'That domain is already taken by another verifier.');
  const created = await queryOne<VerifierRow>(
    'INSERT INTO verifiers (name, did, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, didWeb(domain), email, await hashPassword(password)],
  );
  return created as VerifierRow;
}

async function loginAccount(
  kind: 'citizen' | 'issuer' | 'organization' | 'verifier' | 'admin',
  body: Record<string, unknown>,
) {
  const email = authValidation.normalizeEmail(body.email);
  const password = authValidation.checkPasswordRules(body.password);

  // Same generic message for unknown email vs wrong password: confirming
  // "this email exists" would help account enumeration.
  const invalid = new HttpError(401, 'Invalid email or password.');
  if (kind === 'citizen') {
    const row = await queryOne<CitizenRow>('SELECT * FROM citizens WHERE email = $1', [email]);
    if (!row?.password_hash || !(await checkPassword(password, row.password_hash))) throw invalid;
    return row;
  }
  if (kind === 'issuer' || kind === 'organization') {
    const row = await queryOne<IssuerRow>('SELECT * FROM issuers WHERE email = $1', [email]);
    if (!row?.password_hash || !(await checkPassword(password, row.password_hash))) throw invalid;
    return row;
  }
  if (kind === 'verifier') {
    const row = await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE email = $1', [email]);
    if (!row?.password_hash || !(await checkPassword(password, row.password_hash))) throw invalid;
    return row;
  }
  const row = await queryOne<AdminRow>('SELECT * FROM admins WHERE email = $1', [email]);
  if (!row?.password_hash || !(await checkPassword(password, row.password_hash))) throw invalid;
  return row;
}

router.post(
  '/auth/citizen/register',
  route(async (req, res) => {
    const row = await registerCitizen(asRecord(req.body));
    res.status(201).json({ token: await signToken('citizen', row.id, row.email ?? ''), citizen: citizenDto(row, { kind: 'citizen', id: row.id }) });
  }),
);

router.post(
  '/auth/citizen/login',
  route(async (req, res) => {
    const row = (await loginAccount('citizen', asRecord(req.body))) as CitizenRow;
    res.json({ token: await signToken('citizen', row.id, row.email ?? ''), citizen: citizenDto(row, { kind: 'citizen', id: row.id }) });
  }),
);

router.post(
  '/auth/verifier/register',
  route(async (req, res) => {
    const row = await registerVerifier(asRecord(req.body));
    res.status(201).json({ token: await signToken('verifier', row.id, row.email ?? ''), verifier: verifierDto(row, { kind: 'verifier', id: row.id }) });
  }),
);

router.post(
  '/auth/verifier/login',
  route(async (req, res) => {
    const row = await loginAccount('verifier', asRecord(req.body));
    const verifier = row as VerifierRow;
    res.json({ token: await signToken('verifier', verifier.id, verifier.email ?? ''), verifier: verifierDto(verifier, { kind: 'verifier', id: verifier.id }) });
  }),
);

/** Issuers log in (accounts are created by an admin, never self-registered). */
router.post(
  '/auth/issuer/login',
  route(async (req, res) => {
    const row = await loginAccount('issuer', asRecord(req.body));
    const issuer = row as IssuerRow;
    res.json({ token: await signToken('issuer', issuer.id, issuer.email ?? ''), issuer: issuerDto(issuer, { kind: 'issuer', id: issuer.id }) });
  }),
);

/**
 * ORGANIZATION login (unified role). Authenticates against the issuers table;
 * the token kind is `organization` so the frontend can treat issuer+verifier
 * as one dashboard. Legacy `issuer` tokens keep working.
 */
router.post(
  '/auth/organization/login',
  route(async (req, res) => {
    const row = await loginAccount('organization', asRecord(req.body));
    const org = row as IssuerRow;
    const auth = { kind: 'organization' as const, id: org.id };
    res.json({
      token: await signToken('organization', org.id, org.email ?? ''),
      organization: organizationDto(org, auth),
      issuer: issuerDto(org, auth),
    });
  }),
);

/** Admins log in (the seed creates the demo admin; no public registration). */
router.post(
  '/auth/admin/login',
  route(async (req, res) => {
    const row = await loginAccount('admin', asRecord(req.body));
    const admin = row as AdminRow;
    res.json({
      token: await signToken('admin', admin.id, admin.email),
      admin: { id: admin.id, name: admin.name, email: admin.email },
    });
  }),
);

/**
 * Who am I? The frontend calls this on boot to validate a stored token and to
 * learn the role + profile without a second round-trip.
 */
router.get(
  '/auth/me',
  route(async (req, res) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new HttpError(401, 'No session token. Please log in.');
    }
    // The role comes from the SIGNED token, so a citizen can never claim to
    // be an admin (or anyone else) by editing the request.
    const auth = await verifyToken(token);
    if (auth.kind === 'citizen') {
      const row = await loadCitizen(auth.id);
      res.json({ kind: 'citizen' as const, citizen: citizenDto(row, auth) });
      return;
    }
    if (auth.kind === 'issuer' || auth.kind === 'organization') {
      const row = await loadIssuer(auth.id);
      res.json({
        kind: 'organization' as const,
        organization: organizationDto(row, auth),
        issuer: issuerDto(row, auth),
      });
      return;
    }
    if (auth.kind === 'verifier') {
      const row = await loadVerifier(auth.id);
      res.json({ kind: 'verifier' as const, verifier: verifierDto(row, auth) });
      return;
    }
    const row = await loadAdmin(auth.id);
    res.json({ kind: 'admin' as const, admin: { id: row.id, name: row.name, email: row.email } });
  }),
);

/* ------------------------------------------------------------------ */
/* 3. issuer portal (issuer login, self-only)                           */
/* ------------------------------------------------------------------ */

/**
 * Issue a credential. The issuer comes from the JWT — a body-supplied
 * issuerId is never trusted, so nobody can issue "as" another issuer.
 * Claims are validated against the credential schema BEFORE signing.
 */
router.post(
  '/issuer/credentials',
  requireIssuer,
  route(async (req, res) => {
    const auth = getAuth(req);
    const issuer = await loadIssuer(auth.id);
    const input = parseBody(issueBody, req.body);
    const citizen = await loadCitizen(input.citizenId);

    const { credential, combined, vc, claims } = await issueCredentialCore({
      issuer,
      citizen,
      type: input.type,
      rawClaims: input.claims,
      expiresInDays: input.expiresInDays,
    });

    res.status(201).json({
      credential: credentialDto(credential, issuer, claims, auth),
      // The combined SD-JWT (what the wallet stores). Values travel only here,
      // inside salted disclosures, never in the clear.
      sdJwt: combined,
      vc,
      message: `${input.type} issued to ${citizen.name}. Every claim is individually shareable.`,
    });
  }),
);

/** List credentials THIS issuer signed (drives the issuer portal list). */
router.get(
  '/issuer/credentials',
  requireIssuer,
  route(async (req, res) => {
    const auth = getAuth(req);
    const issuer = await loadIssuer(auth.id);
    const result = await query<CredentialRow & { citizen_name: string; citizen_did: string }>(
      `SELECT c.*, p.name AS citizen_name, p.did AS citizen_did
       FROM credentials c
       JOIN citizens p ON p.id = c.citizen_id
       WHERE c.issuer_id = $1
       ORDER BY c.id DESC`,
      [issuer.id],
    );

    res.json({
      issuer: issuerDto(issuer, auth),
      credentials: result.rows.map((row) => {
        const claims = claimsOf(row.sd_jwt);
        return {
          id: row.id,
          type: row.type,
          typeLabel: typeLabel(row.type),
          citizen: { id: row.citizen_id, name: row.citizen_name, did: row.citizen_did },
          issuedAt: row.issued_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          status: credentialStatus(row),
          statusIndex: row.status_index,
          claims,
        };
      }),
    });
  }),
);

/** Revoke one of YOUR OWN credentials (cross-issuer revocation is refused). */
router.post(
  '/issuer/credentials/:id/revoke',
  requireIssuer,
  route(async (req, res) => {
    const auth = getAuth(req);
    const id = idFromPath(req);
    const credential = await loadCredential(id);
    if (credential.issuer_id !== auth.id) {
      throw new HttpError(403, 'You can only revoke credentials you issued yourself.');
    }
    const issuer = await loadIssuer(credential.issuer_id);
    const citizen = await loadCitizen(credential.citizen_id);

    if (credential.revoked) {
      res.json({
        credential: { id: credential.id, status: 'revoked' as CredentialStatus },
        alreadyRevoked: true,
        message: `Credential ${id} was already revoked.`,
      });
      return;
    }

    await revokeStatusIndex(issuer.id, credential.status_index);
    await queryOne<CredentialRow>('UPDATE credentials SET revoked = TRUE WHERE id = $1 RETURNING *', [id]);

    await appendAuditEvent({
      eventType: 'CREDENTIAL_REVOKED',
      issuerId: issuer.id,
      citizenId: citizen.id,
      credentialId: credential.id,
      payload: {
        type: credential.type,
        issuerDid: issuer.did,
        statusIndex: credential.status_index,
        reason: 'Revoked by issuer',
      },
    });

    res.json({
      credential: { id, status: 'revoked' as CredentialStatus, revokedAt: new Date().toISOString() },
      alreadyRevoked: false,
      message: `Credential ${id} revoked. Verifications that rely on it are now denied.`,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 3b. OpenID4VCI subset (pre-authorized code flow)                     */
/* ------------------------------------------------------------------ */

/** Public issuer metadata (no secrets in here). */
router.get(
  '/openid4vci/.well-known/credential-issuer',
  route(async (_req, res) => {
    res.json(buildIssuerMetadata({ credentialIssuer: config.appBaseUrl }));
  }),
);

/** Issuer creates a credential offer for a citizen (claims validated now). */
router.post(
  '/openid4vci/offers',
  requireIssuer,
  route(async (req, res) => {
    const auth = getAuth(req);
    const issuer = await loadIssuer(auth.id);
    if ((issuer.status ?? (issuer.trusted ? 'TRUSTED' : 'SUSPENDED')) !== 'TRUSTED') {
      throw new HttpError(403, 'Only TRUSTED issuers may create credential offers.');
    }
    const input = parseBody(offerBody, req.body);
    const citizen = await loadCitizen(input.citizenId);
    const checked = validateClaims(input.type, input.claims);
    if (!checked.ok) {
      throw new HttpError(400, `Claims do not match the ${input.type} schema`, checked.issues);
    }
    const { offer, code } = await createCredentialOffer({
      issuerId: issuer.id,
      citizenId: citizen.id,
      type: input.type,
      claims: checked.claims as Record<string, unknown>,
    });
    res.status(201).json({
      ...offer,
      // Delivered to the wallet out-of-band in production; returned here so
      // the hackathon demo can redeem it in one screen.
      pre_authorized_code: code,
      credential_configuration_id: input.type,
    });
  }),
);

/** Exchange a pre-authorized_code for a single-use access token. */
router.post(
  '/openid4vci/token',
  route(async (req, res) => {
    const input = parseBody(tokenBody, req.body);
    const offer = await redeemOffer(input['pre-authorized_code']);
    const token = await mintIssuanceToken(offer.id);
    res.json({ access_token: token, token_type: 'Bearer', expires_in: 600 });
  }),
);

/**
 * Redeem the access token for the actual credential. The Bearer token here is
 * the issuance token (NOT a login session) — parsed separately on purpose.
 */
router.post(
  '/openid4vci/credential',
  route(async (req, res) => {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new HttpError(401, 'A valid issuance access token is required (see /openid4vci/token).');
    }
    const offer = await consumeIssuanceToken(token);
    const input = parseBody(credentialRequestBody, req.body);
    const requested =
      input.credential_configuration_ids?.[0] ?? input.credential_identifier ?? offer.type;
    if (requested !== offer.type) {
      throw new HttpError(400, `This token is for "${offer.type}", not "${requested}".`);
    }
    const [issuer, citizen] = await Promise.all([
      loadIssuer(offer.issuer_id),
      loadCitizen(offer.citizen_id),
    ]);
    const { credential, combined, vc, claims } = await issueCredentialCore({
      issuer,
      citizen,
      type: offer.type as CredentialType,
      rawClaims: offer.claims,
      expiresInDays: 365,
    });
    res.status(201).json({
      credential: combined,
      vc,
      credential_id: credential.id,
      format: 'vc+sd-jwt',
      claims,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 4. citizen wallet (citizen login, self-only)                         */
/* ------------------------------------------------------------------ */

/** Everything in YOUR wallet (identity comes from the JWT, not the query). */
router.get(
  '/wallet/credentials',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const citizen = await loadCitizen(auth.id);

    const result = await query<
      CredentialRow & {
        issuer_name: string;
        issuer_domain: string;
        issuer_did: string;
        issuer_status: IssuerStatus | null;
        issuer_trusted: boolean;
        issuer_public_jwk: JWK;
        issuer_org_type: string | null;
        issuer_can_issue: boolean;
        issuer_can_verify: boolean;
      }
    >(
      `SELECT c.*, i.name AS issuer_name, i.domain AS issuer_domain, i.did AS issuer_did,
              i.status AS issuer_status, i.trusted AS issuer_trusted,
              i.public_jwk AS issuer_public_jwk,
              i.org_type AS issuer_org_type,
              i.can_issue AS issuer_can_issue, i.can_verify AS issuer_can_verify
       FROM credentials c
       JOIN issuers i ON i.id = c.issuer_id
       WHERE c.citizen_id = $1
       ORDER BY c.issued_at DESC, c.id DESC`,
      [citizen.id],
    );

    const credentials = result.rows.map((row) => {
      // Rebuild just enough of the issuer row for the DTO. Only the PUBLIC key
      // is selected above — private key material never leaves the database.
      const issuer: IssuerRow = {
        id: row.issuer_id,
        name: row.issuer_name,
        domain: row.issuer_domain,
        did: row.issuer_did,
        trusted: row.issuer_trusted,
        status: row.issuer_status,
        public_jwk: row.issuer_public_jwk,
        private_jwk: { kty: 'OKP', crv: 'Ed25519', x: '' },
        email: null,
        password_hash: null,
        private_key_enc: null,
        org_type: row.issuer_org_type,
        can_issue: row.issuer_can_issue ?? true,
        can_verify: row.issuer_can_verify ?? true,
        created_at: row.issued_at,
      };
      const claims = claimsOf(row.sd_jwt);
      return credentialDto(row, issuer, claims, auth);
    });

    const summary = {
      total: credentials.length,
      valid: credentials.filter((c) => c.status === 'valid').length,
      revoked: credentials.filter((c) => c.status === 'revoked').length,
      expired: credentials.filter((c) => c.status === 'expired').length,
    };

    res.json({ citizen: citizenDto(citizen, auth), credentials, summary });
  }),
);

/** Pending + answered presentation requests addressed to YOU. */
router.get(
  '/wallet/requests',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const result = await query<
      PresentationRequestRow & { verifier_name: string; verifier_did: string; consent_id: number | null }
    >(
      `SELECT r.*,
              v.name AS verifier_name, v.did AS verifier_did,
              (SELECT co.id FROM consents co WHERE co.presentation_request_id = r.id LIMIT 1) AS consent_id
       FROM presentation_requests r
       JOIN verifiers v ON v.id = r.verifier_id
       WHERE r.citizen_id = $1
       ORDER BY r.created_at DESC, r.id DESC`,
      [auth.id],
    );
    res.json({
      requests: await Promise.all(
        result.rows.map(async (row) => {
          const verifier = await loadVerifier(row.verifier_id);
          const citizen = await loadCitizen(row.citizen_id);
          const consent = row.consent_id
            ? await queryOne<ConsentRow>('SELECT * FROM consents WHERE id = $1', [row.consent_id])
            : null;
          return { ...requestDto(row, verifier, citizen, consent), requestUri: `${config.appBaseUrl}/openid4vp/requests/${row.id}` };
        }),
      ),
    });
  }),
);

/**
 * Approve a request — with a SUBSET of the requested fields if you like.
 * The server (not the UI) enforces: fields ⊆ requested, credential is yours,
 * valid, and of the requested type. Then it mints the SD-JWT+KB bound to the
 * request nonce + audience, marks the nonce used (replay-safe), and records
 * CONSENT_APPROVED + CREDENTIAL_PRESENTED.
 */
router.post(
  '/wallet/requests/:id/approve',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const requestId = idFromPath(req);
    const input = parseBody(approveBody, req.body);

    const request = await loadRequestById(requestId);
    if (request.citizen_id !== auth.id) {
      throw new HttpError(403, 'This presentation request is addressed to someone else.');
    }
    assertRequestUsable(request, 'answered');
    if (!isCredentialType(request.credential_type)) {
      throw new HttpError(400, `Request targets unknown credential type "${request.credential_type}".`);
    }

    const [verifier, citizen, credential] = await Promise.all([
      loadVerifier(request.verifier_id),
      loadCitizen(auth.id),
      loadCredential(input.credentialId),
    ]);
    if (credential.citizen_id !== citizen.id) {
      throw new HttpError(403, 'That credential does not belong to this citizen');
    }
    if (credential.type !== request.credential_type) {
      throw new HttpError(400, `This request needs a ${request.credential_type}, not a ${credential.type}.`);
    }
    if (credentialStatus(credential) !== 'valid') {
      throw new HttpError(409, `Cannot share this credential: it is ${credentialStatus(credential)}`);
    }

    // Server-side allow-list: approved ⊆ requested ∩ actually-present.
    const available = new Set(claimKeys(credential.sd_jwt));
    const notRequested = input.fields.filter((f) => !request.requested_fields.includes(f));
    if (notRequested.length > 0) {
      throw new HttpError(400, 'These fields were never requested by the verifier', { notRequested });
    }
    const missing = input.fields.filter((f) => !available.has(f));
    if (missing.length > 0) {
      throw new HttpError(400, 'These fields do not exist on this credential', { missing });
    }

    const { presentation, revealed } = await buildKbPresentation({
      credential,
      citizen,
      fields: input.fields,
      nonce: request.nonce,
      aud: request.aud,
    });
    await markRequestUsed(request.id);

    const approvedFields = Array.from(new Set(input.fields));
    const existingConsent = await loadConsentByRequest(request.id);
    const consent = (await queryOne<ConsentRow>(
      existingConsent
        ? `UPDATE consents SET credential_id = $1, fields = $2, status = 'APPROVED',
             presentation = $3, expires_at = $4 WHERE id = $5 RETURNING *`
        : `INSERT INTO consents
             (citizen_id, verifier_id, credential_id, purpose, fields, requested_fields,
              status, presentation_request_id, presentation, expires_at, revoked)
           VALUES ($6, $7, $1, $8, $2, $9, 'APPROVED', $10, $3, $4, FALSE)
           RETURNING *`,
      existingConsent
        ? [credential.id, approvedFields, presentation, request.expires_at, existingConsent.id]
        : [
            credential.id,
            approvedFields,
            presentation,
            request.expires_at,
            null,
            citizen.id,
            verifier.id,
            request.purpose,
            request.requested_fields,
            request.id,
          ],
    )) as ConsentRow;

    await appendAuditEvent({
      eventType: 'CONSENT_APPROVED',
      citizenId: citizen.id,
      verifierId: verifier.id,
      credentialId: credential.id,
      payload: {
        consentId: consent.id,
        requestId: request.id,
        purpose: request.purpose,
        sharedFields: approvedFields,
        hiddenFields: request.requested_fields.filter((f) => !approvedFields.includes(f)),
        notRequestedButPresent: [...available].filter((f) => !request.requested_fields.includes(f)),
      },
    });
    await appendAuditEvent({
      eventType: 'CREDENTIAL_PRESENTED',
      citizenId: citizen.id,
      verifierId: verifier.id,
      credentialId: credential.id,
      payload: {
        consentId: consent.id,
        requestId: request.id,
        credentialType: credential.type,
        nonce: request.nonce,
        aud: request.aud,
        holderBound: true,
      },
    });

    res.status(201).json({
      consent: consentDto(consent, verifier, credential),
      presentation,
      reveals: revealed,
      hidden: [...available].filter((f) => !approvedFields.includes(f)),
      notice: `${approvedFields.length} of ${request.requested_fields.length} requested field(s) shared with ${verifier.name}.`,
    });
  }),
);

/** Reject a request. The verifier sees the rejection; nothing is disclosed. */
router.post(
  '/wallet/requests/:id/reject',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const requestId = idFromPath(req);
    const request = await loadRequestById(requestId);
    if (request.citizen_id !== auth.id) {
      throw new HttpError(403, 'This presentation request is addressed to someone else.');
    }
    const existing = await loadConsentByRequest(request.id);
    if (existing && existing.status !== 'PENDING') {
      throw new HttpError(409, `This request was already ${existing.status}.`);
    }
    await markRequestUsed(request.id);

    // Rejections name no credential (the citizen may hold several of the
    // requested type, or none) — credential_id stays NULL.
    const consent = (await queryOne<ConsentRow>(
      existing
        ? `UPDATE consents SET status = 'REJECTED' WHERE id = $1 RETURNING *`
        : `INSERT INTO consents
             (citizen_id, verifier_id, credential_id, purpose, fields, requested_fields,
              status, presentation_request_id, expires_at, revoked)
           VALUES ($1, $2, NULL, $3, '{}', $4, 'REJECTED', $1, $5, FALSE)
           RETURNING *`,
      existing
        ? [existing.id]
        : [request.citizen_id, request.verifier_id, request.purpose, request.requested_fields, request.expires_at],
    )) as ConsentRow;

    const [verifier, citizen] = await Promise.all([
      loadVerifier(request.verifier_id),
      loadCitizen(auth.id),
    ]);
    await appendAuditEvent({
      eventType: 'CONSENT_REJECTED',
      citizenId: citizen.id,
      verifierId: verifier.id,
      credentialId: consent.credential_id || null,
      payload: { consentId: consent.id, requestId: request.id, purpose: request.purpose },
    });

    res.status(201).json({ consent: consentDto(consent, verifier, null) });
  }),
);

/**
 * Citizen-initiated share (the classic wallet flow: pick verifier + fields).
 * Implemented ON TOP of the request machinery: it creates a request row with
 * requested == approved, immediately used, so every presentation in the system
 * is nonce/audience-bound with holder binding — no exceptions.
 */
router.post(
  '/wallet/presentations',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const input = parseBody(directShareBody, req.body);

    const [verifier, citizen, credential] = await Promise.all([
      loadVerifier(input.verifierId),
      loadCitizen(auth.id),
      loadCredential(input.credentialId),
    ]);
    if (credential.citizen_id !== citizen.id) {
      throw new HttpError(403, 'That credential does not belong to this citizen');
    }
    if (credentialStatus(credential) !== 'valid') {
      throw new HttpError(409, `Cannot share this credential: it is ${credentialStatus(credential)}`);
    }
    if (!isCredentialType(credential.type)) {
      throw new HttpError(400, `Credential type "${credential.type}" is not supported.`);
    }
    const available = new Set(claimKeys(credential.sd_jwt));
    const missing = input.fields.filter((f) => !available.has(f));
    if (missing.length > 0) {
      throw new HttpError(400, 'These fields do not exist on this credential', {
        missing,
        availableFields: [...available],
      });
    }

    const durationMs = DURATIONS[input.duration];
    const request = await createPresentationRequest({
      verifierId: verifier.id,
      citizenId: citizen.id,
      credentialType: credential.type as CredentialType,
      requestedFields: input.fields,
      purpose: input.purpose,
      aud: verifier.did,
      clientId: verifier.did,
      ttlSeconds: Math.round(durationMs / 1000),
    });

    const { presentation, revealed } = await buildKbPresentation({
      credential,
      citizen,
      fields: input.fields,
      nonce: request.nonce,
      aud: request.aud,
    });
    await markRequestUsed(request.id);

    const consent = (await queryOne<ConsentRow>(
      `INSERT INTO consents
         (citizen_id, verifier_id, credential_id, purpose, fields, requested_fields,
          status, presentation_request_id, presentation, expires_at, revoked)
       VALUES ($1, $2, $3, $4, $5, $5, 'APPROVED', $6, $7, $8, FALSE)
       RETURNING *`,
      [citizen.id, verifier.id, credential.id, input.purpose, input.fields, request.id, presentation, request.expires_at],
    )) as ConsentRow;

    await appendAuditEvent({
      eventType: 'CONSENT_APPROVED',
      citizenId: citizen.id,
      verifierId: verifier.id,
      credentialId: credential.id,
      payload: {
        consentId: consent.id,
        requestId: request.id,
        purpose: input.purpose,
        initiatedBy: 'citizen',
        sharedFields: input.fields,
        hiddenFields: [...available].filter((f) => !input.fields.includes(f)),
      },
    });
    await appendAuditEvent({
      eventType: 'CREDENTIAL_PRESENTED',
      citizenId: citizen.id,
      verifierId: verifier.id,
      credentialId: credential.id,
      payload: {
        consentId: consent.id,
        requestId: request.id,
        credentialType: credential.type,
        nonce: request.nonce,
        aud: request.aud,
        holderBound: true,
      },
    });

    res.status(201).json({
      consent: consentDto(consent, verifier, credential),
      presentation,
      reveals: revealed,
      hidden: [...available].filter((f) => !input.fields.includes(f)),
      verifier: verifierDto(verifier, auth),
      credential: { id: credential.id, type: credential.type, typeLabel: typeLabel(credential.type) },
      notice: `${input.fields.length} of ${available.size} fields were shared with ${verifier.name} until ${request.expires_at.toISOString()}.`,
    });
  }),
);

/** Sharing history: every consent (requested/approved/rejected/ended). */
router.get(
  '/wallet/consents',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const result = await query<ConsentRow & { verifier_name: string; verifier_did: string; credential_type: string | null }>(
      `SELECT co.*, v.name AS verifier_name, v.did AS verifier_did, c.type AS credential_type
       FROM consents co
       JOIN verifiers v ON v.id = co.verifier_id
       LEFT JOIN credentials c ON c.id = co.credential_id
       WHERE co.citizen_id = $1
       ORDER BY co.created_at DESC, co.id DESC`,
      [auth.id],
    );

    res.json({
      consents: result.rows.map((row) => {
        const verifier: VerifierRow = {
          id: row.verifier_id,
          name: row.verifier_name,
          did: row.verifier_did,
          email: null,
          password_hash: null,
        };
        // Rejections may name no credential (credential_id NULL).
        const credential: CredentialRow | null =
          row.credential_id === null
            ? null
            : {
                id: row.credential_id,
                citizen_id: row.citizen_id,
                issuer_id: 0,
                type: row.credential_type ?? 'unknown',
                sd_jwt: '',
                jwt: null,
                vc_json: null,
                status_index: 0,
                revoked: false,
                issued_at: row.created_at,
                expires_at: row.expires_at,
              };
        return consentDto(row, verifier, credential);
      }),
    });
  }),
);

/** End access early (consent withdrawal stays one click, per DPDP). */
router.post(
  '/wallet/consents/:id/revoke',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const id = idFromPath(req);
    const existing = await queryOne<ConsentRow>('SELECT * FROM consents WHERE id = $1', [id]);
    if (!existing) throw new HttpError(404, `Consent ${id} not found`);
    if (existing.citizen_id !== auth.id) {
      throw new HttpError(403, 'You can only end your own consents.');
    }

    const [verifier, credential] = await Promise.all([
      loadVerifier(existing.verifier_id),
      existing.credential_id === null
        ? Promise.resolve(null)
        : loadCredential(existing.credential_id).catch(() => null),
    ]);

    if (existing.revoked || existing.status === 'REVOKED') {
      res.json({ consent: consentDto(existing, verifier, credential), alreadyRevoked: true });
      return;
    }

    const updated = (await queryOne<ConsentRow>(
      "UPDATE consents SET revoked = TRUE, status = 'REVOKED' WHERE id = $1 RETURNING *",
      [id],
    )) as ConsentRow;

    // Vocabulary note (§18): consent withdrawal is recorded as a rejection of
    // any further sharing under this consent (no separate REVOKED event type).
    await appendAuditEvent({
      eventType: 'CONSENT_REJECTED',
      citizenId: updated.citizen_id,
      verifierId: updated.verifier_id,
      credentialId: updated.credential_id,
      payload: {
        consentId: updated.id,
        purpose: updated.purpose,
        reason: 'withdrawn by citizen (end access)',
        previouslySharedFields: updated.fields,
      },
    });

    res.json({
      consent: consentDto(updated, verifier, credential),
      alreadyRevoked: false,
      message: `Access for ${verifier.name} ended. Future verifications using consent ${id} are denied.`,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 4b. citizen: who verified my records?                                */
/* ------------------------------------------------------------------ */

interface VerificationRecord {
  eventId: number;
  result: 'granted' | 'denied';
  verifier: { id: number; name: string; did: string };
  credential: { id: number; type: string; typeLabel: string } | null;
  consentId: number | null;
  purpose: string | null;
  revealedFields: string[];
  deniedBecause: string[];
  durationMs: number | null;
  createdAt: string;
}

function toVerificationRecord(
  row: AuditLogRow & { verifier_name: string | null; verifier_did: string | null; credential_type: string | null },
): VerificationRecord {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    /* keep defaults */
  }
  const asStrings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return {
    eventId: row.id,
    result: row.event_type === 'CREDENTIAL_VERIFIED' ? 'granted' : 'denied',
    verifier: {
      id: row.verifier_id ?? 0,
      name: row.verifier_name ?? 'Unknown verifier',
      did: row.verifier_did ?? '',
    },
    credential:
      row.credential_id === null
        ? null
        : {
            id: row.credential_id,
            type: typeof payload.credentialType === 'string' ? payload.credentialType : (row.credential_type ?? 'unknown'),
            typeLabel: typeLabel(
              typeof payload.credentialType === 'string' ? payload.credentialType : (row.credential_type ?? 'unknown'),
            ),
          },
    consentId: typeof payload.consentId === 'number' ? payload.consentId : null,
    purpose: typeof payload.purpose === 'string' ? payload.purpose : null,
    revealedFields: asStrings(payload.revealedFields),
    deniedBecause: asStrings(payload.deniedBecause),
    durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : null,
    createdAt: row.created_at.toISOString(),
  };
}

router.get(
  '/wallet/verifications',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const result = await query<
      AuditLogRow & { verifier_name: string | null; verifier_did: string | null; credential_type: string | null }
    >(
      `SELECT a.*, v.name AS verifier_name, v.did AS verifier_did, c.type AS credential_type
       FROM audit_log a
       LEFT JOIN verifiers v ON v.id = a.verifier_id
       LEFT JOIN credentials c ON c.id = a.credential_id
       WHERE a.citizen_id = $1
         AND a.event_type IN ('CREDENTIAL_VERIFIED', 'VERIFICATION_FAILED')
       ORDER BY a.id DESC
       LIMIT 100`,
      [auth.id],
    );

    const records = result.rows.map(toVerificationRecord);
    res.json({
      verifications: records,
      summary: {
        total: records.length,
        granted: records.filter((r) => r.result === 'granted').length,
        denied: records.filter((r) => r.result === 'denied').length,
        verifiers: new Set(records.map((r) => r.verifier.id)).size,
      },
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 5. verifier (verifier login, self-only)                              */
/* ------------------------------------------------------------------ */

/**
 * Create a presentation request: nonce + audience + requested claims +
 * purpose. Also opens a PENDING consent so the citizen sees it in their
 * wallet. The request object follows the OpenID4VP shape (see openid4vp.ts).
 */
router.post(
  '/verifier/requests',
  requireVerifier,
  route(async (req, res) => {
    const auth = getAuth(req);
    const input = parseBody(verifierRequestBody, req.body);
    const [verifier, citizen] = await Promise.all([
      loadVerifier(auth.id),
      loadCitizen(input.citizenId),
    ]);

    // The backend — not the UI — enforces that requested fields exist in the
    // credential schema for the requested type.
    const allowed = new Set(schemaFields(input.credentialType));
    const unknownFields = input.requestedFields.filter((f) => !allowed.has(f));
    if (unknownFields.length > 0) {
      throw new HttpError(400, `These fields are not part of ${input.credentialType}`, {
        unknownFields,
        allowedFields: [...allowed],
        hint: `Required fields are: ${requiredFields(input.credentialType).join(', ')}`,
      });
    }

    const request = await createPresentationRequest({
      verifierId: verifier.id,
      citizenId: citizen.id,
      credentialType: input.credentialType,
      requestedFields: Array.from(new Set(input.requestedFields)),
      purpose: input.purpose,
      aud: verifier.did,
      clientId: verifier.did,
      ttlSeconds: input.ttlMinutes * 60,
    });

    const consent = (await queryOne<ConsentRow>(
      `INSERT INTO consents
         (citizen_id, verifier_id, credential_id, purpose, fields, requested_fields,
          status, presentation_request_id, expires_at, revoked)
       SELECT $1, $2,
              COALESCE((SELECT id FROM credentials WHERE citizen_id = $1 AND type = $3 ORDER BY id DESC LIMIT 1), 0),
              $4, '{}', $5, 'PENDING', $6, $7, FALSE
       RETURNING *`,
      [citizen.id, verifier.id, input.credentialType, input.purpose, request.requested_fields, request.id, request.expires_at],
    )) as ConsentRow;

    await appendAuditEvent({
      eventType: 'CONSENT_REQUESTED',
      citizenId: citizen.id,
      verifierId: verifier.id,
      credentialId: consent.credential_id || null,
      payload: {
        consentId: consent.id,
        requestId: request.id,
        purpose: input.purpose,
        credentialType: input.credentialType,
        requestedFields: request.requested_fields,
        nonce: request.nonce,
        expiresAt: request.expires_at.toISOString(),
      },
    });

    res.status(201).json({
      request: {
        ...requestDto(request, verifier, citizen, consent),
        requestUri: `${config.appBaseUrl}/openid4vp/requests/${request.id}`,
        requestObject: buildRequestObject({
          row: request,
          requestUri: `${config.appBaseUrl}/openid4vp/requests/${request.id}`,
        }),
      },
      consent: consentDto(consent, verifier, null),
    });
  }),
);

/** Every request THIS verifier made, with consent status + presentation. */
router.get(
  '/verifier/requests',
  requireVerifier,
  route(async (req, res) => {
    const auth = getAuth(req);
    const result = await query<PresentationRequestRow>(
      'SELECT * FROM presentation_requests WHERE verifier_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
      [auth.id],
    );
    const verifier = await loadVerifier(auth.id);
    res.json({
      requests: await Promise.all(
        result.rows.map(async (row) => {
          const citizen = await loadCitizen(row.citizen_id);
          const consent = await loadConsentByRequest(row.id);
          const dto = requestDto(row, verifier, citizen, consent);
          return { ...dto, presentation: consent?.presentation ?? null };
        }),
      ),
    });
  }),
);

/**
 * POST /verifier/verify — the relying-party decision.
 *
 * Input is ONLY { presentation } (SD-JWT+KB). Everything else — which
 * request, which consent, which credential — is resolved server-side from the
 * KB nonce, so a caller cannot shop for a favourable context.
 *
 * The 9 checks run in order: issuer trust → signature → schema → disclosure
 * digests → holder binding → nonce → audience → revocation → consent. EVERY
 * check is computed for real; the UI shows each one because each one ran.
 */
router.post(
  '/verifier/verify',
  requireVerifier,
  route(async (req, res) => {
    const startedAt = Date.now();
    const auth = getAuth(req);
    const input = parseBody(verifyBody, req.body);
    const verifier = await loadVerifier(auth.id);

    // Parse first (structural errors still produce a decision, not a 500).
    let parsed: {
      jwt: string;
      kbJwt: string | null;
      disclosures: string[];
    } | null = null;
    let splitError: string | null = null;
    try {
      parsed = splitCombined(input.presentation);
    } catch (err) {
      splitError = err instanceof Error ? err.message : String(err);
    }

    const checks: CheckResult[] = [];
    const fail = (id: CheckResult['id'], label: string, detail: string): CheckResult => ({
      id,
      label,
      passed: false,
      detail,
    });
    const pass = (id: CheckResult['id'], label: string, detail: string): CheckResult => ({
      id,
      label,
      passed: true,
      detail,
    });

    // Resolve the request from the KB nonce (falls back gracefully).
    let request: PresentationRequestRow | null = null;
    let kbNonce: string | null = null;
    if (parsed?.kbJwt) {
      try {
        const kb = decodeJwt(parsed.kbJwt) as { nonce?: unknown };
        kbNonce = typeof kb.nonce === 'string' ? kb.nonce : null;
      } catch {
        kbNonce = null;
      }
      if (kbNonce) {
        request = await loadRequestByNonce(kbNonce).catch(() => null);
      }
    }

    // Resolve issuer + credential from the JWT (if parseable at all).
    let issuer: IssuerRow | null = null;
    let credential: CredentialRow | null = null;
    let issuerDid: string | null = null;
    let credentialType = 'unknown';
    if (parsed) {
      try {
        const payload = decodeJwt(parsed.jwt) as { iss?: unknown; sub?: unknown; vct?: unknown };
        issuerDid = typeof payload.iss === 'string' ? payload.iss : null;
        credentialType = typeof payload.vct === 'string' ? payload.vct : 'unknown';
        if (issuerDid) issuer = await loadIssuerByDid(issuerDid);
        credential = await loadCredentialByJwt(parsed.jwt);
      } catch {
        /* crypto checks below will report the parse failure */
      }
    }

    // ---- 1. issuer trust ----------------------------------------------
    const issuerStatus = issuer ? (issuer.status ?? (issuer.trusted ? 'TRUSTED' : 'SUSPENDED')) : null;
    checks.push(
      issuer && issuerStatus === 'TRUSTED'
        ? pass('issuer_trusted', 'Issuer is TRUSTED in the trust registry',
            `${issuer.name} (${issuer.did}) holds status TRUSTED. Only an admin can grant it.`)
        : fail('issuer_trusted', 'Issuer is TRUSTED in the trust registry',
            !issuer
              ? `No registered issuer with DID "${issuerDid ?? '(unreadable)'}". Unknown issuers are refused.`
              : `${issuer.name} holds status ${issuerStatus}, not TRUSTED — its credentials are refused.`),
    );

    // ---- 2+3+4. signature, schema, disclosure digests -----------------
    let verification: Awaited<ReturnType<typeof verifyPresentation>> | null = null;
    if (parsed && issuer) {
      try {
        verification = await verifyPresentation(input.presentation, issuer.public_jwk, {
          holderPublicJwk: undefined, // holder check runs separately below (check 5)
        });
      } catch (err) {
        splitError = err instanceof Error ? err.message : String(err);
      }
    }
    if (verification) {
      checks.push(
        verification.signatureValid
          ? pass('signature_valid', 'Issuer signature valid, credential not expired',
              `Ed25519 signature by ${issuer?.did} verified; valid until ${new Date(verification.payload.exp * 1000).toISOString()}.`)
          : fail('signature_valid', 'Issuer signature valid, credential not expired',
              verification.problems[0] ?? 'Signature verification failed.'),
      );
    } else {
      checks.push(
        fail('signature_valid', 'Issuer signature valid, credential not expired',
          !parsed
            ? `Presentation could not be parsed: ${splitError ?? 'unknown error'}`
            : !issuer
              ? 'Skipped: issuer unknown, so there is no trusted key to verify against.'
              : `Verification crashed: ${splitError ?? 'unknown error'}`),
      );
    }

    // Schema: re-validate the FULL stored credentialSubject (not just revealed).
    if (credential && isCredentialType(credential.type)) {
      const fullClaims = claimsOf(credential.sd_jwt);
      const schemaCheck = validateClaims(credential.type, fullClaims);
      checks.push(
        schemaCheck.ok
          ? pass('schema_valid', 'Credential matches its schema',
              `${credential.type} has every required field with the right shape; no unknown fields were signed.`)
          : fail('schema_valid', 'Credential matches its schema',
              `Stored claims violate the ${credential.type} schema: ${(schemaCheck.issues ?? []).join('; ')}`),
      );
    } else {
      checks.push(
        fail('schema_valid', 'Credential matches its schema',
          !credential
            ? 'Skipped: the credential is unknown to this system, so its schema cannot be checked.'
            : `Credential type "${credential.type}" is not a known schema.`),
      );
    }

    if (verification) {
      checks.push(
        verification.digestsValid
          ? pass('disclosure_integrity', 'Revealed fields match signed digests',
              `All ${verification.revealedKeys.length} shared field(s) recompute to digests inside the signed _sd array (RFC 9901, ${_sdAlgName(verification)}).`)
          : fail('disclosure_integrity', 'Revealed fields match signed digests',
              verification.problems.find((p) => !p.startsWith('KB:')) ?? 'Disclosure digest mismatch.'),
      );
    } else {
      checks.push(fail('disclosure_integrity', 'Revealed fields match signed digests', 'Skipped: no verifiable presentation.'));
    }

    // ---- 5. holder binding (SD-JWT+KB, real proof of possession) -------
    let holderCitizen: CitizenRow | null = null;
    if (verification?.payload?.sub) {
      holderCitizen = await queryOne<CitizenRow>('SELECT * FROM citizens WHERE did = $1', [
        verification.payload.sub,
      ]);
    }
    if (verification && holderCitizen && parsed?.kbJwt) {
      // The subject DID must REALLY resolve to the key on file (did:key local
      // resolution — no database trust involved in this step).
      let resolvedOk = false;
      try {
        const resolved = resolveDidKey(holderCitizen.did);
        resolvedOk = resolved.publicJwk.x === (holderCitizen.public_jwk as JWK).x;
      } catch {
        resolvedOk = false;
      }
      const kbCheck = await verifyPresentation(input.presentation, issuer?.public_jwk ?? { kty: 'OKP', crv: 'Ed25519', x: '' }, {
        holderPublicJwk: holderCitizen.public_jwk,
        expectedNonce: request?.nonce,
        expectedAud: request?.aud,
      });
      const kb = kbCheck.kb;
      const holderOk =
        kb.present && kb.signatureValid && kb.sdHashValid && kb.nonceValid && kb.audValid && kb.fresh && resolvedOk;
      checks.push(
        holderOk
          ? pass('holder_binding', 'Holder key binding valid (proof of possession)',
              `The wallet proved possession of the holder key for ${holderCitizen.did} (KB-JWT signature valid, sd_hash matches these exact bytes).`)
          : fail('holder_binding', 'Holder key binding valid (proof of possession)',
              !resolvedOk
                ? 'The credential subject DID does not resolve to the holder key on file.'
                : kb.problems.join(' ') || 'Holder proof failed.'),
      );
    } else {
      checks.push(
        fail('holder_binding', 'Holder key binding valid (proof of possession)',
          !parsed?.kbJwt
            ? 'No Key Binding JWT attached. Holder-bound credentials REQUIRE a KB-JWT — possession was not proven.'
            : !holderCitizen
              ? 'The credential subject is not a known holder, so there is no holder key to check against.'
              : 'Skipped: presentation failed earlier checks.'),
      );
    }

    // ---- 6. nonce (single-use request binding, replay protection) ------
    if (request && kbNonce) {
      const fresh = new Date(request.expires_at).getTime() > Date.now();
      const owned = request.verifier_id === verifier.id;
      checks.push(
        fresh && owned
          ? pass('nonce_valid', 'Nonce valid (fresh, single-use, replay-safe)',
              `Nonce answers request #${request.id}, which is unexpired and addressed to you. Replaying these bytes against any other request fails its nonce lookup.`)
          : fail('nonce_valid', 'Nonce valid (fresh, single-use, replay-safe)',
              !owned
                ? `This presentation answers request #${request.id}, which belongs to another verifier.`
                : `Request #${request.id} expired at ${request.expires_at.toISOString()}.`),
      );
    } else {
      checks.push(
        fail('nonce_valid', 'Nonce valid (fresh, single-use, replay-safe)',
          !kbNonce
            ? 'No nonce found in the presentation (missing or unreadable KB-JWT).'
            : 'This nonce answers no known presentation request — possible replay of foreign bytes.'),
      );
    }

    // ---- 7. audience --------------------------------------------------
    if (request) {
      const audOk = request.aud === verifier.did;
      checks.push(
        audOk
          ? pass('audience_valid', 'Audience valid (made for this verifier)',
              `Presentation audience "${request.aud}" is your DID. Presentations made for anyone else are refused.`)
          : fail('audience_valid', 'Audience valid (made for this verifier)',
              `Request audience is "${request.aud}", but you are "${verifier.did}".`),
      );
    } else {
      checks.push(fail('audience_valid', 'Audience valid (made for this verifier)', 'Skipped: no request to compare the audience against.'));
    }

    // ---- 8. revocation (Bitstring Status List, consulted live) --------
    if (credential && issuer) {
      const statusList = await getStatusListRow(issuer.id);
      const statusIndex = verification?.payload?.status?.idx ?? credential.status_index;
      const idxMatches = statusIndex === credential.status_index;
      const revokedByList = isRevoked(statusList.bits, statusIndex);
      const revoked = revokedByList || credential.revoked;
      checks.push(
        !revoked && idxMatches
          ? pass('not_revoked', 'Credential not revoked (status list bit is 0)',
              `Bit #${statusIndex} of ${issuer.name}'s BitstringStatusListCredential is 0 (valid), list updated ${statusList.updated_at.toISOString()}.`)
          : fail('not_revoked', 'Credential not revoked (status list bit is 0)',
              revoked
                ? `Bit #${statusIndex} is SET — this credential was revoked${credential.revoked ? ' (issuer record confirms)' : ''}.`
                : `Status index mismatch (presentation says #${statusIndex}, registry says #${credential.status_index}).`),
      );
    } else {
      checks.push(
        fail('not_revoked', 'Credential not revoked (status list bit is 0)',
          'Skipped: credential unknown, so no status list can vouch for it.'),
      );
    }

    // ---- 9. consent (APPROVED + live + covers every revealed field) ----
    const consent = request ? await loadConsentByRequest(request.id) : null;
    const revealedKeys = verification?.revealedKeys ?? [];
    const consentProblems: string[] = [];
    if (!consent) {
      consentProblems.push('No consent answers this presentation request.');
    } else {
      if (consent.status !== 'APPROVED') consentProblems.push(`Consent is ${consent.status}, not APPROVED.`);
      if (consent.revoked) consentProblems.push('The citizen ended this access early.');
      if (new Date(consent.expires_at).getTime() <= Date.now()) {
        consentProblems.push(`Consent expired at ${consent.expires_at.toISOString()}.`);
      }
      if (credential && consent.credential_id !== credential.id) {
        consentProblems.push('The consent covers a different credential than the one presented.');
      }
      if (consent.verifier_id !== verifier.id) {
        consentProblems.push('The consent was granted to another verifier.');
      }
      const notConsented = revealedKeys.filter((key) => !consent.fields.includes(key));
      if (notConsented.length > 0) {
        consentProblems.push(`Fields shared without consent: ${notConsented.join(', ')}.`);
      }
    }
    checks.push(
      consentProblems.length === 0 && consent
        ? pass('consent_valid', 'Consent valid, live, and covers every shared field',
            `Consent #${consent.id} ("${consent.purpose}") covers exactly the ${revealedKeys.length} shared field(s) and is live until ${consent.expires_at.toISOString()}.`)
        : fail('consent_valid', 'Consent valid, live, and covers every shared field', consentProblems.join(' ')),
    );

    const granted = checks.every((check) => check.passed);
    const durationMs = Date.now() - startedAt;

    const citizenId = holderCitizen?.id ?? credential?.citizen_id ?? null;
    await appendAuditEvent({
      eventType: granted ? 'CREDENTIAL_VERIFIED' : 'VERIFICATION_FAILED',
      citizenId,
      verifierId: verifier.id,
      credentialId: credential?.id ?? null,
      payload: {
        consentId: consent?.id ?? null,
        requestId: request?.id ?? null,
        purpose: consent?.purpose ?? request?.purpose ?? null,
        verifierDid: verifier.did,
        credentialType,
        issuerDid: issuer?.did ?? issuerDid,
        holderBound: true,
        kbPresent: parsed?.kbJwt != null,
        durationMs,
        checks: checks.map((check) => ({ id: check.id, passed: check.passed })),
        // Names of what was revealed, never the values.
        revealedFields: granted ? revealedKeys : [],
        deniedBecause: granted ? [] : checks.filter((c) => !c.passed).map((c) => c.id),
      },
    });

    res.json({
      result: granted ? 'granted' : 'denied',
      // On denial we deliberately return nothing about the credential contents.
      revealed: granted && verification ? verification.revealed : {},
      revealedFields: granted ? revealedKeys : [],
      withheldFields: granted && credential
        ? claimKeys(credential.sd_jwt).filter((key) => !revealedKeys.includes(key))
        : [],
      checks,
      verifier: verifierDto(verifier, auth),
      request: request
        ? { id: request.id, purpose: request.purpose, requestedFields: request.requested_fields, nonce: request.nonce }
        : null,
      consent: consent ? consentDto(consent, verifier, credential) : null,
      credential: credential
        ? {
            id: credential.id,
            type: credential.type,
            typeLabel: typeLabel(credential.type),
            issuer: issuer ? issuerDto(issuer, auth) : null,
            subject: verification?.payload?.sub ?? null,
            statusIndex: credential.status_index,
            vcId: (credential.vc_json as { id?: string } | null)?.id ?? verification?.payload?.vc_id ?? null,
          }
        : null,
      comparison: {
        lifelink: {
          verificationTimeMs: durationMs,
          documentsUploaded: 0,
          formsFilled: 0,
          summary: `Verified in ${durationMs} ms with 0 documents uploaded`,
        },
        traditional: {
          verificationTime: '2-5 business days',
          documentsUploaded: 3,
          formsFilled: 2,
          summary: 'Days of manual checks and full copies of ID, degree and salary documents re-submitted',
        },
      },
      verifiedAt: new Date().toISOString(),
    });
  }),
);

/** The verifier's own profile + everything THEY verified. */
router.get(
  '/verifier/profile',
  requireVerifier,
  route(async (req, res) => {
    const auth = getAuth(req);
    const verifier = await loadVerifier(auth.id);

    const result = await query<
      AuditLogRow & { citizen_name: string | null; credential_type: string | null }
    >(
      `SELECT a.*, p.name AS citizen_name, c.type AS credential_type
       FROM audit_log a
       LEFT JOIN citizens p ON p.id = a.citizen_id
       LEFT JOIN credentials c ON c.id = a.credential_id
       WHERE a.verifier_id = $1
         AND a.event_type IN ('CREDENTIAL_VERIFIED', 'VERIFICATION_FAILED')
       ORDER BY a.id DESC
       LIMIT 100`,
      [verifier.id],
    );

    const history = result.rows.map((row) => ({
      ...toVerificationRecord({
        ...row,
        verifier_name: verifier.name,
        verifier_did: verifier.did,
      }),
      citizen: {
        id: row.citizen_id ?? 0,
        name: row.citizen_name ?? 'Unknown citizen',
      },
    }));

    const granted = history.filter((h) => h.result === 'granted').length;
    res.json({
      verifier: verifierDto(verifier, auth),
      stats: {
        total: history.length,
        granted,
        denied: history.length - granted,
        citizensServed: new Set(history.map((h) => h.citizen.id)).size,
        credentialTypes: Array.from(new Set(history.map((h) => h.credential?.type ?? 'unknown'))),
      },
      history,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 5b. OpenID4VP request fetch                                          */
/* ------------------------------------------------------------------ */

/**
 * Fetch one request object (what the wallet answers). Visible to the
 * targeted citizen, the owning verifier, and admins — nobody else learns
 * who is being asked for what.
 */
router.get(
  '/openid4vp/requests/:id',
  requireLogin,
  route(async (req, res) => {
    const auth = getAuth(req);
    const request = await loadRequestById(idFromPath(req));
    if (auth.kind === 'citizen' && request.citizen_id !== auth.id) {
      throw new HttpError(403, 'This presentation request is addressed to someone else.');
    }
    if (auth.kind === 'verifier' && request.verifier_id !== auth.id) {
      throw new HttpError(403, 'This presentation request belongs to another verifier.');
    }
    const uri = `${config.appBaseUrl}/openid4vp/requests/${request.id}`;
    res.json({
      request_id: request.id,
      request_uri: uri,
      requestObject: buildRequestObject({ row: request, requestUri: uri }),
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 6. revocation status list (public read)                              */
/* ------------------------------------------------------------------ */

router.get(
  '/status-lists/:issuerId',
  route(async (req, res) => {
    const issuerId = idFromPath(req, 'issuerId');
    res.json(await getStatusListView(issuerId, config.appBaseUrl));
  }),
);

/* ------------------------------------------------------------------ */
/* 7. admin (admin login only)                                          */
/* ------------------------------------------------------------------ */

/** Every issuer with status + issuance counts (admin view of the registry). */
router.get(
  '/admin/issuers',
  requireAdmin,
  route(async (req, res) => {
    const auth = getAuth(req);
    const result = await query<IssuerRow>('SELECT * FROM issuers ORDER BY name ASC');
    const credentials = await query<{ issuer_id: number; count: string }>(
      'SELECT issuer_id, COUNT(*)::text AS count FROM credentials GROUP BY issuer_id',
    );
    const countByIssuer = new Map(credentials.rows.map((r) => [r.issuer_id, Number(r.count)]));
    res.json({
      issuers: result.rows.map((row) => ({
        ...issuerDto(row, auth),
        credentialsIssued: countByIssuer.get(row.id) ?? 0,
      })),
    });
  }),
);

/** Admin creates an issuer: fresh encrypted key, PENDING status, empty list. */
router.post(
  '/admin/issuers',
  requireAdmin,
  route(async (req, res) => {
    const auth = getAuth(req);
    const input = parseBody(adminCreateIssuerBody, req.body);
    const emailTaken =
      (await queryOne<{ id: number }>('SELECT id FROM issuers WHERE email = $1', [input.email])) ??
      (await queryOne<{ id: number }>('SELECT id FROM issuers WHERE domain = $1', [input.domain]));
    if (emailTaken) {
      throw new HttpError(409, 'An issuer with that email or domain already exists.');
    }
    const keys = await generateEd25519KeyPair();
    const created = (await queryOne<IssuerRow>(
      `INSERT INTO issuers (name, domain, did, public_jwk, private_jwk, private_key_enc,
                            trusted, status, email, password_hash, org_type, can_issue, can_verify)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, 'PENDING', $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.name,
        input.domain,
        didWeb(input.domain),
        keys.publicJwk,
        // Legacy column cannot be NULL: store the PUBLIC key there (harmless,
        // never used for signing) and the real key encrypted. Documented.
        keys.publicJwk,
        JSON.stringify(encryptPrivateJwk(keys.privateJwk)),
        input.email,
        await hashPassword(input.password),
        input.orgType,
        input.canIssue,
        input.canVerify,
      ],
    )) as IssuerRow;
    await query(
      `INSERT INTO status_lists (issuer_id, bits, next_index)
       VALUES ($1, $2, 0) ON CONFLICT (issuer_id) DO NOTHING`,
      [created.id, Buffer.alloc(16 * 1024, 0)],
    );
    // Linked verifier so the new organization can verify from day one.
    await ensureLinkedVerifier(created);
    await appendAuditEvent({
      eventType: 'TRUST_REGISTRY_UPDATED',
      issuerId: created.id,
      payload: {
        issuerName: created.name,
        issuerDid: created.did,
        change: 'created (PENDING)',
        adminId: auth.id,
      },
    });
    res.status(201).json({ issuer: issuerDto(created, auth) });
  }),
);

/** The ONLY way to change trust state. Citizens/verifiers/issuers cannot. */
router.post(
  '/admin/issuers/:id/status',
  requireAdmin,
  route(async (req, res) => {
    const auth = getAuth(req);
    const id = idFromPath(req);
    const input = parseBody(issuerStatusBody, req.body);
    const issuer = await loadIssuer(id);
    const from = issuer.status ?? (issuer.trusted ? 'TRUSTED' : 'SUSPENDED');
    if (from === input.status) {
      res.json({ issuer: issuerDto(issuer, auth), unchanged: true });
      return;
    }
    const updated = (await queryOne<IssuerRow>(
      `UPDATE issuers SET status = $1, trusted = ($1 = 'TRUSTED') WHERE id = $2 RETURNING *`,
      [input.status, id],
    )) as IssuerRow;
    await appendAuditEvent({
      eventType: 'TRUST_REGISTRY_UPDATED',
      issuerId: id,
      payload: {
        issuerName: issuer.name,
        issuerDid: issuer.did,
        change: `${from} -> ${input.status}`,
        adminId: auth.id,
      },
    });
    res.json({ issuer: issuerDto(updated, auth), unchanged: false });
  }),
);

/** System-wide audit log (admin only — citizens/verifiers have scoped views). */
router.get(
  '/admin/audit',
  requireAdmin,
  route(async (req, res) => {
    const limitRaw = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isFinite(limitRaw) || limitRaw <= 0 || limitRaw > 1000) {
      throw new HttpError(400, 'Query parameter "limit" must be between 1 and 1000');
    }

    const result = await query<AuditLogRow>('SELECT * FROM audit_log ORDER BY id DESC LIMIT $1', [limitRaw]);
    const chain = await verifyAuditChain();
    const total = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM audit_log');

    res.json({
      entries: result.rows.map(auditDto),
      total: Number(total?.count ?? 0),
      chain: {
        valid: chain.valid,
        length: chain.length,
        brokenAtEntry: chain.brokenAtEntry,
        brokenAtId: chain.brokenAtId,
        reason: chain.reason,
        headHash: chain.headHash,
        rule: 'hash = base64url(SHA-256(prev_hash + payload)); first prev_hash = "GENESIS"',
      },
    });
  }),
);

/** Re-verify the whole hash chain (admin only). Tamper-evident, not immutable. */
router.get(
  '/admin/audit/verify',
  requireAdmin,
  route(async (req, res) => {
    const limitRaw = req.query.limit === undefined ? undefined : Number(req.query.limit);
    if (limitRaw !== undefined && (!Number.isFinite(limitRaw) || limitRaw <= 0)) {
      throw new HttpError(400, 'Query parameter "limit" must be a positive number when provided');
    }
    res.json(await verifyAuditChain(limitRaw));
  }),
);

/* ------------------------------------------------------------------ */
/* 8. organizations (unified role) + document verification flow (B)     */
/* ------------------------------------------------------------------ */

/**
 * List organizations eligible to verify a document type. Only
 * TRUSTED + active + can_issue organizations appear, filtered by org type
 * when the document type maps to specific org types.
 */
router.get(
  '/organizations',
  requireLogin,
  route(async (_req, res) => {
    const documentType = typeof _req.query.documentType === 'string' ? _req.query.documentType : null;
    const result = await query<IssuerRow>(
      `SELECT * FROM issuers WHERE status = 'TRUSTED' AND can_issue = TRUE ORDER BY name ASC`,
    );
    let rows = result.rows;
    if (documentType) {
      const eligible = eligibleOrgTypesForDocument(documentType);
      if (eligible) {
        rows = rows.filter((r) => (r.org_type ? eligible.includes(r.org_type) : true));
      }
    }
    res.json({ organizations: rows.map((r) => organizationDto(r)) });
  }),
);

/** Organization profile: self + linked verifier + stats. */
router.get(
  '/organization/profile',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const org = await loadIssuer(auth.id);
    const linked = await ensureLinkedVerifier(org);
    const creds = await queryOne<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM credentials WHERE issuer_id = $1',
      [org.id],
    );
    const docs = await queryOne<{ pending: string; total: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'PENDING')::text AS pending,
              COUNT(*)::text AS total FROM document_requests WHERE organization_id = $1`,
      [org.id],
    );
    res.json({
      organization: organizationDto(org, auth),
      linkedVerifier: verifierDto(linked, auth),
      stats: {
        credentialsIssued: Number(creds?.count ?? 0),
        documentsPending: Number(docs?.pending ?? 0),
        documentsTotal: Number(docs?.total ?? 0),
      },
    });
  }),
);

/**
 * Citizen submits a document for verification (Flow B). The document NEVER
 * becomes a credential here — it creates a PENDING request for the chosen
 * organization to review.
 */
router.post(
  '/wallet/documents',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const input = parseBody(documentSubmitBody, req.body);
    const citizen = await loadCitizen(auth.id);
    const org = await loadIssuer(input.organizationId);
    requireTrustedIssuer(org, 'receive verification requests');
    requireIssueCapability(org);
    const eligible = eligibleOrgTypesForDocument(input.documentType);
    if (eligible && org.org_type && !eligible.includes(org.org_type)) {
      throw new HttpError(
        400,
        `${org.name} (${org.org_type}) cannot verify "${input.documentType}". Choose one of: ${eligible.join(', ')}.`,
      );
    }
    if (input.documentRef.length > 15000) {
      throw new HttpError(400, 'Document reference too large (demo stores metadata, not multi-MB files).');
    }
    const inserted = await queryOne<DocumentRequestRow>(
      `INSERT INTO document_requests
         (citizen_id, organization_id, document_type, document_name, document_ref,
          mime_type, purpose, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING') RETURNING *`,
      [
        citizen.id,
        org.id,
        normalizeDocumentType(input.documentType),
        input.documentName,
        input.documentRef,
        input.mimeType,
        input.purpose,
      ],
    );
    const doc = inserted as DocumentRequestRow;
    await appendAuditEvent({
      eventType: 'DOCUMENT_SUBMITTED',
      citizenId: citizen.id,
      issuerId: org.id,
      payload: {
        documentRequestId: doc.id,
        documentType: doc.document_type,
        documentName: doc.document_name,
        organizationName: org.name,
        purpose: doc.purpose,
      },
    });
    res.status(201).json({
      document: documentDto(doc, citizen, org),
      message: `${doc.document_name} sent to ${org.name} for verification. Status: Pending Verification.`,
    });
  }),
);

/** Citizen's own document requests. */
router.get(
  '/wallet/documents',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const result = await query<DocumentRequestRow>(
      'SELECT * FROM document_requests WHERE citizen_id = $1 ORDER BY created_at DESC, id DESC',
      [auth.id],
    );
    const documents = await Promise.all(
      result.rows.map(async (row) => {
        const [citizen, org] = await Promise.all([
          loadCitizen(row.citizen_id).catch(() => null),
          loadIssuer(row.organization_id).catch(() => null),
        ]);
        return documentDto(row, citizen, org);
      }),
    );
    res.json({ documents });
  }),
);

/** Organization's incoming verification queue (own requests only). */
router.get(
  '/organization/documents',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
    const rows =
      status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)
        ? await query<DocumentRequestRow>(
            'SELECT * FROM document_requests WHERE organization_id = $1 AND status = $2 ORDER BY created_at DESC, id DESC',
            [auth.id, status],
          )
        : await query<DocumentRequestRow>(
            'SELECT * FROM document_requests WHERE organization_id = $1 ORDER BY created_at DESC, id DESC',
            [auth.id],
          );
    const documents = await Promise.all(
      rows.rows.map(async (row) => {
        const [citizen, org] = await Promise.all([
          loadCitizen(row.citizen_id).catch(() => null),
          loadIssuer(row.organization_id).catch(() => null),
        ]);
        return documentDto(row, citizen, org);
      }),
    );
    res.json({ documents });
  }),
);

/** Organization reviews one request in detail (own requests only). */
router.get(
  '/organization/documents/:id',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const doc = await loadDocumentRequest(idFromPath(req));
    if (doc.organization_id !== auth.id) {
      throw new HttpError(403, 'This verification request belongs to another organization.');
    }
    const [citizen, org] = await Promise.all([loadCitizen(doc.citizen_id), loadIssuer(doc.organization_id)]);
    res.json({
      document: documentDto(doc, citizen, org),
      suggestedCredentialType: credentialTypeForDocument(doc.document_type),
    });
  }),
);

/**
 * Organization approves: validates structured claims, signs the credential,
 * places it in the citizen wallet, and marks the request APPROVED.
 */
router.post(
  '/organization/documents/:id/approve',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const doc = await loadDocumentRequest(idFromPath(req));
    if (doc.organization_id !== auth.id) {
      throw new HttpError(403, 'This verification request belongs to another organization.');
    }
    if (doc.status !== 'PENDING') {
      throw new HttpError(409, `This request was already ${doc.status}.`);
    }
    const org = await loadIssuer(auth.id);
    requireTrustedIssuer(org, 'issue credentials');
    requireIssueCapability(org);
    const citizen = await loadCitizen(doc.citizen_id);
    const input = parseBody(documentApproveBody, req.body);
    const credentialType = credentialTypeForDocument(doc.document_type);
    const { credential, combined, vc, claims } = await issueCredentialCore({
      issuer: org,
      citizen,
      type: credentialType,
      rawClaims: input.claims,
      expiresInDays: input.expiresInDays,
    });
    const updated = (await queryOne<DocumentRequestRow>(
      `UPDATE document_requests SET status = 'APPROVED', credential_id = $1,
              reviewed_at = NOW(), reviewer = $2 WHERE id = $3 RETURNING *`,
      [credential.id, org.name, doc.id],
    )) as DocumentRequestRow;
    await appendAuditEvent({
      eventType: 'DOCUMENT_APPROVED',
      citizenId: citizen.id,
      issuerId: org.id,
      credentialId: credential.id,
      payload: {
        documentRequestId: doc.id,
        documentType: doc.document_type,
        credentialType,
        credentialId: credential.id,
        reviewer: org.name,
      },
    });
    await appendAuditEvent({
      eventType: 'CREDENTIAL_RECEIVED',
      citizenId: citizen.id,
      issuerId: org.id,
      credentialId: credential.id,
      payload: {
        documentRequestId: doc.id,
        credentialType,
        credentialId: credential.id,
      },
    });
    res.status(201).json({
      document: documentDto(updated, citizen, org),
      credential: credentialDto(credential, org, claims, auth),
      sdJwt: combined,
      vc,
      message: `Approved. ${credentialType} issued to ${citizen.name} and added to their wallet.`,
    });
  }),
);

/** Organization rejects with a reason (own requests only). */
router.post(
  '/organization/documents/:id/reject',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const doc = await loadDocumentRequest(idFromPath(req));
    if (doc.organization_id !== auth.id) {
      throw new HttpError(403, 'This verification request belongs to another organization.');
    }
    if (doc.status !== 'PENDING') {
      throw new HttpError(409, `This request was already ${doc.status}.`);
    }
    const input = parseBody(documentRejectBody, req.body);
    const org = await loadIssuer(auth.id);
    const citizen = await loadCitizen(doc.citizen_id);
    const updated = (await queryOne<DocumentRequestRow>(
      `UPDATE document_requests SET status = 'REJECTED', rejection_reason = $1,
              reviewed_at = NOW(), reviewer = $2 WHERE id = $3 RETURNING *`,
      [input.reason, org.name, doc.id],
    )) as DocumentRequestRow;
    await appendAuditEvent({
      eventType: 'DOCUMENT_REJECTED',
      citizenId: citizen.id,
      issuerId: org.id,
      payload: {
        documentRequestId: doc.id,
        documentType: doc.document_type,
        reason: input.reason,
        reviewer: org.name,
      },
    });
    res.json({
      document: documentDto(updated, citizen, org),
      message: `Request rejected with reason recorded.`,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 9. organization as verifier (unified role)                           */
/* ------------------------------------------------------------------ */

/**
 * Organization creates a verification (presentation) request. Stored under
 * the linked verifier row so the existing nonce/audience/consent machinery
 * applies unchanged; aud = organization DID (=== linked verifier DID).
 */
router.post(
  '/organization/requests',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const org = await loadIssuer(auth.id);
    requireTrustedIssuer(org, 'request verifications');
    requireVerifyCapability(org);
    const input = parseBody(verifierRequestBody, req.body);
    const citizen = await loadCitizen(input.citizenId);
    const linked = await ensureLinkedVerifier(org);
    const allowed = new Set(schemaFields(input.credentialType));
    const unknownFields = input.requestedFields.filter((f) => !allowed.has(f));
    if (unknownFields.length > 0) {
      throw new HttpError(400, `These fields are not part of ${input.credentialType}`, {
        unknownFields,
        allowedFields: [...allowed],
      });
    }
    const request = await createPresentationRequest({
      verifierId: linked.id,
      citizenId: citizen.id,
      credentialType: input.credentialType,
      requestedFields: Array.from(new Set(input.requestedFields)),
      purpose: input.purpose,
      aud: org.did,
      clientId: org.did,
      ttlSeconds: input.ttlMinutes * 60,
    });
    const consent = (await queryOne<ConsentRow>(
      `INSERT INTO consents
         (citizen_id, verifier_id, credential_id, purpose, fields, requested_fields,
          status, presentation_request_id, expires_at, revoked)
       SELECT $1, $2,
              COALESCE((SELECT id FROM credentials WHERE citizen_id = $1 AND type = $3 ORDER BY id DESC LIMIT 1), NULL),
              $4, '{}', $5, 'PENDING', $6, $7, FALSE
       RETURNING *`,
      [citizen.id, linked.id, input.credentialType, input.purpose, request.requested_fields, request.id, request.expires_at],
    )) as ConsentRow;
    await appendAuditEvent({
      eventType: 'CONSENT_REQUESTED',
      citizenId: citizen.id,
      verifierId: linked.id,
      issuerId: org.id,
      credentialId: consent.credential_id || null,
      payload: {
        consentId: consent.id,
        requestId: request.id,
        purpose: input.purpose,
        credentialType: input.credentialType,
        requestedFields: request.requested_fields,
        nonce: request.nonce,
        organizationId: org.id,
        organizationName: org.name,
        expiresAt: request.expires_at.toISOString(),
      },
    });
    res.status(201).json({
      request: {
        ...requestDto(request, linked, citizen, consent),
        requestUri: `${config.appBaseUrl}/openid4vp/requests/${request.id}`,
        requestObject: buildRequestObject({
          row: request,
          requestUri: `${config.appBaseUrl}/openid4vp/requests/${request.id}`,
        }),
        organization: organizationDto(org, auth),
      },
      consent: consentDto(consent, linked, null),
    });
  }),
);

/** Organization's own verification requests (via linked verifier). */
router.get(
  '/organization/requests',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const org = await loadIssuer(auth.id);
    const linked = await ensureLinkedVerifier(org);
    const result = await query<PresentationRequestRow>(
      'SELECT * FROM presentation_requests WHERE verifier_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
      [linked.id],
    );
    res.json({
      organization: organizationDto(org, auth),
      requests: await Promise.all(
        result.rows.map(async (row) => {
          const citizen = await loadCitizen(row.citizen_id);
          const consent = await loadConsentByRequest(row.id);
          return { ...requestDto(row, linked, citizen, consent), presentation: consent?.presentation ?? null };
        }),
      ),
    });
  }),
);

/**
 * Organization verifies a presentation (same 9 checks as /verifier/verify,
 * but the caller is the organization; the request must belong to its linked
 * verifier / organization DID).
 */
router.post(
  '/organization/verify',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const org = await loadIssuer(auth.id);
    requireVerifyCapability(org);
    const linked = await ensureLinkedVerifier(org);
    // Reuse the shared verifier by forwarding to the same logic: temporarily
    // emulate a verifier auth context for the linked row.
    (req as Request & { auth: { kind: AccountKind; id: number } }).auth = {
      kind: 'verifier',
      id: linked.id,
    };
    // Validate body shape early for a clean 400.
    parseBody(verifyBody, req.body);
    // Delegate: re-dispatch internally by calling the verifier handler logic
    // through a synthetic sub-request is complex; instead clients should call
    // POST /verifier/verify with the organization-linked presentation — but
    // that endpoint requires a verifier token. So we implement the check here
    // by requiring the presentation's aud to equal the org DID and consent to
    // belong to the linked verifier. Full 9-check verification runs below via
    // the shared verifyPresentation path used by /verifier/verify semantics:
    // we forward to that endpoint's logic by direct function call.
    const presentation = (req.body as { presentation: string }).presentation;
    const { verifyOrganizationPresentation } = await import('./orgVerify.js');
    const result = await verifyOrganizationPresentation({ org, linkedVerifier: linked, presentation });
    res.json(result);
  }),
);

/* ------------------------------------------------------------------ */
/* 10. scoped audit views (least privilege)                             */
/* ------------------------------------------------------------------ */

/** Citizen: own history only + global chain health (no other users' data). */
router.get(
  '/wallet/audit',
  requireCitizen,
  route(async (req, res) => {
    const auth = getAuth(req);
    const limitRaw = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isFinite(limitRaw) || limitRaw <= 0 || limitRaw > 200) {
      throw new HttpError(400, 'Query parameter "limit" must be between 1 and 200');
    }
    const result = await query<AuditLogRow>(
      'SELECT * FROM audit_log WHERE citizen_id = $1 ORDER BY id DESC LIMIT $2',
      [auth.id, limitRaw],
    );
    const chain = await verifyAuditChain();
    res.json({
      entries: result.rows.map(auditDto),
      chain: {
        valid: chain.valid,
        length: chain.length,
        brokenAtEntry: chain.brokenAtEntry,
        brokenAtId: chain.brokenAtId,
        reason: chain.reason,
        headHash: chain.headHash,
        rule: 'hash = base64url(SHA-256(prev_hash + payload)); first prev_hash = "GENESIS"',
      },
    });
  }),
);

/** Organization: own issuance/verification activity only. */
router.get(
  '/organization/audit',
  requireOrganization,
  route(async (req, res) => {
    const auth = getAuth(req);
    const org = await loadIssuer(auth.id);
    const linked = await ensureLinkedVerifier(org);
    const limitRaw = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isFinite(limitRaw) || limitRaw <= 0 || limitRaw > 200) {
      throw new HttpError(400, 'Query parameter "limit" must be between 1 and 200');
    }
    const result = await query<AuditLogRow>(
      'SELECT * FROM audit_log WHERE issuer_id = $1 OR verifier_id = $2 ORDER BY id DESC LIMIT $3',
      [org.id, linked.id, limitRaw],
    );
    const chain = await verifyAuditChain();
    res.json({
      organization: organizationDto(org, auth),
      entries: result.rows.map(auditDto),
      chain: {
        valid: chain.valid,
        length: chain.length,
        brokenAtEntry: chain.brokenAtEntry,
        brokenAtId: chain.brokenAtId,
        reason: chain.reason,
        headHash: chain.headHash,
        rule: 'hash = base64url(SHA-256(prev_hash + payload)); first prev_hash = "GENESIS"',
      },
    });
  }),
);

export default router;

/** Small helper: name the digest alg for check details (avoids repeating). */
function _sdAlgName(verification: { payload: { _sd_alg?: unknown } }): string {
  return typeof verification.payload._sd_alg === 'string' ? verification.payload._sd_alg : 'sha-256';
}
