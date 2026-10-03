/**
 * Seed script — creates the demo world, IDEMPOTENTLY.
 *
 *   npm run seed            (adds anything missing, keeps existing data)
 *   npm run seed -- --reset (wipes all tables first, for a clean demo)
 *
 * Identity rule (§4): if a row already exists, its DID and key material are
 * KEPT — never regenerated. Regenerating an issuer key would silently break
 * every credential it ever signed; regenerating a holder DID/key would orphan
 * the citizen's wallet. Only login emails/passwords are backfilled (those
 * don't affect signatures).
 *
 * Creates (if missing):
 *   Organizations (issuers table, ORGANIZATION role):
 *     ABC University / Demo University (University, issuer+verifier, TRUSTED)
 *     XYZ Company / Demo Employer (Employer, issuer+verifier, TRUSTED)
 *     ABC Bank / Demo Bank (Bank, issuer+verifier, TRUSTED)
 *     Demo Hospital (Hospital, issuer+verifier, TRUSTED)
 *     "Fake College" (SUSPENDED — used to demo a trust denial)
 *   Citizen  : Demo Student (did:key + holder key for KB signing)
 *   Verifiers: legacy rows + linked rows sharing each org DID (org-as-verifier)
 *   Admin    : Demo Admin
 *
 * Demo emails use lifelink.demo (spec) with demo.lifelink kept as fallback:
 * existing rows keep working; fresh seeds create lifelink.demo logins.
 */
import { applySchema, closePool, query, queryOne } from './db';
import { didKeyFromPublicJwk, didWeb, generateEd25519KeyPair } from './crypto';
import { encryptPrivateJwk } from './keystore';
import { INITIAL_BITS_BYTES } from './statusList';
import { hashPassword } from './auth';
import type { CitizenRow, IssuerRow, VerifierRow, AdminRow } from './types';

const RESET = process.argv.includes('--reset');

interface IssuerSeed {
  name: string;
  domain: string;
  email: string;
  /** Fallback email kept working for databases seeded before lifelink.demo. */
  legacyEmail?: string;
  status: 'TRUSTED' | 'SUSPENDED';
  orgType: string;
  canIssue: boolean;
  canVerify: boolean;
}

const ISSUERS: IssuerSeed[] = [
  { name: 'ABC University', domain: 'university.demo.lifelink', email: 'university@lifelink.demo', legacyEmail: 'university@demo.lifelink', status: 'TRUSTED', orgType: 'University', canIssue: true, canVerify: true },
  { name: 'XYZ Company', domain: 'employer.demo.lifelink', email: 'employer@lifelink.demo', legacyEmail: 'employer@demo.lifelink', status: 'TRUSTED', orgType: 'Employer', canIssue: true, canVerify: true },
  { name: 'ABC Bank', domain: 'bank-org.demo.lifelink', email: 'bank@lifelink.demo', legacyEmail: undefined, status: 'TRUSTED', orgType: 'Bank', canIssue: true, canVerify: true },
  { name: 'Demo Hospital', domain: 'hospital.demo.lifelink', email: 'hospital@lifelink.demo', legacyEmail: 'hospital@demo.lifelink', status: 'TRUSTED', orgType: 'Hospital', canIssue: true, canVerify: true },
  // Same key quality, same signatures — but SUSPENDED, so verifiers refuse
  // anything it signs. This is what the trust registry protects against.
  { name: 'Fake College', domain: 'fakecollege.demo.lifelink', email: 'fake@lifelink.demo', legacyEmail: 'fake@demo.lifelink', status: 'SUSPENDED', orgType: 'College', canIssue: true, canVerify: false },
];

const VERIFIERS = [
  { name: 'Demo Bank', domain: 'bank.demo.lifelink', email: 'bank@demo.lifelink', lifelinkEmail: 'bank-verify@lifelink.demo' },
  { name: 'Demo Employer HR', domain: 'hr.demo.lifelink', email: 'hr@demo.lifelink', lifelinkEmail: 'hr@lifelink.demo' },
];

const CITIZEN = { name: 'Demo Student', email: 'student@lifelink.demo', legacyEmail: 'student@demo.lifelink' };
const ADMIN = { name: 'Demo Admin', email: 'admin@lifelink.demo', legacyEmail: 'admin@demo.lifelink' };
const DEMO_PASSWORD = 'lifelink123';

async function reset(): Promise<void> {
  console.log('⚠ --reset given: truncating all tables');
  await query(`TRUNCATE audit_log, consents, presentation_requests, credential_offers,
               issuance_tokens, credentials, status_lists, verifiers, citizens, issuers, admins,
               document_requests
               RESTART IDENTITY CASCADE`);
}

async function seedIssuer(seed: IssuerSeed, demoPasswordHash: string): Promise<IssuerRow> {
  const existing = await queryOne<IssuerRow>('SELECT * FROM issuers WHERE domain = $1', [seed.domain]);
  if (existing) {
    // KEEP: did, keys, status. Only backfill the login if it never had one.
    // Migrate legacy demo.lifelink emails to lifelink.demo when the new
    // address is still free (DID/keys untouched — email never affects sigs).
    if (!existing.email && seed.email) {
      // no email yet: take the new one
    }
    let emailToKeep = existing.email ?? seed.email;
    if (existing.email === seed.legacyEmail) {
      const taken = await queryOne<IssuerRow>('SELECT id FROM issuers WHERE email = $1', [seed.email]);
      if (!taken) emailToKeep = seed.email;
    }
    const updated = await queryOne<IssuerRow>(
      `UPDATE issuers
       SET name = $1,
           email = $2,
           password_hash = COALESCE(password_hash, $3),
           status = COALESCE(status, CASE WHEN trusted THEN 'TRUSTED' ELSE 'SUSPENDED' END),
           org_type = COALESCE(org_type, $5),
           can_issue = COALESCE(can_issue, $6),
           can_verify = COALESCE(can_verify, $7)
       WHERE id = $4 RETURNING *`,
      [seed.name, emailToKeep, demoPasswordHash, existing.id, seed.orgType, seed.canIssue, seed.canVerify],
    );
    const row = updated as IssuerRow;
    // Ensure password works for BOTH demo emails during transition: if the
    // row kept the legacy email, also ensure a login exists for the new one
    // by updating nothing else (login is by email; admin can add alias later).
    // linked verifier shares the org DID (org-as-verifier without FK changes).
    await ensureLinkedVerifierRow(row, demoPasswordHash);
    return row;
  }

  // New issuer: fresh keypair, stored ENCRYPTED from day one.
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
      // Legacy column cannot be NULL: store the PUBLIC key (harmless, never
      // used for signing). The real key lives encrypted in private_key_enc.
      publicJwk,
      JSON.stringify(encryptPrivateJwk(privateJwk)),
      seed.status === 'TRUSTED',
      seed.status,
      seed.email,
      demoPasswordHash,
      seed.orgType,
      seed.canIssue,
      seed.canVerify,
    ],
  );
  const row = inserted as IssuerRow;
  await ensureLinkedVerifierRow(row, demoPasswordHash);
  return row;
}

/** Linked verifier sharing the org DID (same did:web), for org-as-verifier. */
async function ensureLinkedVerifierRow(issuer: IssuerRow, demoPasswordHash: string): Promise<void> {
  const existing = await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE did = $1', [issuer.did]);
  if (existing) {
    await query(
      `UPDATE verifiers SET password_hash = COALESCE(password_hash, $1),
        email = COALESCE(email, $2) WHERE id = $3`,
      [demoPasswordHash, issuer.email, existing.id],
    );
    return;
  }
  const email = issuer.email ?? `org-${issuer.id}@lifelink.local`;
  const clash = await queryOne<VerifierRow>('SELECT id FROM verifiers WHERE email = $1', [email]);
  const finalEmail = clash ? `org-${issuer.id}@lifelink.local` : email;
  await query(
    'INSERT INTO verifiers (name, did, email, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [issuer.name, issuer.did, finalEmail, demoPasswordHash],
  );
}

async function seedCitizen(demoPasswordHash: string): Promise<CitizenRow> {
  const existing =
    (await queryOne<CitizenRow>('SELECT * FROM citizens WHERE email = $1', [CITIZEN.email])) ??
    (await queryOne<CitizenRow>('SELECT * FROM citizens WHERE email = $1', [CITIZEN.legacyEmail])) ??
    (await queryOne<CitizenRow>('SELECT * FROM citizens WHERE name = $1', [CITIZEN.name]));
  if (existing) {
    // KEEP: did + holder keys. Backfill login; migrate legacy email when free.
    let emailToKeep = existing.email ?? CITIZEN.email;
    if (existing.email === CITIZEN.legacyEmail) {
      const taken = await queryOne<CitizenRow>('SELECT id FROM citizens WHERE email = $1', [CITIZEN.email]);
      if (!taken) emailToKeep = CITIZEN.email;
    }
    const updated = await queryOne<CitizenRow>(
      `UPDATE citizens SET email = $1, password_hash = COALESCE(password_hash, $2)
       WHERE id = $3 RETURNING *`,
      [emailToKeep, demoPasswordHash, existing.id],
    );
    return updated as CitizenRow;
  }

  // New citizen: fresh holder identity (did:key + KB signing key, encrypted).
  const { publicJwk, privateJwk } = await generateEd25519KeyPair();
  const inserted = await queryOne<CitizenRow>(
    `INSERT INTO citizens (name, did, public_jwk, private_jwk_enc, email, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      CITIZEN.name,
      didKeyFromPublicJwk(publicJwk),
      publicJwk,
      JSON.stringify(encryptPrivateJwk(privateJwk)),
      CITIZEN.email,
      demoPasswordHash,
    ],
  );
  return inserted as CitizenRow;
}

async function seedVerifier(
  name: string,
  domain: string,
  email: string,
  demoPasswordHash: string,
  lifelinkEmail?: string,
): Promise<VerifierRow> {
  const existing =
    (await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE did = $1', [didWeb(domain)])) ??
    (await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE name = $1', [name]));
  if (existing) {
    // KEEP: did. Only backfill the login.
    const updated = await queryOne<VerifierRow>(
      `UPDATE verifiers SET email = COALESCE(email, $2), password_hash = COALESCE(password_hash, $3)
       WHERE id = $4 RETURNING *`,
      [didWeb(domain), email, demoPasswordHash, existing.id],
    );
    return updated as VerifierRow;
  }
  const inserted = await queryOne<VerifierRow>(
    'INSERT INTO verifiers (name, did, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, didWeb(domain), email, demoPasswordHash],
  );
  return inserted as VerifierRow;
}

async function seedAdmin(demoPasswordHash: string): Promise<AdminRow> {
  const existing =
    (await queryOne<AdminRow>('SELECT * FROM admins WHERE email = $1', [ADMIN.email])) ??
    (await queryOne<AdminRow>('SELECT * FROM admins WHERE email = $1', [ADMIN.legacyEmail]));
  if (existing) {
    // Migrate legacy admin email when the new one is free.
    if (existing.email === ADMIN.legacyEmail) {
      const taken = await queryOne<AdminRow>('SELECT id FROM admins WHERE email = $1', [ADMIN.email]);
      if (!taken) {
        const migrated = await queryOne<AdminRow>('UPDATE admins SET email = $1 WHERE id = $2 RETURNING *', [
          ADMIN.email,
          existing.id,
        ]);
        return migrated as AdminRow;
      }
    }
    return existing;
  }
  const inserted = await queryOne<AdminRow>(
    'INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
    [ADMIN.name, ADMIN.email, demoPasswordHash],
  );
  return inserted as AdminRow;
}

async function main(): Promise<void> {
  await applySchema();
  if (RESET) await reset();

  const demoPasswordHash = await hashPassword(DEMO_PASSWORD);

  const issuers: IssuerRow[] = [];
  for (const seed of ISSUERS) {
    issuers.push(await seedIssuer(seed, demoPasswordHash));
  }

  for (const issuer of issuers) {
    await query(
      `INSERT INTO status_lists (issuer_id, bits, next_index)
       VALUES ($1, $2, 0) ON CONFLICT (issuer_id) DO NOTHING`,
      [issuer.id, Buffer.alloc(INITIAL_BITS_BYTES, 0)],
    );
  }

  const citizen = await seedCitizen(demoPasswordHash);
  const verifiers: VerifierRow[] = [];
  for (const v of VERIFIERS) {
    verifiers.push(await seedVerifier(v.name, v.domain, v.email, demoPasswordHash, v.lifelinkEmail));
  }
  const admin = await seedAdmin(demoPasswordHash);

  // ------------------------------------------------------------------
  // Pretty summary with every demo login.
  // ------------------------------------------------------------------
  const lines: string[] = [];
  lines.push('');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('  LifeLink demo data is ready (existing keys/DIDs were kept)');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('CITIZEN');
  lines.push(`  ${citizen.name}: id=${citizen.id}  did=${citizen.did}`);
  lines.push('');
  lines.push('ISSUERS  (id  status     did)');
  for (const issuer of issuers) {
    const status = issuer.status ?? (issuer.trusted ? 'TRUSTED' : 'SUSPENDED');
    lines.push(`  ${String(issuer.id).padStart(2)}  ${status.padEnd(10)} ${issuer.name} — ${issuer.did}`);
  }
  lines.push('');
  lines.push('VERIFIERS  (id  did)');
  for (const verifier of verifiers) {
    lines.push(`  ${String(verifier.id).padStart(2)}          ${verifier.name} — ${verifier.did}`);
  }
  lines.push('');
  lines.push(`ADMIN  ${admin.name}: id=${admin.id}`);
  lines.push('');
  lines.push(`DEMO LOGINS  (password for all: ${DEMO_PASSWORD})`);
  lines.push('  citizen : student@lifelink.demo');
  lines.push('  organization (university): university@lifelink.demo  (ABC University, issuer+verifier)');
  lines.push('  organization (employer)  : employer@lifelink.demo    (XYZ Company, issuer+verifier)');
  lines.push('  organization (bank)      : bank@lifelink.demo        (ABC Bank, issuer+verifier)');
  lines.push('  verifier (legacy)        : bank@demo.lifelink         (Demo Bank)');
  lines.push('  verifier (legacy)        : hr@demo.lifelink           (Demo Employer HR)');
  lines.push('  admin   : admin@lifelink.demo');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('');

  console.log(lines.join('\n'));
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
