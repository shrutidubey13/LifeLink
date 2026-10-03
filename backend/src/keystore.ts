/**
 * KeyStore — the ONLY place that touches private key material.
 *
 * Problem it solves: issuer signing keys (and custodial holder keys) used to
 * sit in Postgres as plaintext JSON. Now every private JWK is encrypted at
 * rest with AES-256-GCM, using the server-side ISSUER_KEY_ENC_KEY from the
 * environment. Postgres only ever sees the envelope {iv, tag, data}.
 *
 * Rules enforced here:
 *   - encryption/decryption happen only inside this module
 *   - private keys are never logged, never returned from any API, never put
 *     into error messages (callers only receive `KeyLike` objects)
 *   - new keys are ALWAYS stored encrypted
 *   - legacy plaintext columns are still readable (with a loud warning) so old
 *     demo databases keep working — but nothing new is ever written that way
 *
 * Honest scope note: this is envelope encryption for a hackathon prototype,
 * not an HSM. Key rotation (new kid, dual-sign window) is future work — the
 * seed script never rotates keys (see seed.ts), so issued credentials keep
 * verifying.
 */
import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import { importJWK, type JWK, type KeyLike } from 'jose';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;

export interface EncryptedJwk {
  v: 1;
  alg: typeof ALG;
  iv: string;
  tag: string;
  data: string;
}

function encKey(): Buffer {
  const raw = (process.env.ISSUER_KEY_ENC_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'ISSUER_KEY_ENC_KEY is missing or malformed (expected 64 hex chars). Run `npm run gen:key`.',
    );
  }
  return Buffer.from(raw, 'hex');
}

/** Encrypt a private JWK for storage. Returns the JSON envelope. */
export function encryptPrivateJwk(jwk: JWK): EncryptedJwk {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, encKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(jwk), 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: ALG,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: data.toString('base64url'),
  };
}

/** Decrypt a stored envelope back into a JWK object. */
export function decryptPrivateJwk(env: EncryptedJwk): JWK {
  if (!env || env.v !== 1 || env.alg !== ALG || !env.iv || !env.tag || !env.data) {
    throw new Error('KeyStore: malformed encrypted-key envelope');
  }
  const decipher = createDecipheriv(ALG, encKey(), Buffer.from(env.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(env.data, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as JWK;
}

/** Parse a TEXT column that holds the envelope JSON. */
export function parseEnvelope(raw: unknown): EncryptedJwk | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as EncryptedJwk) : (raw as EncryptedJwk);
    if (parsed && parsed.v === 1 && parsed.alg === ALG) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function toKeyLike(jwk: JWK): Promise<KeyLike> {
  const key = await importJWK(jwk);
  if (key instanceof Uint8Array) {
    throw new Error('KeyStore: expected an asymmetric JWK, got raw bytes');
  }
  return key;
}

/**
 * Load an issuer's signing key. Prefers the encrypted envelope; falls back to
 * the legacy plaintext column ONLY for databases seeded before encryption
 * existed (and says so loudly). Never throws the key material itself.
 */
export async function getIssuerSigningKey(args: {
  issuerId: number;
  issuerName: string;
  privateKeyEnc: unknown;
  privateJwkPlaintext: JWK | null;
}): Promise<KeyLike> {
  const env = parseEnvelope(args.privateKeyEnc);
  if (env) {
    return toKeyLike(decryptPrivateJwk(env));
  }
  if (args.privateJwkPlaintext && args.privateJwkPlaintext.kty) {
    console.warn(
      `[security] issuer #${args.issuerId} (${args.issuerName}) still uses a PLAINTEXT stored key. ` +
        `Re-run the seed or re-create the issuer so the key is encrypted at rest.`,
    );
    const key = await importJWK(args.privateJwkPlaintext);
    if (key instanceof Uint8Array) throw new Error('KeyStore: legacy issuer key is not asymmetric');
    return key;
  }
  throw new Error(`KeyStore: issuer #${args.issuerId} has no usable signing key`);
}

/** Load a citizen's (custodial demo-wallet) holder key for KB signing. */
export async function getHolderSigningKey(args: {
  citizenId: number;
  privateKeyEnc: unknown;
}): Promise<KeyLike> {
  const env = parseEnvelope(args.privateKeyEnc);
  if (!env) {
    throw new Error(
      `KeyStore: citizen #${args.citizenId} has no holder key (account created before holder binding existed). ` +
        `Register a new citizen account.`,
    );
  }
  return toKeyLike(decryptPrivateJwk(env));
}
