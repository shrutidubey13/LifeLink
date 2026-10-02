/**
 * SD-JWT (Selective Disclosure JSON Web Token) — issuance, presentation and
 * verification.
 *
 * How it works, in one paragraph:
 *   When an issuer signs a credential, EVERY claim is turned into a salted
 *   "disclosure" string. The signed JWT contains only the SHA-256 digests of
 *   those disclosures in the `_sd` array — never the claim values. At
 *   presentation time the citizen's wallet picks a subset of the disclosures
 *   and sends `<jwt>~<disclosure>~<disclosure>~`. A verifier recomputes the
 *   digests and checks they appear in the signed `_sd` array, which proves the
 *   revealed values are the ones the issuer actually signed — while everything
 *   the citizen did not pick (salary, offer letter number, ...) stays hidden.
 *
 * Reference: draft-ietf-oauth-selective-disclosure-jwt (IETF OAuth WG).
 *
 * NOTE (scope): this is a deliberately simplified implementation. Real SD-JWT
 * adds issuer-signed key material (`_sd_iss`), nested claims, arrays and
 * holder key binding JWTs. See "Known limitations" in the README.
 */
import { SignJWT, decodeJwt, decodeProtectedHeader, jwtVerify, type JWK, type KeyLike } from 'jose';
import { JWS_ALG, base64urlDecode, base64urlEncode, digest, randomSalt } from './crypto';

/** One disclosed claim: { "<claim key>": <value>, "sd": "<random salt>" }. */
export type Disclosure = Record<string, unknown> & { sd: string };

/** A claim the citizen may choose to share, with everything needed to build a presentation. */
export interface DisclosedClaim {
  /** The claim name, e.g. "salary". */
  key: string;
  /** base64url(SHA-256(disclosure)) — the value signed inside `_sd`. */
  digest: string;
  /** The full disclosure string, e.g. "Zm9v.._eyJrZXki...". */
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
  /** Revocation pointer into the issuer's W3C Bitstring Status List. */
  status: { idx: number; url: string };
  /** base64url SHA-256 digests of the salted disclosures. No claim values here. */
  _sd: string[];
  [claim: string]: unknown;
}

export interface IssueInput {
  /** Issuer DID (did:web:...). */
  issuer: string;
  issuerPrivateKey: KeyLike;
  /** Citizen DID (did:key:...). */
  subject: string;
  /** Credential type, e.g. "DegreeCredential". */
  type: string;
  /** The claims. Every single one becomes an optional disclosure. */
  claims: Record<string, unknown>;
  issuedAt?: Date;
  expiresAt: Date;
  statusListUrl: string;
  statusIndex: number;
}

export interface IssuedCredential {
  /** The signed JWT (contains digests only). */
  jwt: string;
  /** Combined issuance format: <jwt>~<disclosure>~<disclosure>~... */
  combined: string;
  payload: SdJwtPayload;
  /** Every claim, in the order it was signed. Stored with the credential. */
  disclosedClaims: DisclosedClaim[];
}

/** Build the salted disclosure string for a single claim. */
function makeDisclosure(key: string, value: unknown, salt: string): { disclosure: string; digest: string } {
  const body: Disclosure = { [key]: value, sd: salt };
  // SD-JWT disclosure format: "<base64url(salt)>.<base64url(disclosure JSON)>".
  // The salt separator is a single "." — "~" is reserved for separating the JWT
  // from the disclosures in the combined format, so it must not appear here.
  // (base64url never contains ".", so the split is unambiguous.)
  const disclosure = `${salt}.${base64urlEncode(JSON.stringify(body))}`;
  return { disclosure, digest: digest(disclosure) };
}

/**
 * Sign a credential as an SD-JWT.
 *
 * The signed payload deliberately contains NO claim values — only digests.
 */
export async function issueSdJwt(input: IssueInput): Promise<IssuedCredential> {
  const issuedAt = input.issuedAt ?? new Date();
  const iat = Math.floor(issuedAt.getTime() / 1000);
  const exp = Math.floor(input.expiresAt.getTime() / 1000);

  const disclosedClaims: DisclosedClaim[] = [];
  for (const [key, value] of Object.entries(input.claims)) {
    const { disclosure, digest: claimDigest } = makeDisclosure(key, value, randomSalt());
    disclosedClaims.push({ key, digest: claimDigest, disclosure, value });
  }

  const payload: SdJwtPayload = {
    iss: input.issuer,
    sub: input.subject,
    iat,
    exp,
    vct: input.type,
    status: { idx: input.statusIndex, url: input.statusListUrl },
    _sd: disclosedClaims.map((c) => c.digest),
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

/** `<jwt>~<d1>~<d2>~` — the SD-JWT issuance / presentation wire format. */
export function formatCombined(jwt: string, disclosures: string[]): string {
  return `${jwt}~${disclosures.map((d) => `${d}~`).join('')}`;
}

/** Split `<jwt>~<d1>~<d2>~` into its parts (trailing empty strings are dropped). */
export function splitCombined(combined: string): { jwt: string; disclosures: string[] } {
  const parts = combined.split('~').filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error('Malformed SD-JWT: nothing to parse');
  }
  return { jwt: parts[0], disclosures: parts.slice(1) };
}

/** Decode one disclosure string into its claim key, value and salt. */
export function decodeDisclosure(disclosure: string): Disclosure {
  const dot = disclosure.indexOf('.');
  if (dot < 0) {
    throw new Error('Malformed disclosure: missing "." salt separator');
  }
  const json = base64urlDecode(disclosure.slice(dot + 1)).toString('utf8');
  const parsed = JSON.parse(json) as Disclosure;
  if (typeof parsed.sd !== 'string' || !parsed.sd) {
    throw new Error('Malformed disclosure: missing salt (sd)');
  }
  return parsed;
}

/** The claim name of a disclosure, e.g. "salary". */
export function disclosureKey(disclosure: string): string {
  const parsed = decodeDisclosure(disclosure);
  const keys = Object.keys(parsed).filter((k) => k !== 'sd');
  if (keys.length !== 1) {
    throw new Error(`Malformed disclosure: expected exactly 1 claim, found ${keys.length}`);
  }
  return keys[0];
}

/**
 * Read a stored credential (combined format) and index its disclosures by
 * claim key. The wallet uses this to show the citizen which fields exist and
 * to build a partial presentation.
 */
export function indexCredential(combined: string): {
  jwt: string;
  digests: string[];
  byKey: Map<string, DisclosedClaim>;
} {
  const { jwt, disclosures } = splitCombined(combined);
  const payload = decodeJwt(jwt) as SdJwtPayload;
  const digests = Array.isArray(payload._sd) ? payload._sd : [];

  const byKey = new Map<string, DisclosedClaim>();
  for (const disclosure of disclosures) {
    const parsed = decodeDisclosure(disclosure);
    const key = Object.keys(parsed).filter((k) => k !== 'sd')[0];
    if (!key || byKey.has(key)) continue; // ignore malformed/duplicate disclosures
    byKey.set(key, { key, digest: digest(disclosure), disclosure, value: parsed[key] });
  }
  return { jwt, digests, byKey };
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
  /** `<jwt>~<d1>~<d2>~` containing ONLY the selected disclosures. */
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

export interface ParsedPresentation {
  jwt: string;
  /** The signed payload (digests only — no claim values). */
  payload: SdJwtPayload;
  header: Record<string, unknown>;
  /** Claims the presenter chose to reveal, in presentation order. */
  revealed: Record<string, unknown>;
  /** Keys of the revealed claims (in presentation order). */
  revealedKeys: string[];
  /** Digests of the presented disclosures, for comparison against `_sd`. */
  presentedDigests: string[];
}

export interface VerifyResult extends ParsedPresentation {
  /** The EdDSA signature verified and `exp` is in the future. */
  signatureValid: boolean;
  /** Every presented disclosure matches a digest inside the signed `_sd` array. */
  digestsValid: boolean;
  /** Human readable notes about any integrity problem. */
  problems: string[];
}

/**
 * Verify a presentation.
 *
 * Runs exactly two technical checks:
 *   1. the EdDSA signature over the JWT (and the `exp` claim), and
 *   2. that every presented disclosure is covered by a signed `_sd` digest.
 *
 * Policy checks (is the issuer trusted? is the credential revoked? is there
 * consent?) are done by the caller in routes.ts, in the order the API contract
 * requires.
 */
export async function verifyPresentation(presentation: string, issuerPublicJwk: JWK): Promise<VerifyResult> {
  const problems: string[] = [];

  const { jwt, disclosures } = splitCombined(presentation);
  const header = decodeProtectedHeader(jwt) as Record<string, unknown>;
  const payload = decodeJwt(jwt) as SdJwtPayload;

  if (header.alg !== JWS_ALG) {
    problems.push(`Unexpected signing algorithm "${String(header.alg)}" (expected ${JWS_ALG})`);
  }

  // ---- Check 1: signature + expiry --------------------------------------
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

  // ---- Check 2: presented disclosures must be signed --------------------
  const signedDigests = new Set(Array.isArray(payload._sd) ? payload._sd : []);
  const revealed: Record<string, unknown> = {};
  const revealedKeys: string[] = [];
  const presentedDigests: string[] = [];
  let digestsValid = true;
  const seen = new Set<string>();

  for (const disclosure of disclosures) {
    let parsed: Disclosure;
    try {
      parsed = decodeDisclosure(disclosure);
    } catch (err) {
      digestsValid = false;
      problems.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    const key = Object.keys(parsed).filter((k) => k !== 'sd')[0];
    if (!key) {
      digestsValid = false;
      problems.push('Disclosure contains no claim');
      continue;
    }
    if (seen.has(key)) {
      digestsValid = false;
      problems.push(`Claim "${key}" was presented twice`);
      continue;
    }
    seen.add(key);

    const claimDigest = digest(disclosure);
    presentedDigests.push(claimDigest);
    if (!signedDigests.has(claimDigest)) {
      digestsValid = false;
      problems.push(`Claim "${key}" does not match any signed _sd digest`);
      continue;
    }

    revealed[key] = parsed[key];
    revealedKeys.push(key);
  }

  if (disclosures.length === 0) {
    digestsValid = false;
    problems.push('Presentation contains no disclosures');
  }

  return {
    jwt,
    payload,
    header,
    revealed,
    revealedKeys,
    presentedDigests,
    signatureValid,
    digestsValid,
    problems,
  };
}

/** Small indirection so this module keeps a single `jose` import surface. */
async function importPublicJwkSafe(jwk: JWK): Promise<KeyLike> {
  const { importJWK } = await import('jose');
  const key = await importJWK(jwk);
  if (key instanceof Uint8Array) {
    throw new Error('Issuer key must be an asymmetric JWK, not raw bytes');
  }
  return key;
}

/** Read the signed payload without verifying (used by the wallet UI only). */
export function peekPayload(combinedOrJwt: string): SdJwtPayload {
  const { jwt } = combinedOrJwt.includes('~') ? splitCombined(combinedOrJwt) : { jwt: combinedOrJwt };
  return decodeJwt(jwt) as SdJwtPayload;
}

/** base64url decode helper re-exported for convenience in tests. */
export { base64urlDecode };
