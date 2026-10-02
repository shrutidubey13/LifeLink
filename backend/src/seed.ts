/**
 * Seed script — creates the demo world.
 *
 *   npm run seed            (adds/updates, keeps existing data)
 *   npm run seed -- --reset (wipes all tables first, for a clean demo)
 *
 * Creates:
 *   Issuers  : Demo University, Demo Employer Pvt Ltd, Demo Hospital (trusted)
 *              "Fake College" (NOT trusted — used to demo a denial)
 *   Citizen  : Demo Student (did:key)
 *   Verifiers: Demo Bank, Demo Employer HR
 *
 * Every DID and key pair is generated here, so a fresh database is never
 * missing keys.
 */
import { applySchema, closePool, query, queryOne } from './db';
import { didKeyFromPublicJwk, didWeb, generateEd25519KeyPair } from './crypto';
import { INITIAL_BITS_BYTES } from './statusList';
import type { CitizenRow, IssuerRow, VerifierRow } from './types';

const RESET = process.argv.includes('--reset');

interface IssuerSeed {
  name: string;
  domain: string;
  trusted: boolean;
}

const ISSUERS: IssuerSeed[] = [
  { name: 'Demo University', domain: 'university.demo.lifelink', trusted: true },
  { name: 'Demo Employer Pvt Ltd', domain: 'employer.demo.lifelink', trusted: true },
  { name: 'Demo Hospital', domain: 'hospital.demo.lifelink', trusted: true },
  // Same key quality, same signature — but nobody vouched for it. This is
  // exactly what a trust registry protects a citizen against.
  { name: 'Fake College', domain: 'fakecollege.demo.lifelink', trusted: false },
];

const VERIFIERS = [
  { name: 'Demo Bank', domain: 'bank.demo.lifelink' },
  // Added so the healthcare demo can share a health credential with an
  // employer, as required by the demo script.
  { name: 'Demo Employer HR', domain: 'hr.demo.lifelink' },
];

const CITIZEN = { name: 'Demo Student', domain: 'student.demo.lifelink' };

async function reset(): Promise<void> {
  console.log('⚠ --reset given: truncating all tables');
  // TRUNCATE ... CASCADE wipes everything and restarts the id sequences so the
  // printed ids are always 1, 2, 3 ...
  await query(`TRUNCATE audit_log, consents, credentials, status_lists, verifiers, citizens, issuers
               RESTART IDENTITY CASCADE`);
}

async function seedIssuer(seed: IssuerSeed): Promise<IssuerRow> {
  const existing = await queryOne<IssuerRow>('SELECT * FROM issuers WHERE domain = $1', [seed.domain]);
  const { publicJwk, privateJwk } = await generateEd25519KeyPair();
  const did = didWeb(seed.domain);

  if (existing) {
    // Keep the same row (and its credentials), just refresh the metadata and
    // re-issue the key so the demo always works end to end.
    const updated = await queryOne<IssuerRow>(
      `UPDATE issuers SET name = $1, did = $2, public_jwk = $3, private_jwk = $4, trusted = $5
       WHERE id = $6 RETURNING *`,
      [seed.name, did, publicJwk, privateJwk, seed.trusted, existing.id],
    );
    return updated as IssuerRow;
  }

  const inserted = await queryOne<IssuerRow>(
    `INSERT INTO issuers (name, domain, did, public_jwk, private_jwk, trusted)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [seed.name, seed.domain, did, publicJwk, privateJwk, seed.trusted],
  );
  return inserted as IssuerRow;
}

async function seedCitizen(): Promise<CitizenRow> {
  const existing = await queryOne<CitizenRow>('SELECT * FROM citizens WHERE name = $1', [CITIZEN.name]);
  const { publicJwk, privateJwk } = await generateEd25519KeyPair();
  const did = didKeyFromPublicJwk(publicJwk);
  void privateJwk; // Future work: holder key binding (see README).

  if (existing) {
    const updated = await queryOne<CitizenRow>(
      'UPDATE citizens SET did = $1, public_jwk = $2 WHERE id = $3 RETURNING *',
      [did, publicJwk, existing.id],
    );
    return updated as CitizenRow;
  }

  const inserted = await queryOne<CitizenRow>(
    'INSERT INTO citizens (name, did, public_jwk) VALUES ($1, $2, $3) RETURNING *',
    [CITIZEN.name, did, publicJwk],
  );
  return inserted as CitizenRow;
}

async function seedVerifier(name: string, domain: string): Promise<VerifierRow> {
  const existing = await queryOne<VerifierRow>('SELECT * FROM verifiers WHERE name = $1', [name]);
  if (existing) {
    const updated = await queryOne<VerifierRow>(
      'UPDATE verifiers SET did = $1 WHERE id = $2 RETURNING *',
      [didWeb(domain), existing.id],
    );
    return updated as VerifierRow;
  }
  const inserted = await queryOne<VerifierRow>(
    'INSERT INTO verifiers (name, did) VALUES ($1, $2) RETURNING *',
    [name, didWeb(domain)],
  );
  return inserted as VerifierRow;
}

async function main(): Promise<void> {
  await applySchema();
  if (RESET) await reset();

  const issuers: IssuerRow[] = [];
  for (const seed of ISSUERS) {
    issuers.push(await seedIssuer(seed));
  }

  // Every issuer needs an (empty) status list before it can issue anything.
  for (const issuer of issuers) {
    await query(
      `INSERT INTO status_lists (issuer_id, bits, next_index)
       VALUES ($1, $2, 0) ON CONFLICT (issuer_id) DO NOTHING`,
      [issuer.id, Buffer.alloc(INITIAL_BITS_BYTES, 0)],
    );
  }

  const citizen = await seedCitizen();
  const verifiers: VerifierRow[] = [];
  for (const v of VERIFIERS) {
    verifiers.push(await seedVerifier(v.name, v.domain));
  }

  // ------------------------------------------------------------------
  // Pretty summary — the frontend and README both expect these ids.
  // ------------------------------------------------------------------
  const lines: string[] = [];
  lines.push('');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('  LifeLink demo data is ready');
  lines.push('══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('CITIZEN (the wallet owner)');
  lines.push(`  ${citizen.name}: id=${citizen.id}  did=${citizen.did}`);
  lines.push('');
  lines.push('ISSUERS  (id  trusted  did)');
  for (const issuer of issuers) {
    lines.push(
      `  ${String(issuer.id).padStart(2)}  ${(issuer.trusted ? 'yes' : 'NO ').padEnd(8)} ${issuer.name} — ${issuer.did}`,
    );
  }
  lines.push('');
  lines.push('VERIFIERS  (id  did)');
  for (const verifier of verifiers) {
    lines.push(`  ${String(verifier.id).padStart(2)}          ${verifier.name} — ${verifier.did}`);
  }
  lines.push('');
  lines.push('QUICK CURL');
  lines.push(`  curl http://localhost:4000/wallet/credentials?citizenId=${citizen.id}`);
  lines.push(`  curl http://localhost:4000/trust-registry/issuers`);
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
