/**
 * TypeScript mirrors of the backend API responses.
 * If you change a response shape in backend/src/routes.ts, change it here too.
 */

export type CredentialStatus = 'valid' | 'revoked' | 'expired';
export type ConsentState = 'pending' | 'active' | 'rejected' | 'expired' | 'ended';
export type VerificationResult = 'granted' | 'denied';
export type IssuerStatus = 'PENDING' | 'TRUSTED' | 'SUSPENDED' | 'REVOKED';
export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

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
  status: IssuerStatus;
  trusted: boolean;
  orgType: string | null;
  organizationType?: string | null;
  canIssue: boolean;
  canVerify: boolean;
  email?: string | null;
  hasLogin?: boolean;
  createdAt: string;
  credentialsIssued?: number;
}

export interface Organization extends Issuer {
  kind: 'organization';
}

export interface Verifier {
  id: number;
  name: string;
  did: string;
  email: string | null;
  hasLogin: boolean;
}

export interface DocumentFile {
  id: number;
  name: string;
  mime: string;
  size: number;
  sha256: string;
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
  vc?: unknown | null;
  claims: Record<string, unknown>;
  availableFields: string[];
  attachmentId?: number | null;
  attachment?: DocumentFile | null;
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
  credentialId: number | null;
  credentialType: string | null;
  credentialTypeLabel: string | null;
  purpose: string;
  requestedFields?: string[];
  fields: string[];
  shareAttachment?: boolean;
  status?: string;
  state: ConsentState;
  presentationRequestId?: number | null;
  hasPresentation?: boolean;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}

/** A presentation request (OpenID4VP subset) awaiting citizen decision. */
export interface PresentationRequest {
  id: number;
  verifier: Verifier;
  organization?: Organization | null;
  citizen: { id: number; name: string; did: string };
  credentialType: string;
  credentialTypeLabel: string;
  requestedFields: string[];
  purpose: string;
  nonce: string;
  aud: string;
  clientId: string;
  expiresAt: string;
  used: boolean;
  usable: boolean;
  consent: Consent | null;
  hasPresentation: boolean;
  presentation?: string | null;
  requestUri?: string;
  createdAt: string;
}

/** Citizen-uploaded document awaiting organization review (Flow B). */
export interface DocumentRequest {
  id: number;
  citizenId: number;
  citizen: { id: number; name: string; did: string } | null;
  organizationId: number;
  organization: Organization | null;
  documentType: string;
  documentName: string;
  documentRef: string;
  mimeType: string;
  purpose: string;
  status: DocumentStatus;
  rejectionReason: string | null;
  credentialId: number | null;
  fileId?: number | null;
  file?: DocumentFile | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewer: string | null;
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
  | 'schema_valid'
  | 'disclosure_integrity'
  | 'holder_binding'
  | 'nonce_valid'
  | 'audience_valid'
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
  organization?: { id: number; name: string; did: string } | null;
  request?: { id: number; purpose: string; requestedFields: string[]; nonce: string } | null;
  consent: Consent | null;
  credential: {
    id: number;
    type: string;
    typeLabel: string;
    issuer: Issuer | null;
    subject: string | null;
    statusIndex: number;
    attachmentId?: number | null;
  } | null;
  attachment?: DocumentFile | null;
  comparison?: {
    gitlink: { verificationTimeMs: number; documentsUploaded: number; formsFilled: number; summary: string };
    traditional: { verificationTime: string; documentsUploaded: number; formsFilled: number; summary: string };
  };
  verifiedAt: string;
}

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
  | 'ATTACHMENT_VIEWED'
  | 'CREDENTIAL_REVOKED'
  | 'TRUST_REGISTRY_UPDATED';


export interface AuditEntry {
  id: number;
  eventType: AuditEventType;
  citizenId: number | null;
  verifierId: number | null;
  credentialId: number | null;
  issuerId?: number | null;
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
  credential?: unknown;
  encoding: string;
  bitstring: string;
  bitsRawLength: number;
  nextIndex: number;
  revoked: { index: number; credentialId: number | null; type: string }[];
  updatedAt: string;
}

/* ---------------- auth ---------------- */

export type AccountKind = 'citizen' | 'organization' | 'issuer' | 'verifier' | 'admin';

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

export interface OrganizationSession {
  token: string;
  organization: Organization;
  issuer?: Issuer;
}

export interface VerifierSession {
  token: string;
  verifier: Verifier;
}

export interface AdminSession {
  token: string;
  admin: { id: number; name: string; email: string };
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
