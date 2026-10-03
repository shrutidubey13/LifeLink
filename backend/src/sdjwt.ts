/**
 * SD-JWT and SD-JWT+KB per RFC 9901 (https://www.rfc-editor.org/rfc/rfc9901).
 *
 * What was wrong before: disclosures were a custom `salt.base64(json)` shape.
 * What this file does now, exactly per the RFC:
 *
 *   Disclosure   base64url( UTF8( JSON( [salt, claim_name, claim_value] ) ) )
 *                — a JSON ARRAY of exactly 3 elements, salt first.
 *   Digest       base64url( SHA-256( ASCII(disclosure) ) ), listed in `_sd`,
 *                with the hash algorithm named in `_sd_alg` ("sha-256").
 *   Transport    `<issuer-jwt>~<disclosure>~...~` and, for holder binding,
 *                `<issuer-jwt>~<disclosure>~...~<kb-jwt>` (SD-JWT+KB).
 *   KB-JWT       JWS with header typ "kb+jwt" and payload { iat*, nonce, aud,
 *                sd_hash } where sd_hash covers the presentation bytes the KB
 *                JWT is attached to. (* = required by RFC 9901 §4.2)
 *
 * Verification recomputes every digest and matches it against the signed `_sd`
 * array; undisclosed claims are not recoverable from a presentation because
 * their disclosures (and hence their salts) are simply absent.
 *
 * Prototype scope (see README): flat top-level credentialSubject properties
 * only — no nested `_sd` objects, no array-element disclosures, no `cnf`
 * confirmation claim (holder key travels via the credential `sub` DID +
 * citizen registry instead).
 */
import {
  SignJWT,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWK,
  type KeyLike,
} from 'jose';
import { JWS_ALG, base64urlDecode, base64urlEncode, digest, randomSalt } from './crypto';

/** RFC 9901 §4.1: the decoded disclosure triple. */
export interface RfcDisclosure {
  salt: string;
  key: string;
  value: unknown;
}

/** A claim the citizen may choose to share, with everything needed to build a presentation. */
export interface DisclosedClaim {
  /** The claim name, e.g. "employmentStatus". */
  key: string;
  /** base64url(SHA-256(ASCII(disclosure))) — the value signed inside `_sd`. */
  digest: string;
  /** The full disclosure string (a single base64url token, no separators). */
  disclosure: string;
  /** The plaintext value. Only ever returned to the wallet owner. */
  value: unknown;
}

export interface SdJwtPayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  /** Verifiable Credential type, e.g. "DegreeCredential". */
  vct: string;
  /** Hash algorithm used for `_sd` digests, per RFC 9901 §4.3. Always "sha-256". */
  _sd_alg: string;
  /** Revocation pointer into the issuer's Bitstring Status List. */
  status: { idx: number; url: string };
  /** base64url SHA-256 digests of the salted disclosures. No claim values here. */
  _sd: string[];
  /** Stable id of the underlying W3C VC (`vc_json.id`), for cross-reference. */
  vc_id?: string;
  [claim: string]: unknown;
}

/** The only digest algorithm this prototype implements (named in `_sd_alg`). */
export const SD_ALG = 'sha-256';

export interface IssueInput {
  /** Issuer DID. */
  issuer: string;
  issuerPrivateKey: KeyLike;
  /** Holder DID (goes in `sub`). */
  subject: string;
  /** Credential type, e.g. "DegreeCredential". */
  type: string;
  /** Validated credentialSubject properties. Each becomes one disclosure. */
  claims: Record<string, unknown>;
  /** Stable VC id for cross-reference (`vc_id`). */
  vcId?: string;
  issuedAt?: Date;
  expiresAt: Date;
  statusListUrl: string;
  statusIndex: number;
}

export interface IssuedCredential {
  /** The issuer-signed JWT (contains digests only). */
  jwt: string;
  /** Combined issuance format: <jwt>~<disclosure>~<disclosure>~... */
  combined: string;
  payload: SdJwtPayload;
  /** Every claim, in the order it was signed. Stored with the credential. */
  disclosedClaims: DisclosedClaim[];
}

/**
 * Build one RFC 9901 disclosure.
 * The JSON MUST be exactly [salt, name, value] — order matters, and object
 * properties must not be used (that was the old custom format's mistake).
 */
export function makeDisclosure(
  key: string,
  value: unknown,
  salt: string = randomSalt(),
): { disclosure: string; digest: string } {
  const disclosure = base64urlEncode(JSON.stringify([salt, key, value]));
  return { disclosure, digest: digest(disclosure) };
}

/** Decode + validate one disclosure string into its triple. */
export function decodeDisclosure(disclosure: string): RfcDisclosure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecode(disclosure).toString('utf8'));
  } catch {
    throw new Error('Malformed disclosure: not base64url-encoded JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error('Malformed disclosure: expected a JSON array of [salt, claim_name, claim_value]');
  }
  const [salt, key, value] = parsed;
  if (typeof salt !== 'string' || salt.length === 0) {
    throw new Error('Malformed disclosure: salt must be a non-empty string');
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Malformed disclosure: claim name must be a non-empty string');
  }
  return { salt, key, value };
}

/** The claim name of a disclosure, e.g. "employmentStatus". */
export function disclosureKey(disclosure: string): string {
  return decodeDisclosure(disclosure).key;
}

/**
 * Sign a credential as an SD-JWT.
 *
 * The signed payload deliberately contains NO claim values — only digests —
 * plus `_sd_alg` naming the digest algorithm, per RFC 9901 §4.3.
 */
export async function issueSdJwt(input: IssueInput): Promise<IssuedCredential> {
  const issuedAt = input.issuedAt ?? new Date();
  const iat = Math.floor(issuedAt.getTime() / 1000);
  const exp = Math.floor(input.expiresAt.getTime() / 1000);

  const disclosedClaims: DisclosedClaim[] = [];
  for (const [key, value] of Object.entries(input.claims)) {
    const { disclosure, digest: claimDigest } = makeDisclosure(key, value);
    disclosedClaims.push({ key, digest: claimDigest, disclosure, value });
  }

  const payload: SdJwtPayload = {
    iss: input.issuer,
    sub: input.subject,
    iat,
    exp,
    vct: input.type,
    _sd_alg: SD_ALG,
    status: { idx: input.statusIndex, url: input.statusListUrl },
    _sd: disclosedClaims.map((c) => c.digest),
    ...(input.vcId ? { vc_id: input.vcId } : {}),
  };

  const jwt = await new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: JWS_ALG, typ: 'vc+sd-jwt' })
    .sign(input.issuerPrivateKey);

  return {
    jwt,
    combined: formatCombined(jwt, disclosedClaims.map((c) => c.disclosure)),
    payload,
    disclosedClaims,
  };
}

/** `<jwt>~<d1>~<d2>~` — the SD-JWT combined format (RFC 9901 §4.4). */
export function formatCombined(jwt: string, disclosures: string[]): string {
  return `${jwt}~${disclosures.map((d) => `${d}~`).join('')}`;
}

/**
 * Split a combined presentation into its parts. A trailing Key Binding JWT
 * (SD-JWT+KB) is detected structurally: it has 3 dot-separated segments,
 * while a disclosure is a single base64url token with no dots.
 */
export function splitCombined(combined: string): {
  jwt: string;
  disclosures: string[];
  kbJwt: string | null;
} {
  const parts = combined.split('~').filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error('Malformed SD-JWT: nothing to parse');
  }
  const jwt = parts[0];
  if (jwt.split('.').length !== 3) {
    throw new Error('Malformed SD-JWT: issuer JWT must have 3 segments');
  }
  let kbJwt: string | null = null;
  const rest = parts.slice(1);
  if (rest.length > 0 && rest[rest.length - 1].split('.').length === 3) {
    kbJwt = rest[rest.length - 1];
    rest.pop();
  }
  return { jwt, disclosures: rest, kbJwt };
}

/**
 * Read a stored credential (combined format, no KB expected) and index its
 * disclosures by claim key. The wallet uses this to show the citizen which
 * fields exist and to build a partial presentation.
 */
export function indexCredential(combined: string): {
  jwt: string;
  digests: string[];
  sdAlg: string;
  byKey: Map<string, DisclosedClaim>;
} {
  const { jwt, disclosures } = splitCombined(combined);
  const payload = decodeJwt(jwt) as SdJwtPayload;
  const digests = Array.isArray(payload._sd) ? payload._sd : [];

  const byKey = new Map<string, DisclosedClaim>();
  for (const disclosure of disclosures) {
    let triple: RfcDisclosure;
    try {
      triple = decodeDisclosure(disclosure);
    } catch {
      continue; // ignore unreadable segments (e.g. a KB-JWT in a stored copy)
    }
    if (byKey.has(triple.key)) continue; // ignore duplicates
    byKey.set(triple.key, {
      key: triple.key,
      digest: digest(disclosure),
      disclosure,
      value: triple.value,
    });
  }
  return { jwt, digests, sdAlg: typeof payload._sd_alg === 'string' ? payload._sd_alg : '', byKey };
}

/** The claim names a credential contains, in the order they were signed. */
export function claimKeys(combined: string): string[] {
  return [...indexCredential(combined).byKey.keys()];
}

/** The claim names of a credential as a plain object (owner-readable only). */
export function claimsOf(combined: string): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  for (const claim of indexCredential(combined).byKey.values()) {
    claims[claim.key] = claim.value;
  }
  return claims;
}

export interface PresentationResult {
  /** `<jwt>~<d1>~<d2>~` containing ONLY the selected disclosures (no KB). */
  presentation: string;
  /** Plaintext of the selected claims (citizen-facing preview only). */
  revealed: Record<string, unknown>;
  /** Fields the citizen asked for that this credential does not contain. */
  missing: string[];
}

/**
 * Build a selective-disclosure presentation from a stored credential.
 * Only the requested claim keys travel with the presentation.
 */
export function createPresentation(combined: string, selectedKeys: string[]): PresentationResult {
  const { jwt, byKey } = indexCredential(combined);

  const disclosures: string[] = [];
  const revealed: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const key of selectedKeys) {
    const claim = byKey.get(key);
    if (!claim) {
      missing.push(key);
      continue;
    }
    if (disclosures.includes(claim.disclosure)) continue; // de-duplicate
    disclosures.push(claim.disclosure);
    revealed[key] = claim.value;
  }

  return { presentation: formatCombined(jwt, disclosures), revealed, missing };
}

/* ------------------------------------------------------------------ */
/* SD-JWT+KB: holder key binding (RFC 9901 §4.2 / §6.2)                */
/* ------------------------------------------------------------------ */

export interface KbSignInput {
  /** Presentation WITHOUT kb (the `<jwt>~<d>~...~` this KB is attached to). */
  presentationWithoutKb: string;
  holderPrivateKey: KeyLike;
  /** Fresh single-use nonce from the verifier's presentation request. */
  nonce: string;
  /** Audience the KB is bound to (the verifier's DID). */
  aud: string;
}

export interface KbPayload {
  iat: number;
  nonce: string;
  aud: string;
  /** Digest of the presentation bytes this KB is attached to. */
  sd_hash: string;
  [claim: string]: unknown;
}

/** RFC 9901 §4.2: sd_hash = hash of the ASCII bytes of the presentation. */
export function computeSdHash(presentationWithoutKb: string): string {
  return digest(presentationWithoutKb);
}

/**
 * Sign a Key Binding JWT and append it: `<presentation> + <kb-jwt>`.
 * The holder proves possession of the key behind the credential `sub` DID,
 * and binds this exact presentation to one nonce + one audience.
 */
export async function attachKeyBinding(input: KbSignInput): Promise<{
  presentation: string;
  kbJwt: string;
  sdHash: string;
}> {
  const sdHash = computeSdHash(input.presentationWithoutKb);
  const kbPayload: KbPayload = {
    iat: Math.floor(Date.now() / 1000),
    nonce: input.nonce,
    aud: input.aud,
    sd_hash: sdHash,
  };
  const kbJwt = await new SignJWT(kbPayload as Record<string, unknown>)
    .setProtectedHeader({ alg: JWS_ALG, typ: 'kb+jwt' })
    .sign(input.holderPrivateKey);
  // No trailing "~" after the KB-JWT (RFC 9901 §6.2 combined format).
  return { presentation: `${input.presentationWithoutKb}${kbJwt}`, kbJwt, sdHash };
}

export interface KbVerification {
  /** A KB-JWT was attached at all. */
  present: boolean;
  signatureValid: boolean;
  /** Recomputed sd_hash matches the KB claim. */
  sdHashValid: boolean;
  /** KB nonce equals the request nonce. */
  nonceValid: boolean;
  /** KB aud equals the expected audience. */
  audValid: boolean;
  /** KB iat is not from the future and not older than maxAgeSec. */
  fresh: boolean;
  nonce: string | null;
  aud: string | null;
  problems: string[];
}

export interface ParsedPresentation {
  jwt: string;
  /** The signed payload (digests only — no claim values). */
  payload: SdJwtPayload;
  header: Record<string, unknown>;
  kbJwt: string | null;
  /** Claims the presenter chose to reveal, in presentation order. */
  revealed: Record<string, unknown>;
  /** Keys of the revealed claims (in presentation order). */
  revealedKeys: string[];
  /** Digests of the presented disclosures, for comparison against `_sd`. */
  presentedDigests: string[];
}

export interface VerifyOptions {
  /** Holder public key. When given, a KB-JWT is REQUIRED. */
  holderPublicJwk?: JWK;
  /** The nonce the presentation must be bound to (from the request). */
  expectedNonce?: string;
  /** The audience the presentation must be bound to (verifier DID). */
  expectedAud?: string;
  /** Max KB age in seconds (replay window). Defaults to 10 minutes. */
  maxKbAgeSec?: number;
}

export interface VerifyResult extends ParsedPresentation {
  /** The EdDSA issuer signature verified and `exp` is in the future. */
  signatureValid: boolean;
  /** `_sd_alg` names a supported algorithm (only "sha-256" here). */
  sdAlgValid: boolean;
  /** Every presented disclosure matches a digest inside the signed `_sd` array. */
  digestsValid: boolean;
  kb: KbVerification;
  /** Human readable notes about any integrity problem. */
  problems: string[];
}

/**
 * Verify an SD-JWT or SD-JWT+KB presentation.
 *
 * Checks performed here (policy checks like trust/revocation/consent stay with
 * the caller in routes.ts):
 *   1. issuer EdDSA signature over the JWT (+ `exp`), `_sd_alg` support
 *   2. every presented disclosure recomputes to a signed `_sd` digest
 *   3. KB-JWT (when required): signature, sd_hash, nonce, aud, freshness
 */
export async function verifyPresentation(
  presentation: string,
  issuerPublicJwk: JWK,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const problems: string[] = [];

  const { jwt, disclosures, kbJwt } = splitCombined(presentation);
  const header = decodeProtectedHeader(jwt) as Record<string, unknown>;
  const payload = decodeJwt(jwt) as SdJwtPayload;

  if (header.alg !== JWS_ALG) {
    problems.push(`Unexpected signing algorithm "${String(header.alg)}" (expected ${JWS_ALG})`);
  }

  const sdAlgValid = payload._sd_alg === SD_ALG;
  if (!sdAlgValid) {
    problems.push(`Unsupported _sd_alg "${String(payload._sd_alg)}" (expected "${SD_ALG}")`);
  }

  // ---- Check 1: issuer signature + expiry -----------------------------
  let signatureValid = false;
  try {
    const publicKey = await importPublicJwkSafe(issuerPublicJwk);
    await jwtVerify(jwt, publicKey, { algorithms: [JWS_ALG] });
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
      problems.push('Credential expired (exp claim is in the past)');
    } else {
      signatureValid = true;
    }
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }

  // ---- Check 2: presented disclosures must be signed ------------------
  const signedDigests = new Set(Array.isArray(payload._sd) ? payload._sd : []);
  const revealed: Record<string, unknown> = {};
  const revealedKeys: string[] = [];
  const presentedDigests: string[] = [];
  let digestsValid = true;
  const seen = new Set<string>();

  for (const disclosure of disclosures) {
    let triple: RfcDisclosure;
    try {
      triple = decodeDisclosure(disclosure);
    } catch (err) {
      digestsValid = false;
      problems.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    if (seen.has(triple.key)) {
      digestsValid = false;
      problems.push(`Claim "${triple.key}" was presented twice`);
      continue;
    }
    seen.add(triple.key);

    const claimDigest = digest(disclosure);
    presentedDigests.push(claimDigest);
    if (!signedDigests.has(claimDigest)) {
      digestsValid = false;
      problems.push(`Claim "${triple.key}" does not match any signed _sd digest`);
      continue;
    }

    revealed[triple.key] = triple.value;
    revealedKeys.push(triple.key);
  }

  if (disclosures.length === 0) {
    digestsValid = false;
    problems.push('Presentation contains no disclosures');
  }

  // ---- Check 3: Key Binding JWT ---------------------------------------
  const kb = await verifyKb(presentation, kbJwt, options);

  return {
    jwt,
    payload,
    header,
    kbJwt,
    revealed,
    revealedKeys,
    presentedDigests,
    signatureValid,
    sdAlgValid,
    digestsValid,
    kb,
    problems: [...problems, ...kb.problems.map((p) => `KB: ${p}`)],
  };
}

async function verifyKb(
  fullPresentation: string,
  kbJwt: string | null,
  options: VerifyOptions,
): Promise<KbVerification> {
  const problems: string[] = [];
  const empty: KbVerification = {
    present: kbJwt !== null,
    signatureValid: false,
    sdHashValid: false,
    nonceValid: false,
    audValid: false,
    fresh: false,
    nonce: null,
    aud: null,
    problems,
  };

  // Holder key given => KB is mandatory (holder-bound flow).
  if (!kbJwt) {
    if (options.holderPublicJwk) {
      problems.push('Missing Key Binding JWT: this credential is holder-bound, but no KB-JWT was attached');
    }
    return empty;
  }

  let header: Record<string, unknown>;
  let kb: KbPayload;
  try {
    header = decodeProtectedHeader(kbJwt) as Record<string, unknown>;
    kb = decodeJwt(kbJwt) as KbPayload;
  } catch (err) {
    problems.push(`KB-JWT does not parse: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }

  if (header.typ !== 'kb+jwt') {
    problems.push(`KB-JWT header typ is "${String(header.typ)}", expected "kb+jwt"`);
  }
  if (header.alg !== JWS_ALG) {
    problems.push(`KB-JWT alg is "${String(header.alg)}", expected ${JWS_ALG}`);
  }

  // sd_hash covers everything BEFORE the KB-JWT (RFC 9901 §4.2).
  const kbIndex = fullPresentation.lastIndexOf(kbJwt);
  const coveredBytes = kbIndex >= 0 ? fullPresentation.slice(0, kbIndex) : fullPresentation;
  if (typeof kb.sd_hash === 'string' && kb.sd_hash === computeSdHash(coveredBytes)) {
    empty.sdHashValid = true;
  } else {
    problems.push('KB sd_hash does not match this presentation (bytes were swapped or edited)');
  }

  const nonce = typeof kb.nonce === 'string' ? kb.nonce : null;
  const aud = typeof kb.aud === 'string' ? kb.aud : null;
  empty.nonce = nonce;
  empty.aud = aud;

  if (options.expectedNonce !== undefined) {
    if (nonce === options.expectedNonce) {
      empty.nonceValid = true;
    } else {
      problems.push(
        `KB nonce "${nonce ?? '(missing)'}" does not match this verification request — possible replay`,
      );
    }
  } else if (nonce) {
    empty.nonceValid = true; // well-formed, nothing to compare against
  }

  if (options.expectedAud !== undefined) {
    if (aud === options.expectedAud) {
      empty.audValid = true;
    } else {
      problems.push(`KB audience "${aud ?? '(missing)'}" is not this verifier — presentation was made for someone else`);
    }
  } else if (aud) {
    empty.audValid = true;
  }

  const maxAge = options.maxKbAgeSec ?? 600;
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof kb.iat === 'number' && kb.iat <= nowSec + 60 && nowSec - kb.iat <= maxAge) {
    empty.fresh = true;
  } else {
    problems.push('KB-JWT is stale or from the future (replay window exceeded)');
  }

  if (options.holderPublicJwk) {
    try {
      const publicKey = await importPublicJwkSafe(options.holderPublicJwk);
      await jwtVerify(kbJwt, publicKey, { algorithms: [JWS_ALG] });
      empty.signatureValid = true;
    } catch (err) {
      problems.push(`KB signature invalid (not the holder's key): ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    problems.push('KB-JWT present but no holder key was provided to check its signature against');
  }

  return empty;
}

/** Small indirection so this module keeps a single `jose` import surface. */
async function importPublicJwkSafe(jwk: JWK): Promise<KeyLike> {
  const { importJWK } = await import('jose');
  const key = await importJWK(jwk);
  if (key instanceof Uint8Array) {
    throw new Error('Key must be an asymmetric JWK, not raw bytes');
  }
  return key;
}

/** Read the signed payload without verifying (used by the wallet UI only). */
export function peekPayload(combinedOrJwt: string): SdJwtPayload {
  // A KB-JWT contains no "~", so splitting is safe either way.
  const first = combinedOrJwt.split('~')[0];
  return decodeJwt(first) as SdJwtPayload;
}

/** base64url decode helper re-exported for convenience in tests. */
export { base64urlDecode };
