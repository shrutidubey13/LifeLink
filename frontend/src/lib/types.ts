/**
 * TypeScript mirrors of the backend API responses.
 * If you change a response shape in backend/src/routes.ts, change it here too.
 */

export type CredentialStatus = 'valid' | 'revoked' | 'expired';
export type ConsentState = 'active' | 'expired' | 'ended';
export type VerificationResult = 'granted' | 'denied';

export interface Citizen {
  id: number;
  name: string;
  did: string;
  email: string | null;
  hasLogin: boolean;
  createdAt: string;
}

export interface Issuer {
  id: number;
  name: string;
  domain: string;
  did: string;
  trusted: boolean;
  createdAt: string;
  credentialsIssued?: number;
}

export interface Verifier {
  id: number;
  name: string;
  did: string;
  email: string | null;
  hasLogin: boolean;
}

export interface Credential {
  id: number;
  type: string;
  typeLabel: string;
  issuer: Issuer;
  issuedAt: string;
  expiresAt: string;
  status: CredentialStatus;
  statusIndex: number;
  claims: Record<string, unknown>;
  availableFields: string[];
}

export interface WalletResponse {
  citizen: Citizen;
  credentials: Credential[];
  summary: { total: number; valid: number; revoked: number; expired: number };
}

export interface Consent {
  id: number;
  citizenId: number;
  verifier: Verifier | null;
  credentialId: number;
  credentialType: string | null;
  credentialTypeLabel: string | null;
  purpose: string;
  fields: string[];
  expiresAt: string;
  revoked: boolean;
  state: ConsentState;
  createdAt: string;
}

/** What POST /wallet/presentations returns right after the citizen approves. */
export interface ShareResult {
  consent: Consent;
  /** `<jwt>~<disclosure>~...` — contains ONLY the chosen fields. */
  presentation: string;
  reveals: Record<string, unknown>;
  hidden: string[];
  verifier: Verifier;
  credential: { id: number; type: string; typeLabel: string };
  notice: string;
}

export type CheckId =
  | 'issuer_trusted'
  | 'signature_valid'
  | 'disclosure_integrity'
  | 'not_revoked'
  | 'consent_valid';

export interface CheckResult {
  id: CheckId;
  label: string;
  passed: boolean;
  detail: string;
}

export interface VerifyResponse {
  result: VerificationResult;
  /** Only the consented claims. Empty when access was denied. */
  revealed: Record<string, unknown>;
  revealedFields: string[];
  withheldFields: string[];
  checks: CheckResult[];
  verifier: Verifier;
  consent: Consent;
  credential: {
    id: number;
    type: string;
    typeLabel: string;
    issuer: Issuer;
    subject: string;
    statusIndex: number;
  };
  comparison: {
    lifelink: { verificationTimeMs: number; documentsUploaded: number; formsFilled: number; summary: string };
    traditional: { verificationTime: string; documentsUploaded: number; formsFilled: number; summary: string };
  };
  verifiedAt: string;
}

export type AuditEventType =
  | 'ISSUER_CREDENTIAL_ISSUED'
  | 'ISSUER_CREDENTIAL_REVOKED'
  | 'CONSENT_GRANTED'
  | 'CONSENT_REVOKED'
  | 'VERIFICATION_GRANTED'
  | 'VERIFICATION_DENIED'
  | 'TRUST_REGISTRY_UPDATED';

export interface AuditEntry {
  id: number;
  eventType: AuditEventType;
  citizenId: number | null;
  verifierId: number | null;
  credentialId: number | null;
  payload: Record<string, unknown> | string;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface ChainStatus {
  valid: boolean;
  length: number;
  brokenAtEntry: number | null;
  brokenAtId: number | null;
  reason: string | null;
  headHash: string | null;
  rule?: string;
}

export interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  chain: ChainStatus;
}

export interface IssuedCredential {
  id: number;
  type: string;
  typeLabel: string;
  citizen: { id: number; name: string; did: string };
  issuedAt: string;
  expiresAt: string;
  status: CredentialStatus;
  statusIndex: number;
  claims: Record<string, unknown>;
}

export interface StatusList {
  issuerId: number;
  issuer: { name: string; did: string; domain: string };
  url: string;
  encoding: string;
  bitstring: string;
  bitsRawLength: number;
  nextIndex: number;
  revoked: { index: number; credentialId: number | null; type: string }[];
  updatedAt: string;
}

/* ---------------- auth ---------------- */

export type AccountKind = 'citizen' | 'verifier';

/** The logged-in user, as returned by /auth/me and login/register. */
export interface SessionUser {
  kind: AccountKind;
  id: number;
  name: string;
  email: string | null;
  did: string;
}

export interface CitizenSession {
  token: string;
  citizen: Citizen;
}

export interface VerifierSession {
  token: string;
  verifier: Verifier;
}

/* ---------------- verification history ---------------- */

/** One verification run against a credential, from the audit trail. */
export interface VerificationRecord {
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

export interface CitizenVerifications {
  citizenId: number;
  verifications: VerificationRecord[];
  summary: { total: number; granted: number; denied: number; verifiers: number };
}

export interface VerifierProfile {
  verifier: Verifier;
  stats: {
    total: number;
    granted: number;
    denied: number;
    citizensServed: number;
    credentialTypes: string[];
  };
  history: (VerificationRecord & { citizen: { id: number; name: string } })[];
}
