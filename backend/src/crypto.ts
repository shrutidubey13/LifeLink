/**
 * Cryptography helpers.
 *
 * - Ed25519 (EdDSA) key pairs via the `jose` library
 * - base64url helpers
 * - SHA-256 digests (used for SD-JWT `_sd` disclosures and the audit hash chain)
 * - `did:key` generation for citizens (W3C DID method, key-only identity)
 * - `did:web` formatting for issuers
 *
 * Everything here is intentionally dependency-light so a student team can read
 * it end to end.
 */
import { createHash, randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, importJWK, type JWK, type KeyLike } from 'jose';

/** JWS algorithm we use everywhere. */
export const JWS_ALG = 'EdDSA';

/** base64url encode (no padding) — the encoding used by JWTs and DIDs. */
export function base64urlEncode(input: Buffer | Uint8Array | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buf.toString('base64url');
}

/** base64url decode -> Buffer. */
export function base64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/** Raw SHA-256 bytes. */
export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

/**
 * base64url(SHA-256(ASCII(input))) — the exact form stored in an SD-JWT's `_sd`
 * array. Base64url (not hex) is what the SD-JWT specification requires.
 */
export function digest(input: string): string {
  return base64urlEncode(sha256(input));
}

/** A fresh random salt for one disclosure (128 bits). */
export function randomSalt(): string {
  return base64urlEncode(randomBytes(16));
}

/** Bitcoin's base58 alphabet, used by did:key. */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Minimal base58btc encoder (multibase prefix "z").
 *
 * We implement it here (10 lines) instead of adding a dependency.
 */
export function base58Encode(bytes: Buffer): string {
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;

  // Repeatedly divide the number by 58, collecting remainders.
  const digits: number[] = [];
  for (let i = zeroes; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  return '1'.repeat(zeroes) + digits.reverse().map((d) => BASE58_ALPHABET[d]).join('');
}

/**
 * Build a `did:key` DID from an Ed25519 public JWK.
 *
 * did:key = "did:key:z" + base58btc( 0xed01 (ed25519-pub multicodec) || rawPublicKey )
 */
export function didKeyFromPublicJwk(jwk: JWK): string {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) {
    throw new Error('did:key: expected an Ed25519 public JWK');
  }
  const raw = base64urlDecode(jwk.x);
  // 0xed 0x01 is the unsigned-varint multicodec prefix for an ed25519 public key.
  const multicodec = Buffer.from([0xed, 0x01]);
  return `did:key:z${base58Encode(Buffer.concat([multicodec, raw]))}`;
}

/** did:web DIDs embed the host, with ":" percent-encoded (e.g. localhost%3A4000). */
export function didWeb(hostWithPort: string): string {
  return `did:web:${hostWithPort.replace(/:/g, '%3A')}`;
}

export interface Ed25519KeyPair {
  publicJwk: JWK;
  privateJwk: JWK;
  publicKey: KeyLike;
  privateKey: KeyLike;
}

/** Create a brand new Ed25519 key pair. Used when seeding issuers and citizens. */
export async function generateEd25519KeyPair(): Promise<Ed25519KeyPair> {
  const { publicKey, privateKey } = await generateKeyPair('Ed25519');
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const privateJwk = (await exportJWK(privateKey)) as JWK;
  return { publicJwk, privateJwk, publicKey, privateKey };
}

/** Load a stored public JWK (e.g. an issuer key from the trust registry). */
export async function importPublicJwk(jwk: JWK): Promise<KeyLike> {
  return jwkToKeyLike(await importJWK(jwk));
}

/** Load a stored private JWK. Only mock issuers keep these (see README). */
export async function importPrivateJwk(jwk: JWK): Promise<KeyLike> {
  return jwkToKeyLike(await importJWK(jwk));
}

/**
 * `importJWK` is typed as "KeyLike | Uint8Array" because it can also produce
 * raw bytes for symmetric keys. We only ever use asymmetric keys here, so a
 * Uint8Array means the JWK was malformed — fail loudly instead of signing with
 * the wrong thing.
 */
function jwkToKeyLike(key: KeyLike | Uint8Array): KeyLike {
  if (key instanceof Uint8Array) {
    throw new Error('Expected an asymmetric JWK, but jose returned raw key bytes');
  }
  return key;
}
