/**
 * The life-stage catalog: which credential belongs to which stage, how to label
 * its fields in plain language, and example claims for the issuer portal.
 *
 * This is presentation-only metadata. The backend stores whatever claims it is
 * given, so an issuer can invent new fields and they will still work.
 */

export type StageId = 'education' | 'employment' | 'finance' | 'healthcare';

export interface Stage {
  id: StageId;
  label: string;
  short: string;
  /** The credential type that turns this stage green. */
  credentialType: string;
  icon: string;
  blurb: string;
}

export const STAGES: Stage[] = [
  {
    id: 'education',
    label: 'Education',
    short: 'School, college, university',
    credentialType: 'DegreeCredential',
    icon: '🎓',
    blurb: 'Degrees and marksheets',
  },
  {
    id: 'employment',
    label: 'Employment',
    short: 'Jobs and salary records',
    credentialType: 'EmploymentCredential',
    icon: '💼',
    blurb: 'Job title, status, salary',
  },
  {
    id: 'finance',
    label: 'Finance',
    short: 'Bank and insurance KYC',
    credentialType: 'BankCustomerCredential',
    icon: '🏦',
    blurb: 'KYC, account and policy details',
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    short: 'Health and fitness records',
    credentialType: 'HealthCredential',
    icon: '🩺',
    blurb: 'Blood group, fitness, coverage',
  },
];

export const EXAMPLE_CLAIMS: Record<string, Record<string, unknown>> = {
  DocumentCredential: {
    documentName: 'Bachelor of Computer Applications',
    category: 'Education',
    holderName: 'Aarav Sharma',
    issuedDate: '2026-05-15',
    description: 'Undergraduate degree with first class distinction',
  },
  DegreeCredential: {
    name: 'Aarav Sharma',
    degree: 'BCA Computer Applications',
    university: 'XIE University',
    graduationYear: 2026,
    fieldOfStudy: 'Computer Applications',
    studentId: 'GL-2026-0001',
  },
  EmploymentCredential: {
    employmentStatus: 'employed',
    employer: 'TechNova Pvt Ltd',
    jobTitle: 'Software Engineer',
    joiningDate: '2025-08-01',
    employeeId: 'EMP-4471',
  },
  BankCustomerCredential: {
    customerName: 'Aarav Sharma',
    accountType: 'Savings',
    kycStatus: 'verified',
    aadhaarLast4: '4821',
    panMasked: 'ABCDE****K',
  },
  HealthCredential: {
    fullName: 'Aarav Sharma',
    bloodGroup: 'O+',
    fitnessStatus: 'fit',
    insuranceId: 'INS-88213',
  },
};

/** Extra types the issuer portal offers. */
export const EXTRA_TYPES: Record<string, Record<string, unknown>> = {};


/**
 * Friendly labels. Anything not listed is prettified automatically
 * ("field_of_study" -> "Field of study").
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Full name',
  degree: 'Qualification',
  university: 'University',
  graduationYear: 'Graduation year',
  fieldOfStudy: 'Field of study',
  studentId: 'Student ID',
  employmentStatus: 'Employment status',
  employer: 'Employer',
  jobTitle: 'Job title',
  joiningDate: 'Joining date',
  salary: 'Annual salary',
  employeeId: 'Employee ID',
  offerLetterNumber: 'Offer letter number',
  customerName: 'Customer name',
  accountType: 'Account type',
  kycStatus: 'KYC status',
  fullName: 'Full name',
  bloodGroup: 'Blood group',
  fitnessStatus: 'Fitness status',
  insuranceId: 'Insurance ID',
  address: 'Address',
  aadhaarLast4: 'Aadhaar (last 4 digits)',
  panMasked: 'PAN (masked)',
  status: 'Employment status',
  role: 'Job title',
  joined_on: 'Joined on',
  student_id: 'Student ID',
  year_of_graduation: 'Year of graduation',
  field_of_study: 'Field of study',
  blood_group: 'Blood group',
  condition_status: 'Fitness status',
  insurance_id: 'Insurance ID',
  aadhaar_last4: 'Aadhaar (last 4 digits)',
  pan_masked: 'PAN (masked)',
  account_type: 'Account type',
  kyc_status: 'KYC status',
  insurance_valid_till: 'Insurance valid till',
  verified_on: 'Verified on',
  registration: 'Registration number',
  model: 'Model',
  pincode: 'PIN code',
  condition: 'Condition',
};

export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How a claim value is shown in the UI. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Stage for a credential type, or null if the type is not part of the journey. */
export function stageForType(type: string): Stage | null {
  return STAGES.find((stage) => stage.credentialType === type) ?? null;
}

export function typeLabel(type: string): string {
  return type.replace(/Credential$/, '');
}

/** Generic DocumentCredential is the standard issuance type. */
export const ISSUER_TYPES: string[] = ['DocumentCredential'];

export function exampleClaimsFor(type: string): Record<string, unknown> {
  return EXAMPLE_CLAIMS[type] ?? EXAMPLE_CLAIMS.DocumentCredential;
}

/** Consent durations, matching the backend's DURATIONS map. */
export const DURATIONS = [
  { value: '5m', label: '5 minutes', short: '5 min' },
  { value: '30m', label: '30 minutes', short: '30 min' },
  { value: '1d', label: '1 day', short: '1 day' },
];

export function durationLabel(value: string): string {
  return DURATIONS.find((d) => d.value === value)?.label ?? value;
}

/** Purpose suggestions for requests. */
export const PURPOSE_SUGGESTIONS = [
  'Open a bank account (KYC)',
  'Prove academic qualifications for employment',
  'Prove current employment and salary',
  'Health and medical fitness verification',
  'Rental lease or mortgage application',
  'Loan eligibility check',
];

/** Colour + label for each audit event type. */
export const EVENT_STYLES: Record<string, { label: string; className: string }> = {
  CREDENTIAL_ISSUED: { label: 'Document issued', className: 'bg-indigo-50 text-indigo-700' },
  CREDENTIAL_RECEIVED: { label: 'Document received', className: 'bg-indigo-50 text-indigo-700' },
  DOCUMENT_SUBMITTED: { label: 'Document submitted', className: 'bg-sky-50 text-sky-700' },
  DOCUMENT_APPROVED: { label: 'Document approved', className: 'bg-emerald-50 text-emerald-700' },
  DOCUMENT_REJECTED: { label: 'Document rejected', className: 'bg-rose-50 text-rose-700' },
  CONSENT_REQUESTED: { label: 'Consent requested', className: 'bg-sky-50 text-sky-700' },
  CONSENT_APPROVED: { label: 'Consent granted', className: 'bg-sky-50 text-sky-700' },
  CONSENT_REJECTED: { label: 'Consent ended', className: 'bg-slate-100 text-slate-700' },
  CONSENT_DENIED: { label: 'Consent denied', className: 'bg-slate-100 text-slate-700' },
  CONSENT_REVOKED: { label: 'Consent ended', className: 'bg-slate-100 text-slate-700' },
  CREDENTIAL_PRESENTED: { label: 'Document shared', className: 'bg-sky-50 text-sky-700' },
  CREDENTIAL_SHARED: { label: 'Document shared', className: 'bg-sky-50 text-sky-700' },
  CREDENTIAL_VERIFIED: { label: 'Verification granted', className: 'bg-emerald-50 text-emerald-700' },
  VERIFICATION_FAILED: { label: 'Verification denied', className: 'bg-rose-50 text-rose-700' },
  ATTACHMENT_VIEWED: { label: 'Attachment viewed', className: 'bg-purple-50 text-purple-700' },
  CREDENTIAL_REVOKED: { label: 'Document revoked', className: 'bg-rose-50 text-rose-700' },
  TRUST_REGISTRY_UPDATED: { label: 'Trust registry changed', className: 'bg-amber-50 text-amber-700' },
  // Legacy aliases
  ISSUER_CREDENTIAL_ISSUED: { label: 'Document issued', className: 'bg-indigo-50 text-indigo-700' },
  ISSUER_CREDENTIAL_REVOKED: { label: 'Document revoked', className: 'bg-rose-50 text-rose-700' },
  CONSENT_GRANTED: { label: 'Consent granted', className: 'bg-sky-50 text-sky-700' },
  VERIFICATION_GRANTED: { label: 'Verification granted', className: 'bg-emerald-50 text-emerald-700' },
  VERIFICATION_DENIED: { label: 'Verification denied', className: 'bg-rose-50 text-rose-700' },
};

