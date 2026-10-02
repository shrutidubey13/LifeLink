/**
 * LifeLink REST API.
 *
 * Section map:
 *   1. helpers + DTO mappers
 *   2. actors            /citizens, /verifiers, /trust-registry
 *   3. issuer portal     /issuer/*
 *   4. citizen wallet    /wallet/*
 *   5. verifier          /verifier/verify
 *   6. revocation        /status-lists/:issuerId
 *   7. audit log         /audit, /audit/verify
 *
 * Design rules enforced here:
 *   - Private issuer keys never leave the database.
 *   - /verifier/verify returns ONLY the claims the citizen consented to share.
 *   - The audit log records claim *names*, never claim *values*.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { JWK } from 'jose';
import { HttpError, config } from './config';
import { query, queryOne } from './db';
import { appendAuditEvent, verifyAuditChain } from './audit';
import { getStatusListRow, getStatusListView, allocateStatusIndex, isRevoked, revokeStatusIndex } from './statusList';
import { claimKeys, claimsOf, createPresentation, indexCredential, issueSdJwt, verifyPresentation } from './sdjwt';
import { importPrivateJwk } from './crypto';
import type {
  AuditLogRow,
  CheckResult,
  CitizenRow,
  ConsentRow,
  CredentialRow,
  CredentialStatus,
  IssuerRow,
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

function optionalString(body: Record<string, unknown>, field: string, fallback: string): string {
  const value = body[field];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new HttpError(400, `"${field}" must be a string`);
  return value.trim();
}

function requireId(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  const id = typeof value === 'string' ? Number(value) : value;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `"${field}" must be a positive integer id`);
  }
  return id;
}

function idFromPath(req: Request, field = 'id'): number {
  const value = Number(req.params[field]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `"${field}" path parameter must be a positive integer`);
  }
  return value;
}

function requireStringArray(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, `"${field}" must be a non-empty array of claim names`);
  }
  const items = value.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (items.some((item) => item === '')) {
    throw new HttpError(400, `"${field}" must only contain non-empty strings`);
  }
  return Array.from(new Set(items));
}

function requireClaimsObject(body: Record<string, unknown>, field = 'claims'): Record<string, unknown> {
  const value = body[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, `"${field}" must be a JSON object of claim name -> value`);
  }
  const claims = value as Record<string, unknown>;
  if (Object.keys(claims).length === 0) {
    throw new HttpError(400, `"${field}" must contain at least one claim`);
  }
  if (Object.keys(claims).length > 50) {
    throw new HttpError(400, `"${field}" may contain at most 50 claims`);
  }
  return claims;
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

async function loadIssuer(id: number): Promise<IssuerRow> {
  const row = await queryOne<IssuerRow>('SELECT * FROM issuers WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Issuer ${id} not found`);
  return row;
}

async function loadVerifier(id: number): Promise<VerifierRow> {
  const row = await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Verifier ${id} not found`);
  return row;
}

async function loadCredential(id: number): Promise<CredentialRow> {
  const row = await queryOne<CredentialRow>('SELECT * FROM credentials WHERE id = $1', [id]);
  if (!row) throw new HttpError(404, `Credential ${id} not found`);
  return row;
}

// --- DTOs (snake_case rows -> camelCase JSON) -------------------------

/**
 * A stand-in for the private key when we only carried public columns into a
 * DTO. It is never serialised (issuerDto ignores it) and never used to sign.
 */
function issuerEmptyJwk(): JWK {
  return { kty: 'OKP', crv: 'Ed25519', x: '' };
}

function citizenDto(row: CitizenRow) {
  return {
    id: row.id,
    name: row.name,
    did: row.did,
    createdAt: row.created_at.toISOString(),
  };
}

function issuerDto(row: IssuerRow) {
  // NOTE: private_jwk is intentionally never included.
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    did: row.did,
    trusted: row.trusted,
    createdAt: row.created_at.toISOString(),
  };
}

function verifierDto(row: VerifierRow) {
  return { id: row.id, name: row.name, did: row.did };
}

/** valid / revoked / expired, in that order of precedence. */
function credentialStatus(row: CredentialRow, now = new Date()): CredentialStatus {
  if (row.revoked) return 'revoked';
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

function credentialDto(row: CredentialRow, issuer: IssuerRow, claims: Record<string, unknown>) {
  return {
    id: row.id,
    type: row.type,
    typeLabel: typeLabel(row.type),
    issuer: issuerDto(issuer),
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    status: credentialStatus(row),
    statusIndex: row.status_index,
    /** Every claim, readable by the wallet owner only. */
    claims,
    /** Names the citizen can tick when sharing. */
    availableFields: Object.keys(claims),
  };
}

function consentDto(row: ConsentRow, verifier: VerifierRow | null, credential: CredentialRow | null) {
  const now = Date.now();
  const state = row.revoked
    ? 'ended'
    : new Date(row.expires_at).getTime() <= now
      ? 'expired'
      : 'active';
  return {
    id: row.id,
    citizenId: row.citizen_id,
    verifier: verifier ? verifierDto(verifier) : null,
    credentialId: row.credential_id,
    credentialType: credential?.type ?? null,
    credentialTypeLabel: credential ? typeLabel(credential.type) : null,
    purpose: row.purpose,
    fields: row.fields,
    expiresAt: row.expires_at.toISOString(),
    revoked: row.revoked,
    state,
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
    payload,
    prevHash: row.prev_hash,
    hash: row.hash,
    createdAt: row.created_at.toISOString(),
  };
}

/** Consent durations offered in the wallet UI. */
const DURATIONS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

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

router.get(
  '/citizens',
  route(async (_req, res) => {
    const result = await query<CitizenRow>('SELECT * FROM citizens ORDER BY id ASC');
    res.json({ citizens: result.rows.map(citizenDto) });
  }),
);

router.get(
  '/verifiers',
  route(async (_req, res) => {
    const result = await query<VerifierRow>('SELECT * FROM verifiers ORDER BY id ASC');
    res.json({ verifiers: result.rows.map(verifierDto) });
  }),
);

/** The issuers table doubles as the trust registry. */
router.get(
  '/trust-registry/issuers',
  route(async (_req, res) => {
    const result = await query<IssuerRow>('SELECT * FROM issuers ORDER BY trusted DESC, name ASC');
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

/** Add an issuer to the trust registry. */
router.post(
  '/trust-registry/issuers/:id/trust',
  route(async (req, res) => {
    const id = idFromPath(req);
    const issuer = await loadIssuer(id);
    if (issuer.trusted) {
      res.json({ issuer: issuerDto(issuer), alreadyTrusted: true });
      return;
    }
    const updated = await queryOne<IssuerRow>(
      'UPDATE issuers SET trusted = TRUE WHERE id = $1 RETURNING *',
      [id],
    );
    await appendAuditEvent({
      eventType: 'TRUST_REGISTRY_UPDATED',
      payload: {
        issuerId: issuer.id,
        issuerName: issuer.name,
        issuerDid: issuer.did,
        change: 'trusted',
        note: 'Credentials from this issuer will now be accepted by verifiers',
      },
    });
    res.json({ issuer: issuerDto(updated as IssuerRow), alreadyTrusted: false });
  }),
);

/** Remove an issuer from the trust registry (demo helper). */
router.delete(
  '/trust-registry/issuers/:id/trust',
  route(async (req, res) => {
    const id = idFromPath(req);
    const issuer = await loadIssuer(id);
    const updated = await queryOne<IssuerRow>(
      'UPDATE issuers SET trusted = FALSE WHERE id = $1 RETURNING *',
      [id],
    );
    await appendAuditEvent({
      eventType: 'TRUST_REGISTRY_UPDATED',
      payload: {
        issuerId: issuer.id,
        issuerName: issuer.name,
        issuerDid: issuer.did,
        change: 'untrusted',
        note: 'Credentials from this issuer will now be denied by verifiers',
      },
    });
    res.json({ issuer: issuerDto(updated as IssuerRow), alreadyUntrusted: !issuer.trusted });
  }),
);

/* ------------------------------------------------------------------ */
/* 3. issuer portal                                                    */
/* ------------------------------------------------------------------ */

/**
 * Issue a credential. The issuer signs an SD-JWT in which every claim is a
 * salted disclosure and only the digests are signed.
 */
router.post(
  '/issuer/credentials',
  route(async (req, res) => {
    const body = asRecord(req.body);
    const issuerId = requireId(body, 'issuerId');
    const citizenId = requireId(body, 'citizenId');
    const type = requireString(body, 'type', 100);
    const claims = requireClaimsObject(body);

    const expiresInDays = body.expiresInDays === undefined ? 365 : Number(body.expiresInDays);
    if (!Number.isFinite(expiresInDays) || expiresInDays <= 0 || expiresInDays > 3650) {
      throw new HttpError(400, '"expiresInDays" must be between 1 and 3650');
    }

    const [issuer, citizen] = await Promise.all([loadIssuer(issuerId), loadCitizen(citizenId)]);

    // Every credential gets its own bit in the issuer's status list.
    const statusIndex = await allocateStatusIndex(issuer.id);
    const statusListUrl = `${config.appBaseUrl}/status-lists/${issuer.id}`;

    const issued = await issueSdJwt({
      issuer: issuer.did,
      issuerPrivateKey: await importPrivateJwk(issuer.private_jwk),
      subject: citizen.did,
      type,
      claims,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      statusListUrl,
      statusIndex,
    });

    const inserted = await queryOne<CredentialRow>(
      `INSERT INTO credentials (citizen_id, issuer_id, type, sd_jwt, status_index, revoked, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)
       RETURNING *`,
      [citizen.id, issuer.id, type, issued.combined, statusIndex, new Date(), new Date(issued.payload.exp * 1000)],
    );
    const credential = inserted as CredentialRow;

    const claimsByKey = Object.fromEntries(issued.disclosedClaims.map((c) => [c.key, c.value]));

    await appendAuditEvent({
      eventType: 'ISSUER_CREDENTIAL_ISSUED',
      citizenId: citizen.id,
      credentialId: credential.id,
      payload: {
        type,
        typeLabel: typeLabel(type),
        issuerId: issuer.id,
        issuerDid: issuer.did,
        issuerTrusted: issuer.trusted,
        citizenDid: citizen.did,
        statusIndex,
        expiresAt: credential.expires_at.toISOString(),
        // Claim NAMES only — never the values (DPDP data minimisation).
        claimKeys: issued.disclosedClaims.map((c) => c.key),
        allClaimsAreSelectiveDisclosures: true,
      },
    });

    res.status(201).json({
      credential: credentialDto(credential, issuer, claimsByKey),
      message: `${type} issued to ${citizen.name}. Every claim is individually shareable.`,
    });
  }),
);

/** List credentials an issuer has issued (drives the issuer portal list). */
router.get(
  '/issuer/credentials',
  route(async (req, res) => {
    const issuerId = Number(req.query.issuerId);
    if (!Number.isInteger(issuerId) || issuerId <= 0) {
      throw new HttpError(400, 'Query parameter "issuerId" is required');
    }
    const issuer = await loadIssuer(issuerId);
    const result = await query<CredentialRow & { citizen_name: string; citizen_did: string }>(
      `SELECT c.*, p.name AS citizen_name, p.did AS citizen_did
       FROM credentials c
       JOIN citizens p ON p.id = c.citizen_id
       WHERE c.issuer_id = $1
       ORDER BY c.id DESC`,
      [issuerId],
    );

    res.json({
      issuer: issuerDto(issuer),
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

/** Revoke a credential: flip its status-list bit to 1 and flag the row. */
router.post(
  '/issuer/credentials/:id/revoke',
  route(async (req, res) => {
    const id = idFromPath(req);
    const credential = await loadCredential(id);
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
    const updated = await queryOne<CredentialRow>(
      'UPDATE credentials SET revoked = TRUE WHERE id = $1 RETURNING *',
      [id],
    );

    await appendAuditEvent({
      eventType: 'ISSUER_CREDENTIAL_REVOKED',
      citizenId: citizen.id,
      credentialId: credential.id,
      payload: {
        type: credential.type,
        issuerId: issuer.id,
        issuerDid: issuer.did,
        statusIndex: credential.status_index,
        reason: optionalString(asRecord(req.body ?? {}), 'reason', 'Revoked by issuer'),
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
/* 4. citizen wallet                                                   */
/* ------------------------------------------------------------------ */

/** Everything in the citizen's wallet, with a friendly status per credential. */
router.get(
  '/wallet/credentials',
  route(async (req, res) => {
    const citizenId = Number(req.query.citizenId);
    if (!Number.isInteger(citizenId) || citizenId <= 0) {
      throw new HttpError(400, 'Query parameter "citizenId" is required');
    }
    const citizen = await loadCitizen(citizenId);

    const result = await query<
      CredentialRow & {
        issuer_name: string;
        issuer_domain: string;
        issuer_did: string;
        issuer_trusted: boolean;
        issuer_public_jwk: JWK;
      }
    >(
      `SELECT c.*, i.name AS issuer_name, i.domain AS issuer_domain, i.did AS issuer_did,
              i.trusted AS issuer_trusted, i.public_jwk AS issuer_public_jwk
       FROM credentials c
       JOIN issuers i ON i.id = c.issuer_id
       WHERE c.citizen_id = $1
       ORDER BY c.issued_at DESC, c.id DESC`,
      [citizenId],
    );

    const credentials = result.rows.map((row) => {
      // Rebuild just enough of the issuer row for the DTO. Only the PUBLIC key
      // is selected above — the private key never leaves the database.
      const issuer: IssuerRow = {
        id: row.issuer_id,
        name: row.issuer_name,
        domain: row.issuer_domain,
        did: row.issuer_did,
        trusted: row.issuer_trusted,
        public_jwk: row.issuer_public_jwk,
        private_jwk: issuerEmptyJwk(),
        created_at: row.issued_at,
      };
      const claims = claimsOf(row.sd_jwt);
      return credentialDto(row, issuer, claims);
    });

    const summary = {
      total: credentials.length,
      valid: credentials.filter((c) => c.status === 'valid').length,
      revoked: credentials.filter((c) => c.status === 'revoked').length,
      expired: credentials.filter((c) => c.status === 'expired').length,
    };

    res.json({ citizen: citizenDto(citizen), credentials, summary });
  }),
);

/**
 * The heart of the product: the citizen says WHO, WHY, WHICH FIELDS and FOR HOW
 * LONG. The backend records the consent and returns a presentation that
 * physically contains only those fields.
 */
router.post(
  '/wallet/presentations',
  route(async (req, res) => {
    const body = asRecord(req.body);
    const citizenId = requireId(body, 'citizenId');
    const verifierId = requireId(body, 'verifierId');
    const credentialId = requireId(body, 'credentialId');
    const purpose = requireString(body, 'purpose', 300);
    const fields = requireStringArray(body, 'fields');
    const duration = optionalString(body, 'duration', '30m');

    const durationMs = DURATIONS[duration];
    if (!durationMs) {
      throw new HttpError(400, `"duration" must be one of: ${Object.keys(DURATIONS).join(', ')}`);
    }

    const [citizen, verifier, credential] = await Promise.all([
      loadCitizen(citizenId),
      loadVerifier(verifierId),
      loadCredential(credentialId),
    ]);

    if (credential.citizen_id !== citizen.id) {
      throw new HttpError(403, 'That credential does not belong to this citizen');
    }
    const status = credentialStatus(credential);
    if (status !== 'valid') {
      throw new HttpError(409, `Cannot share this credential: it is ${status}`);
    }

    // Every requested field must exist, otherwise we would silently share less
    // than the citizen (and the verifier) agreed to.
    const available = indexCredential(credential.sd_jwt).byKey;
    const unknownFields = fields.filter((field) => !available.has(field));
    if (unknownFields.length > 0) {
      throw new HttpError(400, 'These fields do not exist on this credential', {
        unknownFields,
        availableFields: [...available.keys()],
      });
    }

    const expiresAt = new Date(Date.now() + durationMs);
    const created = await queryOne<ConsentRow>(
      `INSERT INTO consents (citizen_id, verifier_id, credential_id, purpose, fields, expires_at, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING *`,
      [citizen.id, verifier.id, credential.id, purpose, fields, expiresAt],
    );
    const consent = created as ConsentRow;

    // Build the presentation: only the selected disclosures travel.
    const { presentation, revealed, missing } = createPresentation(credential.sd_jwt, fields);
    if (missing.length > 0) {
      throw new HttpError(400, 'Could not build the presentation', { missing });
    }

    await appendAuditEvent({
      eventType: 'CONSENT_GRANTED',
      citizenId: citizen.id,
      verifierId: verifier.id,
      credentialId: credential.id,
      payload: {
        consentId: consent.id,
        purpose,
        durationSeconds: Math.round(durationMs / 1000),
        expiresAt: expiresAt.toISOString(),
        // Field NAMES only, never values.
        sharedFields: fields,
        hiddenFields: claimKeys(credential.sd_jwt).filter((key) => !fields.includes(key)),
        verifierDid: verifier.did,
        dataMinimisation: 'Only the selected disclosures were included in the presentation',
      },
    });

    res.status(201).json({
      consent: consentDto(consent, verifier, credential),
      // This is the blob the verifier receives. Note what is NOT in it.
      presentation,
      // Citizen-facing preview of exactly what leaves the wallet.
      reveals: revealed,
      hidden: claimKeys(credential.sd_jwt).filter((key) => !fields.includes(key)),
      verifier: verifierDto(verifier),
      credential: { id: credential.id, type: credential.type, typeLabel: typeLabel(credential.type) },
      notice: `${fields.length} of ${available.size} fields were shared with ${verifier.name} until ${expiresAt.toISOString()}.`,
    });
  }),
);

/** Sharing history: everything this citizen has ever agreed to share. */
router.get(
  '/wallet/consents',
  route(async (req, res) => {
    const citizenId = Number(req.query.citizenId);
    if (!Number.isInteger(citizenId) || citizenId <= 0) {
      throw new HttpError(400, 'Query parameter "citizenId" is required');
    }
    const citizen = await loadCitizen(citizenId);

    const result = await query<ConsentRow & { verifier_name: string; verifier_did: string; credential_type: string }>(
      `SELECT co.*, v.name AS verifier_name, v.did AS verifier_did, c.type AS credential_type
       FROM consents co
       JOIN verifiers v ON v.id = co.verifier_id
       JOIN credentials c ON c.id = co.credential_id
       WHERE co.citizen_id = $1
       ORDER BY co.created_at DESC, co.id DESC`,
      [citizenId],
    );

    res.json({
      citizen: citizenDto(citizen),
      consents: result.rows.map((row) => {
        const verifier: VerifierRow = {
          id: row.verifier_id,
          name: row.verifier_name,
          did: row.verifier_did,
        };
        const credential: CredentialRow = {
          id: row.credential_id,
          citizen_id: row.citizen_id,
          issuer_id: 0,
          type: row.credential_type,
          sd_jwt: '',
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

/** End access early (DPDP: consent is as easy to withdraw as to give). */
router.post(
  '/wallet/consents/:id/revoke',
  route(async (req, res) => {
    const id = idFromPath(req);
    const existing = await queryOne<ConsentRow>('SELECT * FROM consents WHERE id = $1', [id]);
    if (!existing) throw new HttpError(404, `Consent ${id} not found`);

    const [verifier, credential] = await Promise.all([
      loadVerifier(existing.verifier_id),
      loadCredential(existing.credential_id),
    ]);

    if (existing.revoked) {
      res.json({ consent: consentDto(existing, verifier, credential), alreadyRevoked: true });
      return;
    }

    const updated = await queryOne<ConsentRow>(
      'UPDATE consents SET revoked = TRUE WHERE id = $1 RETURNING *',
      [id],
    );
    const consent = updated as ConsentRow;

    await appendAuditEvent({
      eventType: 'CONSENT_REVOKED',
      citizenId: consent.citizen_id,
      verifierId: consent.verifier_id,
      credentialId: consent.credential_id,
      payload: {
        consentId: consent.id,
        purpose: consent.purpose,
        verifierDid: verifier.did,
        previouslySharedFields: consent.fields,
        wasActive: new Date(consent.expires_at).getTime() > Date.now(),
      },
    });

    res.json({
      consent: consentDto(consent, verifier, credential),
      alreadyRevoked: false,
      message: `Access for ${verifier.name} ended. Future verifications using consent ${id} are denied.`,
    });
  }),
);

/* ------------------------------------------------------------------ */
/* 5. verifier                                                         */
/* ------------------------------------------------------------------ */

/**
 * POST /verifier/verify
 *
 * Runs the checks IN ORDER, exactly as a relying party must:
 *   1. issuer_trusted       — is the issuer in the trust registry?
 *   2. signature_valid      — EdDSA signature over the SD-JWT + not expired
 *   3. disclosure_integrity — every revealed claim matches a signed _sd digest
 *   4. not_revoked          — the status-list bit for this credential is 0
 *   5. consent_valid        — consent exists, is for this verifier, is live,
 *                             and covers every revealed field
 *
 * The response contains ONLY the claims the citizen consented to. Claims that
 * exist inside the credential but were not shared are never returned, and when
 * access is denied nothing is revealed at all.
 */
router.post(
  '/verifier/verify',
  route(async (req, res) => {
    const startedAt = Date.now();
    const body = asRecord(req.body);
    const verifierId = requireId(body, 'verifierId');
    const consentId = requireId(body, 'consentId');
    const presentation = requireString(body, 'presentation', 20_000);

    const verifier = await loadVerifier(verifierId);
    const consentRow = await queryOne<ConsentRow>('SELECT * FROM consents WHERE id = $1', [consentId]);
    if (!consentRow) {
      throw new HttpError(404, `Consent ${consentId} not found — the citizen never granted this access`);
    }

    const credential = await loadCredential(consentRow.credential_id);
    const issuer = await loadIssuer(credential.issuer_id);
    const citizen = await loadCitizen(credential.citizen_id);
    const checks: CheckResult[] = [];

    // ---- 1. trust registry ------------------------------------------
    checks.push({
      id: 'issuer_trusted',
      label: 'Issuer is in the trust registry',
      passed: issuer.trusted,
      detail: issuer.trusted
        ? `${issuer.name} (${issuer.did}) is a registered, trusted issuer.`
        : `${issuer.name} (${issuer.did}) is NOT in the trust registry, so anything it signed is refused.`,
    });

    // ---- 2 + 3. signature and disclosure digests -------------------
    let verification: Awaited<ReturnType<typeof verifyPresentation>> | null = null;
    let parseError: string | null = null;
    try {
      verification = await verifyPresentation(presentation, issuer.public_jwk);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }

    if (verification) {
      checks.push({
        id: 'signature_valid',
        label: 'Signature is valid and the credential has not expired',
        passed: verification.signatureValid,
        detail: verification.signatureValid
          ? `Ed25519 signature by ${issuer.did} verified; the credential is valid until ${new Date(verification.payload.exp * 1000).toISOString()}.`
          : verification.problems[0] ?? 'Signature verification failed.',
      });
      checks.push({
        id: 'disclosure_integrity',
        label: 'Revealed fields match signed digests',
        passed: verification.digestsValid,
        detail: verification.digestsValid
          ? `All ${verification.revealedKeys.length} shared field(s) hash to a digest inside the signed _sd array, so none of them were tampered with.`
          : verification.problems[0] ?? 'Disclosure digest mismatch.',
      });
    } else {
      checks.push({
        id: 'signature_valid',
        label: 'Signature is valid and the credential has not expired',
        passed: false,
        detail: `Presentation could not be parsed: ${parseError ?? 'unknown error'}`,
      });
      checks.push({
        id: 'disclosure_integrity',
        label: 'Revealed fields match signed digests',
        passed: false,
        detail: 'Skipped because the presentation could not be parsed.',
      });
    }

    // ---- 4. revocation (W3C Bitstring Status List) ------------------
    const statusList = await getStatusListRow(issuer.id);
    const statusIndex = verification?.payload?.status?.idx ?? credential.status_index;
    const revokedByStatusList = isRevoked(statusList.bits, statusIndex);
    const revokedInDatabase = credential.revoked;
    const revoked = revokedByStatusList || revokedInDatabase;
    checks.push({
      id: 'not_revoked',
      label: 'Credential has not been revoked',
      passed: !revoked,
      detail: revoked
        ? `Status list bit #${statusIndex} of ${issuer.name} is set, so this credential was revoked${revokedInDatabase ? ' (issuer record confirms)' : ''}.`
        : `Status list bit #${statusIndex} of ${issuer.name} is 0 (valid), last updated ${statusList.updated_at.toISOString()}.`,
    });

    // ---- 5. consent -------------------------------------------------
    const consentProblems: string[] = [];
    if (consentRow.verifier_id !== verifier.id) {
      consentProblems.push(`Consent ${consentId} was granted to another verifier, not ${verifier.name}.`);
    }
    if (consentRow.revoked) {
      consentProblems.push('The citizen ended this access early.');
    }
    if (new Date(consentRow.expires_at).getTime() <= Date.now()) {
      consentProblems.push(`Consent expired at ${consentRow.expires_at.toISOString()}.`);
    }
    if (verification && verification.jwt !== indexCredential(credential.sd_jwt).jwt) {
      consentProblems.push('The presented token is not the credential the consent was issued for.');
    }
    if (verification && verification.payload.sub !== citizen.did) {
      consentProblems.push('The credential subject does not match the consenting citizen.');
    }
    const revealedKeys = verification?.revealedKeys ?? [];
    const notConsented = revealedKeys.filter((key) => !consentRow.fields.includes(key));
    if (notConsented.length > 0) {
      consentProblems.push(`Fields shared without consent: ${notConsented.join(', ')}.`);
    }
    checks.push({
      id: 'consent_valid',
      label: 'Valid, unexpired consent covers every shared field',
      passed: consentProblems.length === 0,
      detail:
        consentProblems.length === 0
          ? `Consent ${consentId} for "${consentRow.purpose}" covers exactly the ${revealedKeys.length} shared field(s) and is live until ${consentRow.expires_at.toISOString()}.`
          : consentProblems.join(' '),
    });

    const granted = checks.every((check) => check.passed);
    const durationMs = Date.now() - startedAt;

    await appendAuditEvent({
      eventType: granted ? 'VERIFICATION_GRANTED' : 'VERIFICATION_DENIED',
      citizenId: citizen.id,
      verifierId: verifier.id,
      credentialId: credential.id,
      payload: {
        consentId: consentRow.id,
        purpose: consentRow.purpose,
        verifierDid: verifier.did,
        credentialType: credential.type,
        issuerDid: issuer.did,
        durationMs,
        checks: checks.map((check) => ({ id: check.id, passed: check.passed })),
        // Names of what was revealed, never the values.
        revealedFields: granted ? revealedKeys : [],
        deniedBecause: granted ? null : checks.filter((c) => !c.passed).map((c) => c.id),
      },
    });

    res.json({
      result: granted ? 'granted' : 'denied',
      // On denial we deliberately return nothing about the credential contents.
      revealed: granted && verification ? verification.revealed : {},
      revealedFields: granted ? revealedKeys : [],
      withheldFields: granted
        ? claimKeys(credential.sd_jwt).filter((key) => !revealedKeys.includes(key))
        : [],
      checks,
      verifier: verifierDto(verifier),
      consent: consentDto(consentRow, verifier, credential),
      credential: {
        id: credential.id,
        type: credential.type,
        typeLabel: typeLabel(credential.type),
        issuer: issuerDto(issuer),
        subject: citizen.did,
        statusIndex,
      },
      // The numbers for the "before vs after" box in the verifier portal.
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

/* ------------------------------------------------------------------ */
/* 6. revocation status list                                           */
/* ------------------------------------------------------------------ */

router.get(
  '/status-lists/:issuerId',
  route(async (req, res) => {
    const issuerId = idFromPath(req, 'issuerId');
    res.json(await getStatusListView(issuerId, config.appBaseUrl));
  }),
);

/* ------------------------------------------------------------------ */
/* 7. audit log                                                        */
/* ------------------------------------------------------------------ */

router.get(
  '/audit',
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

router.get(
  '/audit/verify',
  route(async (req, res) => {
    const limitRaw = req.query.limit === undefined ? undefined : Number(req.query.limit);
    if (limitRaw !== undefined && (!Number.isFinite(limitRaw) || limitRaw <= 0)) {
      throw new HttpError(400, 'Query parameter "limit" must be a positive number when provided');
    }
    const chain = await verifyAuditChain(limitRaw);
    res.json(chain);
  }),
);

export default router;
