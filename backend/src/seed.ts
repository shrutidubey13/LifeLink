/**
 * Seed script — creates the GitLink world, IDEMPOTENTLY.
 *
 *   npm run seed            (adds anything missing, keeps existing data)
 *   npm run seed:reset      (wipes all tables first, for a clean seed)
 *
 * Identity rule (§4): if a row already exists, its DID and key material are
 * KEPT — never regenerated. Regenerating an issuer key would silently break
 * every credential it ever signed; regenerating a holder DID/key would orphan
 * the student's wallet. Only login emails/passwords are backfilled (those
 * don't affect signatures).
 */
import { applySchema, closePool, query, queryOne } from './db';
import { didKeyFromPublicJwk, didWeb, generateEd25519KeyPair } from './crypto';
import { encryptPrivateJwk } from './keystore';
import { INITIAL_BITS_BYTES } from './statusList';
import { hashPassword } from './auth';
import type { CitizenRow, IssuerRow, VerifierRow, AdminRow } from './types';

const RESET = process.argv.includes('--reset');

export const SHARED_PASSWORD = 'gitlink123';

interface IssuerSeed {
  name: string;
  domain: string;
  email: string;
  legacyEmail?: string;
  status: 'TRUSTED' | 'SUSPENDED';
  orgType: string;
  canIssue: boolean;
  canVerify: boolean;
}

const ORGANIZATIONS: IssuerSeed[] = [
  {
    name: 'XIE University',
    domain: 'university.gitlink',
    email: 'university@gitlink.org',
    status: 'TRUSTED',
    orgType: 'University',
    canIssue: true,
    canVerify: true,
  },
  {
    name: 'TechNova Pvt Ltd',
    domain: 'technova.gitlink',
    email: 'technova@gitlink.org',
    status: 'TRUSTED',
    orgType: 'Employer',
    canIssue: true,
    canVerify: true,
  },
  {
    name: 'ABC Bank',
    domain: 'bank.gitlink',
    email: 'bank@gitlink.org',
    status: 'TRUSTED',
    orgType: 'Bank',
    canIssue: true,
    canVerify: true,
  },
  {
    name: 'City Care Hospital',
    domain: 'hospital.gitlink',
    email: 'hospital@gitlink.org',
    status: 'TRUSTED',
    orgType: 'Hospital',
    canIssue: true,
    canVerify: true,
  },
  // Suspended fake institution to show the trust registry denying it
  {
    name: 'Apex Institute',
    domain: 'apex.gitlink',
    email: 'apex@gitlink.org',
    status: 'SUSPENDED',
    orgType: 'College',
    canIssue: true,
    canVerify: false,
  },
];

const STUDENTS = [
  { name: 'Aarav Sharma', email: 'aarav.sharma@gitlink.org' },
  { name: 'Priya Nair', email: 'priya.nair@gitlink.org' },
  { name: 'Rohan Mehta', email: 'rohan.mehta@gitlink.org' },
  { name: 'Sneha Iyer', email: 'sneha.iyer@gitlink.org' },
  { name: 'Maryam Shaikh', email: 'maryam.shaikh@gitlink.org' },
];

const VERIFIERS = [
  { name: 'ABC Bank Verifier', domain: 'bank-verify.gitlink', email: 'bank-verify@gitlink.org' },
  { name: 'TechNova HR Verifier', domain: 'hr.gitlink', email: 'hr@gitlink.org' },
];

const ADMIN = { name: 'GitLink Admin', email: 'admin@gitlink.org' };

async function reset(): Promise<void> {
  console.log('⚠ --reset given: truncating all tables');
  // Check if document_files table exists
  const hasFiles = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_name = 'document_files'
     ) as exists`,
  );
  const extra = hasFiles?.exists ? ', document_files' : '';
  await query(`TRUNCATE audit_log, consents, presentation_requests, credential_offers,
               issuance_tokens, credentials, status_lists, verifiers, citizens, issuers, admins,
               document_requests${extra}
               RESTART IDENTITY CASCADE`);
}

async function seedIssuer(seed: IssuerSeed, passwordHash: string): Promise<IssuerRow> {
  const existing = await queryOne<IssuerRow>('SELECT * FROM issuers WHERE domain = $1 OR email = $2', [
    seed.domain,
    seed.email,
  ]);

  if (existing) {
    const updated = await queryOne<IssuerRow>(
      `UPDATE issuers
       SET name = $1,
           email = $2,
           password_hash = COALESCE(password_hash, $3),
           status = COALESCE(status, $4),
           org_type = COALESCE(org_type, $5),
           can_issue = COALESCE(can_issue, $6),
           can_verify = COALESCE(can_verify, $7)
       WHERE id = $8 RETURNING *`,
      [seed.name, seed.email, passwordHash, seed.status, seed.orgType, seed.canIssue, seed.canVerify, existing.id],
    );
    const row = updated as IssuerRow;
    await ensureLinkedVerifierRow(row, passwordHash);
    return row;
  }

  // New issuer: fresh keypair, stored ENCRYPTED
  const { publicJwk, privateJwk } = await generateEd25519KeyPair();
  const inserted = await queryOne<IssuerRow>(
    `INSERT INTO issuers (name, domain, did, public_jwk, private_jwk, private_key_enc,
                          trusted, status, email, password_hash, org_type, can_issue, can_verify)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [
      seed.name,
      seed.domain,
      didWeb(seed.domain),
      publicJwk,
      publicJwk,
      JSON.stringify(encryptPrivateJwk(privateJwk)),
      seed.status === 'TRUSTED',
      seed.status,
      seed.email,
      passwordHash,
      seed.orgType,
      seed.canIssue,
      seed.canVerify,
    ],
  );
  const row = inserted as IssuerRow;
  await ensureLinkedVerifierRow(row, passwordHash);
  return row;
}

/** Linked verifier sharing the org DID (same did:web), for org-as-verifier. */
async function ensureLinkedVerifierRow(issuer: IssuerRow, passwordHash: string): Promise<void> {
  const existing = await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE did = $1', [issuer.did]);
  if (existing) {
    await query(
      `UPDATE verifiers SET password_hash = COALESCE(password_hash, $1),
        email = COALESCE(email, $2) WHERE id = $3`,
      [passwordHash, issuer.email, existing.id],
    );
    return;
  }
  const email = issuer.email ?? `org-${issuer.id}@gitlink.local`;
  const clash = await queryOne<VerifierRow>('SELECT id FROM verifiers WHERE email = $1', [email]);
  const finalEmail = clash ? `org-${issuer.id}@gitlink.local` : email;
  await query(
    'INSERT INTO verifiers (name, did, email, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [issuer.name, issuer.did, finalEmail, passwordHash],
  );
}

async function seedStudent(student: { name: string; email: string }, passwordHash: string): Promise<CitizenRow> {
  const existing =
    (await queryOne<CitizenRow>('SELECT * FROM citizens WHERE email = $1', [student.email])) ??
    (await queryOne<CitizenRow>('SELECT * FROM citizens WHERE name = $1', [student.name]));

  if (existing) {
    const updated = await queryOne<CitizenRow>(
      `UPDATE citizens SET name = $1, email = $2, password_hash = COALESCE(password_hash, $3)
       WHERE id = $4 RETURNING *`,
      [student.name, student.email, passwordHash, existing.id],
    );
    return updated as CitizenRow;
  }

  // New student: fresh holder identity (did:key + KB signing key, encrypted)
  const { publicJwk, privateJwk } = await generateEd25519KeyPair();
  const inserted = await queryOne<CitizenRow>(
    `INSERT INTO citizens (name, did, public_jwk, private_jwk_enc, email, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      student.name,
      didKeyFromPublicJwk(publicJwk),
      publicJwk,
      JSON.stringify(encryptPrivateJwk(privateJwk)),
      student.email,
      passwordHash,
    ],
  );
  return inserted as CitizenRow;
}

async function seedVerifier(
  name: string,
  domain: string,
  email: string,
  passwordHash: string,
): Promise<VerifierRow> {
  const existing =
    (await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE did = $1', [didWeb(domain)])) ??
    (await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE name = $1', [name]));
  if (existing) {
    const updated = await queryOne<VerifierRow>(
      `UPDATE verifiers SET email = COALESCE(email, $2), password_hash = COALESCE(password_hash, $3)
       WHERE id = $4 RETURNING *`,
      [didWeb(domain), email, passwordHash, existing.id],
    );
    return updated as VerifierRow;
  }
  const inserted = await queryOne<VerifierRow>(
    'INSERT INTO verifiers (name, did, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, didWeb(domain), email, passwordHash],
  );
  return inserted as VerifierRow;
}

async function seedAdmin(passwordHash: string): Promise<AdminRow> {
  const existing = await queryOne<AdminRow>('SELECT * FROM admins WHERE email = $1', [ADMIN.email]);

  if (existing) {
    const updated = await queryOne<AdminRow>(
      'UPDATE admins SET name = $1, email = $2, password_hash = COALESCE(password_hash, $3) WHERE id = $4 RETURNING *',
      [ADMIN.name, ADMIN.email, passwordHash, existing.id],
    );
    return updated as AdminRow;
  }
  const inserted = await queryOne<AdminRow>(
    'INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
    [ADMIN.name, ADMIN.email, passwordHash],
  );
  return inserted as AdminRow;
}

async function main(): Promise<void> {
  await applySchema();
  if (RESET) await reset();

  const passwordHash = await hashPassword(SHARED_PASSWORD);

  const issuers: IssuerRow[] = [];
  for (const seed of ORGANIZATIONS) {
    issuers.push(await seedIssuer(seed, passwordHash));
  }

  for (const issuer of issuers) {
    await query(
      `INSERT INTO status_lists (issuer_id, bits, next_index)
       VALUES ($1, $2, 0) ON CONFLICT (issuer_id) DO NOTHING`,
      [issuer.id, Buffer.alloc(INITIAL_BITS_BYTES, 0)],
    );
  }

  const seededStudents: CitizenRow[] = [];
  for (const s of STUDENTS) {
    seededStudents.push(await seedStudent(s, passwordHash));
  }

  const verifiers: VerifierRow[] = [];
  for (const v of VERIFIERS) {
    verifiers.push(await seedVerifier(v.name, v.domain, v.email, passwordHash));
  }
  const admin = await seedAdmin(passwordHash);

  // ------------------------------------------------------------------
  // Clean table output
  // ------------------------------------------------------------------
  const accountRows: Array<{ role: string; name: string; email: string; password: string }> = [];

  for (const s of seededStudents) {
    accountRows.push({ role: 'Student', name: s.name, email: s.email ?? '', password: SHARED_PASSWORD });
  }

  for (const org of issuers) {
    accountRows.push({
      role: `Organization (${org.org_type ?? 'Issuer'})`,
      name: org.name,
      email: org.email ?? '',
      password: SHARED_PASSWORD,
    });
  }

  for (const v of verifiers) {
    accountRows.push({ role: 'Verifier', name: v.name, email: v.email ?? '', password: SHARED_PASSWORD });
  }

  accountRows.push({ role: 'Admin', name: admin.name, email: admin.email, password: SHARED_PASSWORD });

  console.log('\nGitLink seed data is ready.\n');
  console.table(accountRows);
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('✖ Seed failed');
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
