/**
 * W3C Verifiable Credentials Data Model 2.0 representation.
 *
 * Reference: https://www.w3.org/TR/vc-data-model-2.0/ (Recommendation)
 *
 * What this module does: build the canonical VC JSON for every credential we
 * issue, so the data model underneath our SD-JWT transport is standards-shaped:
 * `@context`, `id`, `type`, `issuer`, `validFrom`/`validUntil`,
 * `credentialSubject` (with the holder DID as `id`), `credentialStatus`
 * (a BitstringStatusListEntry), and `credentialSchema`.
 *
 * Honest scope note: transport + selective disclosure use SD-JWT (RFC 9901),
 * not the `vc+sd-jwt` secured-VC envelope with full JSON-LD processing. We do
 * not run a JSON-LD processor and do not claim Linked Data proofs. The VC JSON
 * is the signed semantic content (every credentialSubject property becomes an
 * SD disclosure) and is stored/displayable as `vc_json`.
 */
export interface VcCredentialStatus {
  id: string;
  type: 'BitstringStatusListEntry';
  statusPurpose: 'revocation';
  statusListIndex: number;
  statusListCredential: string;
}

export interface VerifiableCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  validUntil: string;
  credentialSubject: Record<string, unknown> & { id: string };
  credentialStatus: VcCredentialStatus;
  credentialSchema: { id: string; type: 'JsonSchema' };
}

export interface BuildVcInput {
  /** Stable credential id, e.g. `urn:gitlink:credential:42`. */
  id: string;
  issuerDid: string;
  subjectDid: string;
  /** e.g. "DegreeCredential". Must be a known schema type. */
  type: string;
  /** Already schema-validated claims (see schemas.ts). */
  claims: Record<string, unknown>;
  validFrom: Date;
  validUntil: Date;
  statusListUrl: string;
  statusIndex: number;
}

export function buildVc(input: BuildVcInput): VerifiableCredential {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: input.id,
    type: ['VerifiableCredential', input.type],
    issuer: input.issuerDid,
    validFrom: input.validFrom.toISOString(),
    validUntil: input.validUntil.toISOString(),
    credentialSubject: { ...input.claims, id: input.subjectDid },
    credentialStatus: {
      id: `${input.statusListUrl}#${input.statusIndex}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: input.statusIndex,
      statusListCredential: input.statusListUrl,
    },
    credentialSchema: {
      id: `gitlink:${input.type}:1`,
      type: 'JsonSchema',
    },
  };
}

/** Structural sanity check of a stored VC (used by wallet display code). */
export function isVcShape(value: unknown): value is VerifiableCredential {
  if (typeof value !== 'object' || value === null) return false;
  const vc = value as Record<string, unknown>;
  return (
    Array.isArray(vc['@context']) &&
    typeof vc.id === 'string' &&
    Array.isArray(vc.type) &&
    typeof vc.issuer === 'string' &&
    typeof vc.credentialSubject === 'object' &&
    vc.credentialSubject !== null
  );
}
