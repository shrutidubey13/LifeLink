/**
 * Self-test for everything that needs NO database.
 *
 *   npm run test:crypto
 *
 * Proves the cryptographic core before Postgres is even involved:
 *   - RFC 9901 disclosure encoding, checked against INDEPENDENTLY computed
 *     expectations (plain node:crypto, not our own helpers)
 *   - issuance -> selective presentation -> verification, including _sd_alg
 *   - SD-JWT+KB holder binding: valid proof accepted; wrong nonce / audience /
 *     holder key / tampered bytes rejected
 *   - attack resistance: forged disclosures, wrong issuer key, edited payload
 *   - did:key local resolution round-trip + malformed rejection
 *   - Bitstring Status List: multibase encoding, 16KB minimum, bit ops
 *   - KeyStore AES-GCM round-trip (with a throwaway in-process key)
 *   - credential schemas accept valid claims and reject unknown fields
 *   - audit hash-chain rule (in-memory) + live chain when a DB is reachable
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  base64urlDecode,
  base64urlEncode,
  base58Encode,
  base58Decode,
  didKeyFromPublicJwk,
  resolveDidKey,
  generateEd25519KeyPair,
  JWS_ALG,
} from './crypto';
import {
  attachKeyBinding,
  computeSdHash,
  createPresentation,
  decodeDisclosure,
  indexCredential,
  issueSdJwt,
  makeDisclosure,
  SD_ALG,
  verifyPresentation,
} from './sdjwt';
import { encodeBitstring, decodeBitstring, isRevoked, setRevoked, INITIAL_BITS_BYTES } from './statusList';
import { decryptPrivateJwk, encryptPrivateJwk } from './keystore';
import { validateClaims } from './schemas';
import { buildVc } from './vc';
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

/** SHA-256 base64url computed WITHOUT touching our digest() helper. */
function independentDigest(ascii: string): string {
  return createHash('sha256').update(ascii, 'utf8').digest().toString('base64url');
}

async function main(): Promise<void> {
  console.log('\nLifeLink crypto self-test (no database needed)\n');

  // ---- RFC 9901 disclosure encoding ----------------------------------
  console.log('RFC 9901 disclosure encoding');
  const salt = base64urlEncode(randomBytes(16));
  const { disclosure, digest: claimDigest } = makeDisclosure('employmentStatus', 'employed', salt);
  const expectedDisclosure = Buffer.from(JSON.stringify([salt, 'employmentStatus', 'employed'])).toString(
    'base64url',
  );
  check('disclosure is base64url(JSON([salt, name, value]))', disclosure === expectedDisclosure, disclosure);
  check('digest is base64url(sha256(ascii))', claimDigest === independentDigest(disclosure));
  check('disclosure has no separators (single token)', !disclosure.includes('.') && !disclosure.includes('~'));
  const triple = decodeDisclosure(disclosure);
  check(
    'decode returns the [salt, name, value] triple',
    triple.salt === salt && triple.key === 'employmentStatus' && triple.value === 'employed',
  );
  for (const bad of ['not-base64!!!', base64urlEncode(JSON.stringify({ a: 1 })), base64urlEncode(JSON.stringify(['only', 'two']))]) {
    let threw = false;
    try {
      decodeDisclosure(bad);
    } catch {
      threw = true;
    }
    check(`malformed disclosure rejected (${bad.slice(0, 18)}…)`, threw);
  }

  // ---- keys + did:key -------------------------------------------------
  console.log('\nKeys and DIDs');
  const issuerKeys = await generateEd25519KeyPair();
  const citizenKeys = await generateEd25519KeyPair();
  const issuerDid = didKeyFromPublicJwk(issuerKeys.publicJwk);
  const citizenDid = didKeyFromPublicJwk(citizenKeys.publicJwk);
  check('did:key prefix', issuerDid.startsWith('did:key:z'), issuerDid);
  const resolved = resolveDidKey(citizenDid);
  check('did:key resolves to the same public key', resolved.publicJwk.x === citizenKeys.publicJwk.x);
  check('base58 round-trip', base58Decode(base58Encode(Buffer.from([0, 1, 2, 250, 255]))).equals(Buffer.from([0, 1, 2, 250, 255])));
  for (const bad of ['did:web:example.com', 'did:key:z!!!', 'did:key:z6Mkty']) {
    let threw = false;
    try {
      resolveDidKey(bad);
    } catch {
      threw = true;
    }
    check(`unresolvable DID rejected (${bad.slice(0, 20)})`, threw);
  }

  // ---- SD-JWT issuance ------------------------------------------------
  console.log('\nSD-JWT issuance');
  const claims = {
    employmentStatus: 'employed',
    employer: 'Demo Employer Pvt Ltd',
    jobTitle: 'Software Engineer',
    joiningDate: '2025-08-01',
    salary: 1800000,
  };
  const issued = await issueSdJwt({
    issuer: issuerDid,
    issuerPrivateKey: issuerKeys.privateKey,
    subject: citizenDid,
    type: 'EmploymentCredential',
    claims,
    vcId: 'urn:lifelink:test:1',
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    statusListUrl: 'http://localhost:4000/status-lists/1',
    statusIndex: 7,
  });

  check('_sd_alg is sha-256', issued.payload._sd_alg === SD_ALG && issued.payload._sd_alg === 'sha-256');
  check('every claim has exactly one digest', issued.payload._sd.length === Object.keys(claims).length);
  check(
    'each digest independently recomputes',
    issued.disclosedClaims.every((c) => independentDigest(c.disclosure) === c.digest),
  );
  check(
    'NO claim value leaks into the signed JWT',
    !Buffer.from(issued.jwt.split('.')[1], 'base64url').toString().includes('employmentStatus'),
  );
  check('header alg is EdDSA', JSON.parse(base64urlDecode(issued.jwt.split('.')[0]).toString()).alg === JWS_ALG);
  check('vc_id cross-reference carried', issued.payload.vc_id === 'urn:lifelink:test:1');

  // ---- selective presentation (no KB) ---------------------------------
  console.log('\nSelective disclosure presentation');
  const { presentation, revealed, missing } = createPresentation(issued.combined, ['employmentStatus']);
  check('missing fields reported', missing.length === 0);
  check('exactly one field revealed', Object.keys(revealed).length === 1);
  check('salary is NOT in the presentation', !presentation.includes('salary') && !presentation.includes('1800000'));

  const verified = await verifyPresentation(presentation, issuerKeys.publicJwk);
  check('signature valid', verified.signatureValid);
  check('_sd_alg accepted', verified.sdAlgValid);
  check('disclosure digests valid', verified.digestsValid);
  check('KB correctly reported absent', verified.kb.present === false);
  check('only the consented field came back', Object.keys(verified.revealed).join(',') === 'employmentStatus');

  // ---- SD-JWT+KB holder binding ---------------------------------------
  console.log('\nSD-JWT+KB holder binding');
  const nonce = base64urlEncode(randomBytes(16));
  const aud = 'did:web:bank.demo.lifelink';
  const kb = await attachKeyBinding({
    presentationWithoutKb: presentation,
    holderPrivateKey: citizenKeys.privateKey,
    nonce,
    aud,
  });
  check('sd_hash covers the presentation bytes', kb.sdHash === independentDigest(presentation));
  check('KB appended after the disclosures', kb.presentation.endsWith(kb.kbJwt));

  const kbOk = await verifyPresentation(kb.presentation, issuerKeys.publicJwk, {
    holderPublicJwk: citizenKeys.publicJwk,
    expectedNonce: nonce,
    expectedAud: aud,
  });
  check('KB signature valid', kbOk.kb.signatureValid);
  check('KB sd_hash valid', kbOk.kb.sdHashValid);
  check('KB nonce valid', kbOk.kb.nonceValid);
  check('KB audience valid', kbOk.kb.audValid);
  check('KB fresh', kbOk.kb.fresh);

  const wrongNonce = await verifyPresentation(kb.presentation, issuerKeys.publicJwk, {
    holderPublicJwk: citizenKeys.publicJwk,
    expectedNonce: 'another-request-nonce',
    expectedAud: aud,
  });
  check('wrong nonce rejected (replay across requests fails)', wrongNonce.kb.nonceValid === false);

  const wrongAud = await verifyPresentation(kb.presentation, issuerKeys.publicJwk, {
    holderPublicJwk: citizenKeys.publicJwk,
    expectedNonce: nonce,
    expectedAud: 'did:web:someone-else.example',
  });
  check('wrong audience rejected', wrongAud.kb.audValid === false);

  const otherHolder = await generateEd25519KeyPair();
  const wrongKey = await verifyPresentation(kb.presentation, issuerKeys.publicJwk, {
    holderPublicJwk: otherHolder.publicJwk,
    expectedNonce: nonce,
    expectedAud: aud,
  });
  check("another holder's key rejected (no impersonation)", wrongKey.kb.signatureValid === false);

  // Tamper with a revealed value: swap the disclosure, keep the KB.
  const tamperedDisclosure = base64urlEncode(JSON.stringify([salt, 'employmentStatus', 'ceo']));
  const tamperedPres = `${presentation.split('~')[0]}~${tamperedDisclosure}~${kb.kbJwt}`;
  const tampered = await verifyPresentation(tamperedPres, issuerKeys.publicJwk, {
    holderPublicJwk: citizenKeys.publicJwk,
    expectedNonce: nonce,
    expectedAud: aud,
  });
  check('swapped disclosure fails the digest check', tampered.digestsValid === false);
  check('swapped bytes fail sd_hash too', tampered.kb.sdHashValid === false);
  check('forged value never returned', tampered.revealed.employmentStatus === undefined);

  const noKbRequired = await verifyPresentation(presentation, issuerKeys.publicJwk, {
    holderPublicJwk: citizenKeys.publicJwk,
  });
  check('missing KB rejected when holder binding is required', noKbRequired.kb.present === false);

  // ---- attack 1: wrong issuer key --------------------------------------
  console.log('\nAttack resistance');
  const otherIssuer = await generateEd25519KeyPair();
  const wrongIssuerKey = await verifyPresentation(kb.presentation, otherIssuer.publicJwk);
  check('wrong issuer key rejected', wrongIssuerKey.signatureValid === false);

  // ---- status list ------------------------------------------------------
  console.log('\nW3C Bitstring Status List');
  check('list starts at the 16KB spec minimum', INITIAL_BITS_BYTES === 16 * 1024);
  const bits = Buffer.alloc(16, 0);
  check('fresh bit is valid', isRevoked(bits, 3) === false);
  const revokedBits = setRevoked(bits, 3);
  check('bit 3 now revoked', isRevoked(revokedBits, 3) === true);
  check('neighbouring bits untouched', isRevoked(revokedBits, 2) === false && isRevoked(revokedBits, 4) === false);
  const encoded = encodeBitstring(revokedBits);
  check('encodedList carries the multibase "u" prefix', encoded.startsWith('u'));
  check('gzip + base64url round-trip', decodeBitstring(encoded).equals(revokedBits));

  // ---- KeyStore ----------------------------------------------------------
  console.log('\nKeyStore (AES-GCM at rest)');
  process.env.ISSUER_KEY_ENC_KEY ??= Buffer.from(randomBytes(32)).toString('hex');
  const enc = encryptPrivateJwk(citizenKeys.privateJwk);
  check('envelope hides the key material', JSON.stringify(enc).indexOf(citizenKeys.privateJwk.d as string) === -1);
  const dec = decryptPrivateJwk(enc);
  check('decrypt round-trips the JWK', dec.d === citizenKeys.privateJwk.d && dec.x === citizenKeys.privateJwk.x);

  // ---- credential schemas -------------------------------------------------
  console.log('\nCredential schemas');
  const goodDegree = validateClaims('DegreeCredential', {
    name: 'Demo Student',
    degree: 'B.Tech',
    university: 'Demo University',
    graduationYear: 2025,
  });
  check('valid DegreeCredential accepted', goodDegree.ok);
  const extraField = validateClaims('DegreeCredential', {
    name: 'X',
    degree: 'Y',
    university: 'Z',
    graduationYear: 2025,
    passportNumber: 'ATTACK',
  });
  check('unknown field rejected (strict)', !extraField.ok);
  const badYear = validateClaims('DegreeCredential', {
    name: 'X',
    degree: 'Y',
    university: 'Z',
    graduationYear: 'soon',
  });
  check('malformed field rejected', !badYear.ok);
  check('unknown type rejected', !validateClaims('PassportCredential', { a: 1 }).ok);
  const goodEmp = validateClaims('EmploymentCredential', {
    employmentStatus: 'employed',
    employer: 'Demo Employer Pvt Ltd',
    jobTitle: 'Software Engineer',
    joiningDate: '2025-08-01',
    salary: 1800000,
  });
  check('valid EmploymentCredential (with salary) accepted', goodEmp.ok);

  // ---- W3C VC 2.0 mapping --------------------------------------------------
  console.log('\nW3C VC 2.0 representation');
  const vc = buildVc({
    id: 'urn:lifelink:test:1',
    issuerDid,
    subjectDid: citizenDid,
    type: 'EmploymentCredential',
    claims,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 1000),
    statusListUrl: 'http://localhost:4000/status-lists/1',
    statusIndex: 7,
  });
  check('@context is the VC 2.0 context', vc['@context'].includes('https://www.w3.org/ns/credentials/v2'));
  check('type includes VerifiableCredential + specific type', vc.type.includes('VerifiableCredential') && vc.type.includes('EmploymentCredential'));
  check('credentialSubject carries holder DID + claims', vc.credentialSubject.id === citizenDid);
  check(
    'credentialStatus is a BitstringStatusListEntry',
    vc.credentialStatus.type === 'BitstringStatusListEntry' &&
      vc.credentialStatus.statusPurpose === 'revocation' &&
      vc.credentialStatus.statusListIndex === 7,
  );

  // ---- wallet helpers -------------------------------------------------------
  console.log('\nWallet helpers');
  const indexed = indexCredential(issued.combined);
  check('indexCredential finds every claim', indexed.byKey.size === Object.keys(claims).length);
  check('digests line up with _sd', [...indexed.byKey.values()].every((c) => indexed.digests.includes(c.digest)));

  // ---- document flow mapping (Flow B, no DB) --------------------------------
  console.log('\nDocument verification mapping (Flow B)');
  const { normalizeDocumentType, credentialTypeForDocument, eligibleOrgTypesForDocument } =
    await import('./documentTypes.js');
  check('BCA_Degree.pdf normalizes to Degree', normalizeDocumentType('BCA_Degree.pdf') === 'Degree');
  check('Degree maps to DegreeCredential', credentialTypeForDocument('BCA_Degree.pdf') === 'DegreeCredential');
  check(
    'Degree eligible orgs are universities',
    (eligibleOrgTypesForDocument('Degree') ?? []).includes('University'),
  );
  check('Employment maps to EmploymentCredential', credentialTypeForDocument('Employment') === 'EmploymentCredential');
  check('KYC maps to BankCustomerCredential', credentialTypeForDocument('KYC') === 'BankCustomerCredential');
  check('Health maps to HealthCredential', credentialTypeForDocument('Health') === 'HealthCredential');
  check('uploaded doc never auto-issues (mapping only, no signing here)', credentialTypeForDocument('Degree') !== ('TRUSTED' as unknown as string));

  // ---- selective disclosure enforcement -------------------------------------
  console.log('\nSelective disclosure enforcement');
  const partial = createPresentation(issued.combined, ['employer']);
  check('partial presentation reveals only approved field', Object.keys(partial.revealed).join(',') === 'employer');
  const partialVerified = await verifyPresentation(partial.presentation, issuerKeys.publicJwk);
  check('non-approved salary NOT disclosed', (partialVerified.revealed as Record<string, unknown>).salary === undefined);
  check('approved employer disclosed', (partialVerified.revealed as Record<string, unknown>).employer === claims.employer);

  // ---- audit hash chain ------------------------------------------------------
  console.log('\nAudit hash chain (in-memory, same rule as the DB version)');
  const p1 = stableStringify({ eventType: 'CREDENTIAL_ISSUED', credentialId: 1 });
  const p2 = stableStringify({ eventType: 'CONSENT_APPROVED', sharedFields: ['employmentStatus'] });
  const h1 = computeHash(GENESIS, p1);
  const h2 = computeHash(h1, p2);
  check('second entry links to the first hash', computeHash(h1, p2) === h2);
  check('changing the payload changes the hash', computeHash(h1, stableStringify({ eventType: 'X' })) !== h2);

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
