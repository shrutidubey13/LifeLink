/**
 * Document type → credential type mapping (Flow B).
 * Any trusted organization can issue any document name.
 */
import type { CredentialType } from './schemas';

export const DOCUMENT_TYPE_MAP: Record<string, { credentialType: CredentialType; orgTypes: string[] }> = {
  Document: { credentialType: 'DocumentCredential', orgTypes: [] },
  DocumentCredential: { credentialType: 'DocumentCredential', orgTypes: [] },
  // Legacy types kept for backward compatibility with existing rows
  Degree: { credentialType: 'DegreeCredential', orgTypes: [] },
  Employment: { credentialType: 'EmploymentCredential', orgTypes: [] },
  KYC: { credentialType: 'BankCustomerCredential', orgTypes: [] },
  Health: { credentialType: 'HealthCredential', orgTypes: [] },
};

export function normalizeDocumentType(input: string): string {
  const trimmed = input.trim();
  return trimmed || 'Document';
}

export function credentialTypeForDocument(documentType: string): CredentialType {
  const trimmed = documentType.trim();
  if (DOCUMENT_TYPE_MAP[trimmed]) return DOCUMENT_TYPE_MAP[trimmed].credentialType;
  return 'DocumentCredential';
}

/** Any trusted organization can issue any document name */
export function eligibleOrgTypesForDocument(_documentType: string): string[] | null {
  return null;
}
