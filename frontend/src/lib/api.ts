/**
 * Tiny typed wrapper around fetch + one function per API endpoint.
 *
 * Every call throws an `ApiError` carrying the backend's message, so each tab
 * can show a real error state instead of "something went wrong".
 */
import type {
  AuditResponse,
  Citizen,
  ChainStatus,
  Consent,
  Credential,
  Issuer,
  IssuedCredential,
  ShareResult,
  StatusList,
  Verifier,
  VerifyResponse,
  WalletResponse,
} from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');

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
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
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

  // revocation + audit
  statusList: (issuerId: number) => get<StatusList>(`/status-lists/${issuerId}`),
  audit: (limit = 200) => get<AuditResponse>(`/audit?limit=${limit}`),
  auditVerify: () => get<ChainStatus>('/audit/verify'),
};
