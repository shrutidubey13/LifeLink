/**
 * Document type → credential type + eligible organization types (Flow B).
 * Pure mapping (no DB) so the crypto self-test can cover it.
 */
import type { CredentialType } from './schemas';

export const DOCUMENT_TYPE_MAP: Record<string, { credentialType: CredentialType; orgTypes: string[] }> = {
  Degree: { credentialType: 'DegreeCredential', orgTypes: ['University', 'College', 'School'] },
  BCA_Degree: { credentialType: 'DegreeCredential', orgTypes: ['University', 'College', 'School'] },
  Education: { credentialType: 'DegreeCredential', orgTypes: ['University', 'College', 'School'] },
  Employment: { credentialType: 'EmploymentCredential', orgTypes: ['Employer'] },
  EmploymentStatus: { credentialType: 'EmploymentCredential', orgTypes: ['Employer'] },
  KYC: { credentialType: 'BankCustomerCredential', orgTypes: ['Bank'] },
  BankKYC: { credentialType: 'BankCustomerCredential', orgTypes: ['Bank'] },
  Health: { credentialType: 'HealthCredential', orgTypes: ['Hospital'] },
  Medical: { credentialType: 'HealthCredential', orgTypes: ['Hospital'] },
};

export function normalizeDocumentType(input: string): string {
  const trimmed = input.trim();
  if (DOCUMENT_TYPE_MAP[trimmed]) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.includes('degree') || lower.includes('bca') || lower.includes('education')) return 'Degree';
  if (lower.includes('employ') || lower.includes('offer') || lower.includes('salary')) return 'Employment';
  if (lower.includes('kyc') || lower.includes('bank') || lower.includes('pan') || lower.includes('aadhaar')) return 'KYC';
  if (lower.includes('health') || lower.includes('medical') || lower.includes('fitness') || lower.includes('blood')) return 'Health';
  return trimmed;
}

export function credentialTypeForDocument(documentType: string): CredentialType {
  const key = normalizeDocumentType(documentType);
  return DOCUMENT_TYPE_MAP[key]?.credentialType ?? 'DegreeCredential';
}

export function eligibleOrgTypesForDocument(documentType: string): string[] | null {
  const key = normalizeDocumentType(documentType);
  return DOCUMENT_TYPE_MAP[key]?.orgTypes ?? null;
}
