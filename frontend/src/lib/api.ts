/**
 * Tiny typed wrapper around fetch + one function per API endpoint.
 *
 * Every call throws an `ApiError` carrying the backend's message, so each tab
 * can show a real error state instead of "something went wrong".
 */
import type {
  AccountKind,
  AuditResponse,
  Citizen,
  CitizenSession,
  CitizenVerifications,
  ChainStatus,
  Consent,
  Credential,
  Issuer,
  IssuedCredential,
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
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export const api = {
  health: () => get<{ status: string; time: string }>('/health'),

  // auth
  citizenLogin: (email: string, password: string) =>
    post<CitizenSession>('/auth/citizen/login', { email, password }),
  citizenRegister: (name: string, email: string, password: string) =>
    post<CitizenSession>('/auth/citizen/register', { name, email, password }),
  verifierLogin: (email: string, password: string) =>
    post<VerifierSession>('/auth/verifier/login', { email, password }),
  verifierRegister: (name: string, email: string, password: string) =>
    post<VerifierSession>('/auth/verifier/register', { name, email, password }),
  me: () => get<{ kind: AccountKind; citizen?: Citizen; verifier?: Verifier }>('/auth/me'),

  // actors + trust registry
  citizens: () => get<{ citizens: Citizen[] }>('/citizens'),
  verifiers: () => get<{ verifiers: Verifier[] }>('/verifiers'),
  issuers: () => get<{ issuers: Issuer[] }>('/trust-registry/issuers'),
  trustIssuer: (id: number) => post<{ issuer: Issuer }>(`/trust-registry/issuers/${id}/trust`, {}),
  untrustIssuer: (id: number) => del<{ issuer: Issuer }>(`/trust-registry/issuers/${id}/trust`),

  // issuer portal
  issueCredential: (input: {
    issuerId: number;
    citizenId: number;
    type: string;
    claims: Record<string, unknown>;
    expiresInDays: number;
  }) => post<{ credential: Credential; message: string }>('/issuer/credentials', input),
  issuerCredentials: (issuerId: number) =>
    get<{ issuer: Issuer; credentials: IssuedCredential[] }>(`/issuer/credentials?issuerId=${issuerId}`),
  revokeCredential: (id: number, reason?: string) =>
    post<{ message: string; alreadyRevoked: boolean }>(`/issuer/credentials/${id}/revoke`, { reason }),

  // wallet
  wallet: (citizenId: number) => get<WalletResponse>(`/wallet/credentials?citizenId=${citizenId}`),
  consents: (citizenId: number) => get<{ citizen: Citizen; consents: Consent[] }>(`/wallet/consents?citizenId=${citizenId}`),
  verifications: (citizenId: number) =>
    get<CitizenVerifications>(`/wallet/verifications?citizenId=${citizenId}`),
  share: (input: {
    citizenId: number;
    verifierId: number;
    credentialId: number;
    purpose: string;
    fields: string[];
    duration: string;
  }) => post<ShareResult>('/wallet/presentations', input),
  endConsent: (consentId: number) => post<{ message?: string; consent: Consent }>(`/wallet/consents/${consentId}/revoke`, {}),

  // verifier
  verify: (input: { verifierId: number; consentId: number; presentation: string }) =>
    post<VerifyResponse>('/verifier/verify', input),
  verifierProfile: () => get<VerifierProfile>('/verifier/profile'),

  // revocation + audit
  statusList: (issuerId: number) => get<StatusList>(`/status-lists/${issuerId}`),
  audit: (limit = 200) => get<AuditResponse>(`/audit?limit=${limit}`),
  auditVerify: () => get<ChainStatus>('/audit/verify'),
};
