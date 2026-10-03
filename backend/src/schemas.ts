/**
 * Credential schemas — the allow-list of what an issuer may sign.
 *
 * Before this file existed, ANY JSON object could be signed into a credential,
 * including attacker-shaped structures. Now every issuance validates `claims`
 * against the zod schema for its type (`.strict()` — unknown fields are
 * REJECTED, not silently kept), and verification re-validates the stored
 * credentialSubject (the `schema_valid` check).
 *
 * Canonical claim names follow the brief (§6). Flat scalar claims only: nested
 * objects/arrays are rejected because SD-JWT selective disclosure in this
 * prototype operates per top-level credentialSubject property (documented in
 * the README as a hackathon subset).
 */
import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be a real calendar date');

const degreeSchema = z
  .object({
    name: z.string().min(1).max(200),
    degree: z.string().min(1).max(200),
    university: z.string().min(1).max(200),
    graduationYear: z.number().int().min(1950).max(2100),
    fieldOfStudy: z.string().min(1).max(200).optional(),
    studentId: z.string().min(1).max(100).optional(),
  })
  .strict();

const employmentSchema = z
  .object({
    employmentStatus: z.string().min(1).max(50),
    employer: z.string().min(1).max(200),
    jobTitle: z.string().min(1).max(200),
    joiningDate: isoDate,
    salary: z.number().nonnegative().max(1_000_000_000).optional(),
    address: z.string().min(1).max(300).optional(),
    employeeId: z.string().min(1).max(100).optional(),
    offerLetterNumber: z.string().min(1).max(100).optional(),
  })
  .strict();

const bankCustomerSchema = z
  .object({
    customerName: z.string().min(1).max(200),
    accountType: z.string().min(1).max(100),
    kycStatus: z.string().min(1).max(50),
    aadhaarLast4: z
      .string()
      .regex(/^\d{4}$/, 'must be exactly 4 digits')
      .optional(),
    panMasked: z.string().min(1).max(50).optional(),
  })
  .strict();

const healthSchema = z
  .object({
    fullName: z.string().min(1).max(200),
    bloodGroup: z.string().min(1).max(10),
    fitnessStatus: z.string().min(1).max(100),
    insuranceId: z.string().min(1).max(100).optional(),
  })
  .strict();

export const CREDENTIAL_SCHEMAS = {
  DegreeCredential: degreeSchema,
  EmploymentCredential: employmentSchema,
  BankCustomerCredential: bankCustomerSchema,
  HealthCredential: healthSchema,
} as const;

export type CredentialType = keyof typeof CREDENTIAL_SCHEMAS;

/** The four types the issuer portal may sign. Anything else is rejected. */
export const CREDENTIAL_TYPES = Object.keys(CREDENTIAL_SCHEMAS) as CredentialType[];

export function isCredentialType(value: unknown): value is CredentialType {
  return typeof value === 'string' && (CREDENTIAL_TYPES as string[]).includes(value);
}

export interface SchemaValidation {
  ok: boolean;
  /** Canonical (zod-parsed) claims when valid. */
  claims?: Record<string, unknown>;
  /** Human-readable reasons when invalid. */
  issues?: string[];
}

/** Validate raw issuance input against the schema for `type`. */
export function validateClaims(type: string, claims: unknown): SchemaValidation {
  if (!isCredentialType(type)) {
    return {
      ok: false,
      issues: [`Unknown credential type "${String(type)}". Allowed: ${CREDENTIAL_TYPES.join(', ')}`],
    };
  }
  const parsed = CREDENTIAL_SCHEMAS[type].safeParse(claims);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { ok: true, claims: parsed.data as Record<string, unknown> };
}

/** Field names a verifier may request for a type (used by the request UI). */
export function schemaFields(type: CredentialType): string[] {
  return Object.keys(CREDENTIAL_SCHEMAS[type].shape);
}

/** Required (non-optional) field names, for friendly request defaults. */
export function requiredFields(type: CredentialType): string[] {
  const shape = CREDENTIAL_SCHEMAS[type].shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape)
    .filter(([, field]) => !(field instanceof z.ZodOptional))
    .map(([name]) => name);
}
