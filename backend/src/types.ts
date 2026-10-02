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
  created_at: Date;
}

export interface IssuerRow {
  id: number;
  name: string;
  domain: string;
  did: string;
  public_jwk: JWK;
  private_jwk: JWK;
  trusted: boolean;
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
   * The credential in "combined SD-JWT issuance format":
   *   <jwt>~<disclosure1>~<disclosure2>~...
   * The JWT part only contains SHA-256 digests, so reading this column is safe.
   */
  sd_jwt: string;
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
  credential_id: number;
  purpose: string;
  /** The claim keys the citizen agreed to share. */
  fields: string[];
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

/** Event types appended to the tamper-evident audit log. */
export type AuditEventType =
  | 'ISSUER_CREDENTIAL_ISSUED'
  | 'ISSUER_CREDENTIAL_REVOKED'
  | 'CONSENT_GRANTED'
  | 'CONSENT_REVOKED'
  | 'VERIFICATION_GRANTED'
  | 'VERIFICATION_DENIED'
  /** An issuer was added to / removed from the trust registry. */
  | 'TRUST_REGISTRY_UPDATED';

/** One verification check performed by POST /verifier/verify. */
export interface CheckResult {
  id: 'issuer_trusted' | 'signature_valid' | 'disclosure_integrity' | 'not_revoked' | 'consent_valid';
  label: string;
  passed: boolean;
  /** Human readable explanation, shown in the verifier portal. */
  detail: string;
}
