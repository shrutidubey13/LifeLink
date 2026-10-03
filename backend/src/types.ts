/**
 * TypeScript shapes for the Postgres rows returned by the `pg` driver.
 *
 * Postgres column names are snake_case, so the rows are snake_case too. The API
 * layer converts them into friendly camelCase DTOs (see routes.ts).
 */
import type { JWK } from 'jose';

export interface CitizenRow {
  id: number;
  name: string;
  did: string;
  public_jwk: JWK;
  /** Login email. NULL for rows created before login existed. */
  email: string | null;
  /** bcrypt hash. Never sent to any client — see publicCitizenDto. */
  password_hash: string | null;
  /** Custodial holder key (AES-GCM envelope JSON). NULL for legacy rows. */
  private_jwk_enc: string | null;
  created_at: Date;
}

export type IssuerStatus = 'PENDING' | 'TRUSTED' | 'SUSPENDED' | 'REVOKED';

export interface IssuerRow {
  id: number;
  name: string;
  domain: string;
  did: string;
  public_jwk: JWK;
  /** Legacy plaintext key. Only read as a fallback; new keys use private_key_enc. */
  private_jwk: JWK;
  /** Legacy boolean. New code reads `status`; kept for compatibility. */
  trusted: boolean;
  status: IssuerStatus | null;
  email: string | null;
  password_hash: string | null;
  /** AES-GCM envelope JSON for the signing key (KeyStore). */
  private_key_enc: string | null;
  /** Organization type, e.g. University/Employer/Bank/Hospital/Government. */
  org_type: string | null;
  /** Whether this organization may issue (sign) credentials. */
  can_issue: boolean;
  /** Whether this organization may verify (request + check presentations). */
  can_verify: boolean;
  created_at: Date;
}

/** A citizen-uploaded document awaiting organization review (Flow B). */
export interface DocumentRequestRow {
  id: number;
  citizen_id: number;
  organization_id: number;
  document_type: string;
  document_name: string;
  document_ref: string;
  mime_type: string;
  purpose: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejection_reason: string | null;
  credential_id: number | null;
  created_at: Date;
  reviewed_at: Date | null;
  reviewer: string | null;
}

export interface AdminRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

export interface StatusListRow {
  issuer_id: number;
  /** Raw bitstring, one byte holds 8 credential statuses. */
  bits: Buffer;
  /** Index that the NEXT issued credential will use. */
  next_index: number;
  updated_at: Date;
}

export interface CredentialRow {
  id: number;
  citizen_id: number;
  issuer_id: number;
  type: string;
  /**
   * The credential in combined SD-JWT format:
   *   <jwt>~<disclosure1>~<disclosure2>~...
   * The JWT part only contains SHA-256 digests, so reading this column is safe.
   */
  sd_jwt: string;
  /** The issuer-signed JWT alone (first segment of sd_jwt), for lookup. */
  jwt: string | null;
  /** W3C VC 2.0 representation (see vc.ts). NULL for legacy rows. */
  vc_json: unknown | null;
  status_index: number;
  revoked: boolean;
  issued_at: Date;
  expires_at: Date;
}

export interface VerifierRow {
  id: number;
  name: string;
  did: string;
  /** Login email. NULL for rows created before login existed. */
  email: string | null;
  /** bcrypt hash. Never sent to any client — see publicVerifierDto. */
  password_hash: string | null;
}

export interface ConsentRow {
  id: number;
  citizen_id: number;
  verifier_id: number;
  /** NULL for rejections that name no specific credential. */
  credential_id: number | null;
  purpose: string;
  /** The APPROVED claim keys (subset of requested_fields). */
  fields: string[];
  /** What the verifier originally asked for. */
  requested_fields: string[] | null;
  /** PENDING | APPROVED | REJECTED | REVOKED (lifecycle of the request). */
  status: string | null;
  /** The presentation request this consent answers (NULL for legacy rows). */
  presentation_request_id: number | null;
  /** The SD-JWT+KB produced on approval (NULL until approved). */
  presentation: string | null;
  expires_at: Date;
  /** True once the citizen has ended access early. */
  revoked: boolean;
  created_at: Date;
}

export interface AuditLogRow {
  id: number;
  event_type: string;
  citizen_id: number | null;
  verifier_id: number | null;
  credential_id: number | null;
  issuer_id: number | null;
  /**
   * The canonical JSON string that was hashed. Stored as TEXT on purpose so the
   * hash can be recomputed byte-for-byte later (see audit.ts).
   */
  payload: string;
  prev_hash: string;
  hash: string;
  created_at: Date;
}

/** Credential lifecycle status shown in the wallet UI. */
export type CredentialStatus = 'valid' | 'revoked' | 'expired';

/** Event types appended to the tamper-evident audit log (§18 vocabulary). */
export type AuditEventType =
  | 'CREDENTIAL_ISSUED'
  | 'CREDENTIAL_RECEIVED'
  | 'DOCUMENT_SUBMITTED'
  | 'DOCUMENT_APPROVED'
  | 'DOCUMENT_REJECTED'
  | 'CONSENT_REQUESTED'
  | 'CONSENT_APPROVED'
  | 'CONSENT_REJECTED'
  | 'CONSENT_DENIED'
  | 'CONSENT_REVOKED'
  | 'CREDENTIAL_PRESENTED'
  | 'CREDENTIAL_SHARED'
  | 'CREDENTIAL_VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'CREDENTIAL_REVOKED'
  | 'TRUST_REGISTRY_UPDATED';

/** The checks POST /verifier/verify runs, in order. */
export type CheckId =
  | 'issuer_trusted'
  | 'signature_valid'
  | 'schema_valid'
  | 'disclosure_integrity'
  | 'holder_binding'
  | 'nonce_valid'
  | 'audience_valid'
  | 'not_revoked'
  | 'consent_valid';

/** One verification check performed by POST /verifier/verify. */
export interface CheckResult {
  id: CheckId;
  label: string;
  passed: boolean;
  /** Human readable explanation, shown in the verifier portal. */
  detail: string;
}
