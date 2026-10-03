/**
 * Tiny typed wrapper around fetch + one function per API endpoint.
 *
 * Every call throws an `ApiError` carrying the backend's message, so each tab
 * can show a real error state instead of "something went wrong".
 *
 * Identity rule: the backend derives WHO is calling from the Bearer token.
 * We never send citizenId/issuerId/verifierId to assert identity — those ids
 * only name the OTHER party (e.g. which citizen to issue to).
 */
import type {
  AccountKind,
  AdminSession,
  AuditResponse,
  ChainStatus,
  Citizen,
  CitizenSession,
  CitizenVerifications,
  Consent,
  Credential,
  DocumentRequest,
  Issuer,
  IssuedCredential,
  Organization,
  OrganizationSession,
  PresentationRequest,
  ShareResult,
  StatusList,
  Verifier,
  VerifierProfile,
  VerifierSession,
  VerifyResponse,
  WalletResponse,
} from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const TOKEN_KEY = 'lifelink_token';

/** Fired when the server rejects our token — the session listens and logs out. */
export const UNAUTHORIZED_EVENT = 'lifelink:unauthorized';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing etc. — the app still works for the session */
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      0,
      `Cannot reach the LifeLink API at ${API_BASE}. Is the backend running (npm run dev in /backend)?`,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed with HTTP ${response.status}`;
    // Our token was rejected: tell the session to log out everywhere at once.
    if (response.status === 401 && getStoredToken()) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(response.status, message, (body as { details?: unknown })?.details);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const api = {
  health: () => get<{ status: string; time: string }>('/health'),

  // auth (unified ORGANIZATION role + legacy aliases + admin)
  citizenLogin: (email: string, password: string) =>
    post<CitizenSession>('/auth/citizen/login', { email, password }),
  citizenRegister: (name: string, email: string, password: string) =>
    post<CitizenSession>('/auth/citizen/register', { name, email, password }),
  organizationLogin: (email: string, password: string) =>
    post<OrganizationSession>('/auth/organization/login', { email, password }),
  issuerLogin: (email: string, password: string) =>
    post<OrganizationSession>('/auth/issuer/login', { email, password }),
  verifierLogin: (email: string, password: string) =>
    post<VerifierSession>('/auth/verifier/login', { email, password }),
  verifierRegister: (name: string, email: string, password: string) =>
    post<VerifierSession>('/auth/verifier/register', { name, email, password }),
  adminLogin: (email: string, password: string) =>
    post<AdminSession>('/auth/admin/login', { email, password }),
  me: () =>
    get<{
      kind: AccountKind;
      citizen?: Citizen;
      organization?: Organization;
      issuer?: Issuer;
      verifier?: Verifier;
      admin?: { id: number; name: string; email: string };
    }>('/auth/me'),

  // actors + trust registry
  citizens: () => get<{ citizens: Citizen[] }>('/citizens'),
  verifiers: () => get<{ verifiers: Verifier[] }>('/verifiers'),
  issuers: () => get<{ issuers: Issuer[] }>('/trust-registry/issuers'),
  organizations: (documentType?: string) =>
    get<{ organizations: Organization[] }>(
      documentType ? `/organizations?documentType=${encodeURIComponent(documentType)}` : '/organizations',
    ),
  organizationProfile: () =>
    get<{ organization: Organization; linkedVerifier: Verifier; stats: Record<string, number> }>(
      '/organization/profile',
    ),

  // issuer / organization issuance (identity from JWT; no issuerId in body)
  issueCredential: (input: {
    citizenId: number;
    type: string;
    claims: Record<string, unknown>;
    expiresInDays?: number;
  }) => post<{ credential: Credential; message: string; sdJwt: string }>('/issuer/credentials', input),
  issuerCredentials: () => get<{ issuer: Issuer; credentials: IssuedCredential[] }>('/issuer/credentials'),
  revokeCredential: (id: number) =>
    post<{ message: string; alreadyRevoked: boolean }>(`/issuer/credentials/${id}/revoke`, {}),

  // document verification flow (Flow B)
  submitDocument: (input: {
    documentType: string;
    documentName: string;
    documentRef: string;
    mimeType?: string;
    organizationId: number;
    purpose: string;
  }) => post<{ document: DocumentRequest; message: string }>('/wallet/documents', input),
  myDocuments: () => get<{ documents: DocumentRequest[] }>('/wallet/documents'),
  orgDocuments: (status?: string) =>
    get<{ documents: DocumentRequest[] }>(
      status ? `/organization/documents?status=${encodeURIComponent(status)}` : '/organization/documents',
    ),
  orgDocument: (id: number) =>
    get<{ document: DocumentRequest; suggestedCredentialType: string }>(`/organization/documents/${id}`),
  approveDocument: (id: number, input: { claims: Record<string, unknown>; expiresInDays?: number }) =>
    post<{ document: DocumentRequest; credential: Credential; message: string }>(
      `/organization/documents/${id}/approve`,
      input,
    ),
  rejectDocument: (id: number, reason: string) =>
    post<{ document: DocumentRequest; message: string }>(`/organization/documents/${id}/reject`, { reason }),

  // wallet (identity from JWT; no citizenId query params)
  wallet: () => get<WalletResponse>('/wallet/credentials'),
  walletRequests: () => get<{ requests: PresentationRequest[] }>('/wallet/requests'),
  approveRequest: (id: number, input: { credentialId: number; fields: string[] }) =>
    post<ShareResult>(`/wallet/requests/${id}/approve`, input),
  rejectRequest: (id: number) => post<{ consent: Consent }>(`/wallet/requests/${id}/reject`, {}),
  consents: () => get<{ consents: Consent[] }>('/wallet/consents'),
  verifications: () => get<CitizenVerifications>('/wallet/verifications'),
  share: (input: {
    verifierId?: number;
    organizationId?: number;
    credentialId: number;
    purpose: string;
    fields: string[];
    duration: string;
  }) => {
    // Citizen-initiated share targets a legacy verifier id. When the UI picks
    // an ORGANIZATION, resolve via organizations list is unnecessary: the
    // backend linked-verifier shares the org DID, but /wallet/presentations
    // still expects verifierId. For org targets we look up the linked verifier
    // lazily is server-side concern — here we require verifierId. Org-aware
    // shares go through the request/approve flow instead.
    if (input.organizationId !== undefined && input.verifierId === undefined) {
      throw new Error('Direct share needs a verifierId; use the request flow for organizations.');
    }
    return post<ShareResult>('/wallet/presentations', {
      verifierId: input.verifierId,
      credentialId: input.credentialId,
      purpose: input.purpose,
      fields: input.fields,
      duration: input.duration,
    });
  },
  endConsent: (consentId: number) =>
    post<{ message?: string; consent: Consent }>(`/wallet/consents/${consentId}/revoke`, {}),

  // verifier (legacy) — presentation only, request resolved server-side
  verify: (presentation: string) => post<VerifyResponse>('/verifier/verify', { presentation }),
  verifierProfile: () => get<VerifierProfile>('/verifier/profile'),
  verifierRequests: () => get<{ requests: PresentationRequest[] }>('/verifier/requests'),
  createVerifierRequest: (input: {
    citizenId: number;
    credentialType: string;
    requestedFields: string[];
    purpose: string;
    ttlMinutes?: number;
  }) => post<{ request: PresentationRequest; consent: Consent }>('/verifier/requests', input),

  // organization as verifier (unified role)
  createOrgRequest: (input: {
    citizenId: number;
    credentialType: string;
    requestedFields: string[];
    purpose: string;
    ttlMinutes?: number;
  }) => post<{ request: PresentationRequest; consent: Consent }>('/organization/requests', input),
  orgRequests: () => get<{ organization: Organization; requests: PresentationRequest[] }>('/organization/requests'),
  orgVerify: (presentation: string) => post<VerifyResponse>('/organization/verify', { presentation }),

  // revocation + audit (role-scoped)
  statusList: (issuerId: number) => get<StatusList>(`/status-lists/${issuerId}`),
  walletAudit: (limit = 100) => get<AuditResponse>(`/wallet/audit?limit=${limit}`),
  orgAudit: (limit = 100) => get<AuditResponse>(`/organization/audit?limit=${limit}`),
  adminAudit: (limit = 100) => get<AuditResponse>(`/admin/audit?limit=${limit}`),
  adminAuditVerify: () => get<ChainStatus>('/admin/audit/verify'),

  // admin trust registry
  adminIssuers: () => get<{ issuers: Issuer[] }>('/admin/issuers'),
  adminCreateIssuer: (input: {
    name: string;
    domain: string;
    email: string;
    password: string;
    orgType?: string;
    canIssue?: boolean;
    canVerify?: boolean;
  }) => post<{ issuer: Issuer }>('/admin/issuers', input),
  adminSetIssuerStatus: (id: number, status: string) =>
    post<{ issuer: Issuer; unchanged: boolean }>(`/admin/issuers/${id}/status`, { status }),
};
