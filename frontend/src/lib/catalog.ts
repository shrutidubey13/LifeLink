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
    credentialType: 'BankKycCredential',
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

/** Example claims offered by the issuer portal when you pick a type. */
export const EXAMPLE_CLAIMS: Record<string, Record<string, unknown>> = {
  DegreeCredential: {
    degree: 'Bachelor of Technology',
    university: 'Demo University',
    field_of_study: 'Computer Science',
    year_of_graduation: 2025,
    student_id: 'LL-2025-0001',
  },
  EmploymentCredential: {
    employer: 'Demo Employer Pvt Ltd',
    role: 'Software Engineer',
    status: 'employed',
    joined_on: '2025-08-01',
    salary: 1800000,
    offer_letter_number: 'EMP-OL-4471',
  },
  BankKycCredential: {
    bank: 'Demo Bank',
    account_type: 'Savings',
    kyc_status: 'verified',
    aadhaar_last4: '4821',
    pan_masked: 'ABCDE****K',
  },
  HealthCredential: {
    provider: 'Demo Hospital',
    blood_group: 'O+',
    condition_status: 'fit',
    insurance_id: 'INS-88213',
  },
};

/** Extra types the issuer portal offers. */
export const EXTRA_TYPES: Record<string, Record<string, unknown>> = {
  AddressCredential: {
    address: '42 Lake Road, Pune 411001',
    state: 'Maharashtra',
    pincode: '411001',
    verified_on: '2025-06-12',
  },
  VehicleCredential: {
    make: 'Demo Motors',
    model: 'Model E',
    registration: 'MH12AB1234',
    insurance_valid_till: '2027-03-31',
  },
};

/**
 * Friendly labels. Anything not listed is prettified automatically
 * ("field_of_study" -> "Field of study").
 */
const FIELD_LABELS: Record<string, string> = {
  status: 'Employment status',
  salary: 'Annual salary',
  offer_letter_number: 'Offer letter number',
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

/** The four types offered in the issuer portal, plus extras. */
export const ISSUER_TYPES: string[] = [...Object.keys(EXAMPLE_CLAIMS), ...Object.keys(EXTRA_TYPES)];

export function exampleClaimsFor(type: string): Record<string, unknown> {
  return EXAMPLE_CLAIMS[type] ?? EXTRA_TYPES[type] ?? { full_name: 'Demo Student' };
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

/** Purpose suggestions, so a demo never has to invent one. */
export const PURPOSE_SUGGESTIONS = [
  'Open a bank account (KYC)',
  'Prove I am currently employed',
  'Occupational health check for a new role',
  'Rent an apartment',
  'Apply for a loan',
];

/** Colour + label for each audit event type. */
export const EVENT_STYLES: Record<string, { label: string; className: string }> = {
  ISSUER_CREDENTIAL_ISSUED: { label: 'Credential issued', className: 'bg-indigo-50 text-indigo-700' },
  ISSUER_CREDENTIAL_REVOKED: { label: 'Credential revoked', className: 'bg-rose-50 text-rose-700' },
  CONSENT_GRANTED: { label: 'Consent granted', className: 'bg-sky-50 text-sky-700' },
  CONSENT_REVOKED: { label: 'Consent ended', className: 'bg-slate-100 text-slate-700' },
  VERIFICATION_GRANTED: { label: 'Verification granted', className: 'bg-emerald-50 text-emerald-700' },
  VERIFICATION_DENIED: { label: 'Verification denied', className: 'bg-rose-50 text-rose-700' },
  TRUST_REGISTRY_UPDATED: { label: 'Trust registry changed', className: 'bg-amber-50 text-amber-700' },
};
