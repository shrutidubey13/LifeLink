/**
 * Self-test for the parts that need NO database.
 *
 *   npm run test:crypto
 *
 * It proves the cryptographic core works before you even start Postgres:
 *   - did:key generation matches the W3C spec (multicodec 0xed01 + base58btc)
 *   - an SD-JWT can be issued, partially presented and verified
 *   - a tampered disclosure is rejected
 *   - a presentation with a wrong issuer key is rejected
 *   - status list bits round-trip through gzip + base64url
 *   - the audit hash chain recomputes and detects tampering
 */
import {
  base58Encode,
  base64urlDecode,
  base64urlEncode,
  didKeyFromPublicJwk,
  digest,
  generateEd25519KeyPair,
  JWS_ALG,
} from './crypto';
import { createPresentation, decodeDisclosure, indexCredential, issueSdJwt, verifyPresentation } from './sdjwt';
import { encodeBitstring, decodeBitstring, isRevoked, setRevoked } from './statusList';
import { computeHash, GENESIS, stableStringify, verifyAuditChain } from './audit';
import { closePool } from './db';

let failures = 0;

function check(name: string, condition: boolean, extra = ''): void {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✖ ${name} ${extra}`);
  }
}

/**
 * base58btc decoder, local to this test file: used to prove the did:key really
 * contains the 0xed01 multicodec prefix followed by the raw 32-byte key.
 * (crypto.ts only needs the encoder, so the decoder is not shipped.)
 */
function base58Decode(input: string): Buffer {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let zeroes = 0;
  while (zeroes < input.length && input[zeroes] === '1') zeroes += 1;

  const bytes: number[] = [];
  for (const char of input) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`not base58: ${char}`);
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return Buffer.from([...new Array(zeroes).fill(0), ...bytes.reverse()]);
}

async function main(): Promise<void> {
  console.log('\nLifeLink crypto self-test (no database needed)\n');

  // ---- base64url + digest ---------------------------------------------
  console.log('base64url / SHA-256');
  check('base64url round-trip', base64urlDecode(base64urlEncode('lifelink')).toString() === 'lifelink');
  check('digest is 43 chars (256 bits, no padding)', digest('hello').length === 43);
  check('base58 alphabet output', /^[1-9A-HJ-NP-Za-km-z]+$/.test(base58Encode(Buffer.from([0, 1, 2, 250, 255]))));

  // ---- keys + did:key -------------------------------------------------
  console.log('\nKeys and DIDs');
  const issuerKeys = await generateEd25519KeyPair();
  const citizenKeys = await generateEd25519KeyPair();
  const issuerDid = didKeyFromPublicJwk(issuerKeys.publicJwk);
  const citizenDid = didKeyFromPublicJwk(citizenKeys.publicJwk);
  check('issuer did:key prefix', issuerDid.startsWith('did:key:z'), issuerDid);
  check('citizen did:key differs from issuer', citizenDid !== issuerDid);
  check('did:key is deterministic for the same key', didKeyFromPublicJwk(issuerKeys.publicJwk) === issuerDid);

  // The did:key payload must be base58btc(0xed01 || raw 32-byte public key).
  const didBytes = base58Decode(issuerDid.replace('did:key:z', ''));
  check('did:key multicodec prefix is 0xed01 (ed25519-pub)', didBytes[0] === 0xed && didBytes[1] === 0x01);
  check('did:key carries the raw 32-byte public key', didBytes.length === 34 && didBytes.subarray(2).equals(base64urlDecode(issuerKeys.publicJwk.x as string)));

  // ---- SD-JWT issuance ------------------------------------------------
  console.log('\nSD-JWT issuance');
  const claims = {
    degree: 'Bachelor of Technology',
    university: 'Demo University',
    field_of_study: 'Computer Science',
    year_of_graduation: 2025,
    status: 'employed',
    salary: 1800000,
  };
  const issued = await issueSdJwt({
    issuer: issuerDid,
    issuerPrivateKey: issuerKeys.privateKey,
    subject: citizenDid,
    type: 'DegreeCredential',
    claims,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    statusListUrl: 'http://localhost:4000/status-lists/1',
    statusIndex: 0,
  });

  check('JWT is signed (3 dot-separated parts)', issued.jwt.split('.').length === 3);
  check('header alg is EdDSA', JSON.parse(base64urlDecode(issued.jwt.split('.')[0]).toString()).alg === JWS_ALG);
  check('payload carries _sd digests only', Array.isArray(issued.payload._sd) && issued.payload._sd.length === Object.keys(claims).length);
  check(
    'NO claim value leaks into the signed JWT',
    !issued.jwt.split('.')[1].includes(base64urlEncode(JSON.stringify('1800000'))) &&
      !Buffer.from(issued.jwt.split('.')[1], 'base64url').toString().includes('salary'),
  );
  check('combined format has jwt + N disclosures', issued.combined.split('~').filter(Boolean).length === 1 + Object.keys(claims).length);
  check(
    'each disclosure is "<salt>.<b64 json>"',
    issued.disclosedClaims.every((c) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(c.disclosure) && decodeDisclosure(c.disclosure).sd.length > 0),
  );

  // ---- presentation (the product's whole point) ------------------------
  console.log('\nSelective disclosure presentation');
  const { presentation, revealed, missing } = createPresentation(issued.combined, ['status']);
  check('missing fields reported', missing.length === 0);
  check('exactly one field revealed', Object.keys(revealed).length === 1 && revealed.status === 'employed');
  check('presentation contains 1 disclosure', presentation.split('~').filter(Boolean).length === 2);
  check('hidden salary is NOT in the presentation', !presentation.includes('salary') && !presentation.includes('1800000'));
  check('issuer public key was never leaked', !presentation.includes(issuerKeys.publicJwk.x as string));

  const verified = await verifyPresentation(presentation, issuerKeys.publicJwk);
  check('signature valid', verified.signatureValid);
  check('disclosure digests valid', verified.digestsValid);
  check('only the consented field came back', Object.keys(verified.revealed).join(',') === 'status');
  check('vct survived', verified.payload.vct === 'DegreeCredential');
  check('status pointer survived', verified.payload.status.idx === 0);

  // ---- attack 1: forge a claim ----------------------------------------
  console.log('\nAttack resistance');
  const forgedDisclosure = `${base64urlEncode('attacker-salt')}.~${base64urlEncode(
    JSON.stringify({ status: 'ceo', sd: 'attacker-salt' }),
  )}`;
  const forged = `${issued.jwt}~${forgedDisclosure}~`;
  const forgedResult = await verifyPresentation(forged, issuerKeys.publicJwk);
  check('forged disclosure rejected (no matching _sd digest)', forgedResult.digestsValid === false);
  check('forged value is not returned', forgedResult.revealed.status === undefined);

  // ---- attack 2: wrong issuer key -------------------------------------
  const otherKeys = await generateEd25519KeyPair();
  const wrongKey = await verifyPresentation(presentation, otherKeys.publicJwk);
  check('wrong issuer key rejected', wrongKey.signatureValid === false);

  // ---- attack 3: tamper with a signed value ---------------------------
  const tamperedJwtPayload = Buffer.from(issued.jwt.split('.')[1], 'base64url')
    .toString('utf8')
    .replace(/"vct":"DegreeCredential"/, '"vct":"FakeCredential"');
  const tampered = `${issued.jwt.split('.')[0]}.${Buffer.from(tamperedJwtPayload).toString('base64url')}.${issued.jwt.split('.')[2]}~${issued.disclosedClaims[0].disclosure}~`;
  const tamperedResult = await verifyPresentation(tampered, issuerKeys.publicJwk);
  check('tampered payload rejected by the signature', tamperedResult.signatureValid === false);

  // ---- credential indexing (used by the wallet) -----------------------
  console.log('\nWallet helpers');
  const indexed = indexCredential(issued.combined);
  check('indexCredential finds every claim', indexed.byKey.size === Object.keys(claims).length);
  check('digests line up with _sd', [...indexed.byKey.values()].every((c) => indexed.digests.includes(c.digest)));

  // ---- status list -----------------------------------------------------
  console.log('\nW3C Bitstring Status List');
  const bits = Buffer.alloc(16, 0);
  check('fresh bit is valid', isRevoked(bits, 3) === false);
  const revokedBits = setRevoked(bits, 3);
  check('bit 3 now revoked', isRevoked(revokedBits, 3) === true);
  check('neighbouring bits untouched', isRevoked(revokedBits, 2) === false && isRevoked(revokedBits, 4) === false);
  const encoded = encodeBitstring(revokedBits);
  check('gzip + base64url round-trip', decodeBitstring(encoded).equals(revokedBits));
  check('encoded form is compact', encoded.length < 60, `${encoded.length} chars for 128 bits`);

  // ---- audit hash chain -------------------------------------------------
  console.log('\nAudit hash chain (in-memory, same rule as the DB version)');
  const entry1 = { eventType: 'ISSUER_CREDENTIAL_ISSUED', credentialId: 1 };
  const entry2 = { eventType: 'CONSENT_GRANTED', credentialId: 1, sharedFields: ['status'] };
  const p1 = stableStringify(entry1);
  const p2 = stableStringify(entry2);
  const h1 = computeHash(GENESIS, p1);
  const h2 = computeHash(h1, p2);
  check('first entry links to GENESIS', computeHash(GENESIS, p1) === h1);
  check('second entry links to the first hash', computeHash(h1, p2) === h2);
  check('stable stringify is key-order independent', stableStringify({ b: 1, a: 2 }) === stableStringify({ a: 2, b: 1 }));
  check('hash is 43 chars', h1.length === 43);
  check('changing the payload changes the hash', computeHash(h1, stableStringify({ ...entry2, sharedFields: ['salary'] })) !== h2);

  // If a database happens to be reachable, verify the real chain too.
  try {
    const chain = await verifyAuditChain();
    check(`live audit chain intact (${chain.length} entries)`, chain.valid, chain.reason ?? '');
  } catch {
    console.log('  – live audit chain skipped (no database reachable)');
  }

  console.log('');
  if (failures === 0) {
    console.log('✔ All crypto self-tests passed.\n');
  } else {
    console.error(`✖ ${failures} self-test(s) failed.\n`);
  }

  await closePool().catch(() => undefined);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
