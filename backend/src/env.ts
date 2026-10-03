/**
 * Environment validation + key generation helpers.
 *
 * The server calls `validateEnv()` at boot and FAILS FAST with a clear message
 * instead of running half-configured (e.g. with no key-encryption key, which
 * would silently leave issuer keys unprotected).
 *
 * Generate a fresh key-encryption key with:  npm run gen:key
 */
import { randomBytes } from 'node:crypto';

/** 32 bytes, hex-encoded (64 chars) — the AES-256 key for the KeyStore. */
export function generateKeyEncKey(): string {
  return randomBytes(32).toString('hex');
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): {
  issuerKeyEncKey: Buffer;
  isProduction: boolean;
} {
  const isProduction = (env.NODE_ENV ?? '').toLowerCase() === 'production';

  const raw = (env.ISSUER_KEY_ENC_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'ISSUER_KEY_ENC_KEY must be 64 hex characters (32 bytes). ' +
        'Generate one with `npm run gen:key` and put it in .env. ' +
        'The server refuses to start without it so issuer keys are never stored unprotected.',
    );
  }

  if (!env.AUTH_JWT_SECRET || env.AUTH_JWT_SECRET === 'dev-only-secret-change-me') {
    const message =
      'AUTH_JWT_SECRET is not set (or is still the dev default). Anyone holding it can mint login sessions.';
    if (isProduction) {
      throw new Error(`${message} Refusing to start in production.`);
    }
    console.warn(`[security] WARNING: ${message} Set a long random value in .env.`);
  }

  return { issuerKeyEncKey: Buffer.from(raw, 'hex'), isProduction };
}
