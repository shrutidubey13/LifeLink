/**
 * Minimal but REAL OpenID4VCI 1.0 issuance layer.
 *
 * Reference: https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0-final.html
 *
 * Implemented subset (hackathon scope, see README):
 *   Issuer metadata  GET  /openid4vci/.well-known/credential-issuer
 *   Offer            POST /openid4vci/offers        (issuer auth; creates a
 *                                                   pre-authorized_code offer)
 *   Token            POST /openid4vci/token         (pre-authorized code grant;
 *                                                   single-use, 10-min TTL)
 *   Credential       POST /openid4vci/credential   (Bearer access token ->
 *                                                   SD-JWT credential)
 *
 * Deliberately NOT implemented: authorization-code flow, pushed authorization
 * requests, proof-of-possession (proof_types), batch issuance, deferred
 * issuance, notification endpoint. The module refuses unknown grant types and
 * unknown credential_configuration_ids instead of pretending.
 */
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { query, queryOne } from './db';
import { HttpError } from './config';
import { CREDENTIAL_TYPES, type CredentialType } from './schemas';

export interface CredentialOfferRow {
  id: number;
  code: string;
  issuer_id: number;
  citizen_id: number;
  type: string;
  claims: Record<string, unknown>;
  expires_at: Date;
  redeemed: boolean;
  created_at: Date;
}

export interface IssuanceTokenRow {
  id: number;
  token_hash: string;
  offer_id: number;
  expires_at: Date;
  used: boolean;
  created_at: Date;
}

function randomCode(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Credential Issuer metadata (OpenID4VCI §11.2), trimmed to what we serve:
 * our credential_configurations mirror the zod schemas in schemas.ts.
 */
export function buildIssuerMetadata(args: {
  credentialIssuer: string;
  authorizationServers?: string[];
}): Record<string, unknown> {
  const configurations: Record<string, unknown> = {};
  for (const type of CREDENTIAL_TYPES) {
    configurations[type] = {
      format: 'vc+sd-jwt',
      scope: `lifelink:${type}`,
      credential_definition: { type: ['VerifiableCredential', type] },
      proof_types_supported: {},
    };
  }
  return {
    credential_issuer: args.credentialIssuer,
    authorization_servers: args.authorizationServers ?? [],
    credential_endpoint: `${args.credentialIssuer}/openid4vci/credential`,
    token_endpoint: `${args.credentialIssuer}/openid4vci/token`,
    credential_configurations_supported: configurations,
    grant_types_supported: ['urn:ietf:params:oauth:grant-type:pre-authorized_code'],
  };
}

/** Create a credential offer carrying a single-use pre-authorized_code. */
export async function createCredentialOffer(args: {
  issuerId: number;
  citizenId: number;
  type: CredentialType;
  claims: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<{ offer: Record<string, unknown>; code: string }> {
  const ttl = args.ttlSeconds ?? 15 * 60;
  const code = `offer_${randomCode()}`;
  await query(
    `INSERT INTO credential_offers (code, issuer_id, citizen_id, type, claims, expires_at, redeemed)
     VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6), FALSE)`,
    [code, args.issuerId, args.citizenId, args.type, JSON.stringify(args.claims), ttl],
  );
  return {
    code,
    offer: {
      credential_issuer: 'lifelink',
      credential_configuration_ids: [args.type],
      grants: {
        'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': code },
      },
    },
  };
}

/** Validate + redeem a pre-authorized_code (single-use). */
export async function redeemOffer(code: string): Promise<CredentialOfferRow> {
  const row = await queryOne<CredentialOfferRow>('SELECT * FROM credential_offers WHERE code = $1', [code]);
  if (!row) throw new HttpError(400, 'Unknown credential offer code.');
  if (row.redeemed) throw new HttpError(400, 'This credential offer was already redeemed.');
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new HttpError(400, 'This credential offer has expired.');
  }
  await query('UPDATE credential_offers SET redeemed = TRUE WHERE id = $1', [row.id]);
  return { ...row, redeemed: true };
}

/** Mint a short-lived Bearer access token bound to one redeemed offer. */
export async function mintIssuanceToken(offerId: number, ttlSeconds = 600): Promise<string> {
  const token = `iss_${randomCode(32)}`;
  await query(
    `INSERT INTO issuance_tokens (token_hash, offer_id, expires_at, used)
     VALUES ($1, $2, NOW() + make_interval(secs => $3), FALSE)`,
    [tokenHash(token), offerId, ttlSeconds],
  );
  return token;
}

/** Validate + consume a Bearer access token (single-use). Returns the offer. */
export async function consumeIssuanceToken(token: string): Promise<CredentialOfferRow> {
  const found = await queryOne<IssuanceTokenRow>('SELECT * FROM issuance_tokens WHERE token_hash = $1', [
    tokenHash(token),
  ]);
  if (!found) throw new HttpError(401, 'Unknown or malformed issuance access token.');
  if (found.used) throw new HttpError(401, 'This issuance access token was already used.');
  if (new Date(found.expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, 'This issuance access token has expired.');
  }
  await query('UPDATE issuance_tokens SET used = TRUE WHERE id = $1', [found.id]);
  const offer = await queryOne<CredentialOfferRow>('SELECT * FROM credential_offers WHERE id = $1', [
    found.offer_id,
  ]);
  if (!offer) throw new HttpError(401, 'The credential offer behind this token no longer exists.');
  return offer;
}
