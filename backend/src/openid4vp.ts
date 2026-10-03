/**
 * Minimal but REAL OpenID4VP 1.0 presentation layer.
 *
 * Reference: https://openid.net/specs/openid-4-verifiable-presentations-1_0-final.html
 *
 * Implemented subset (hackathon scope, see README):
 *   Request          POST /verifier/requests        (verifier auth; creates a
 *                     presentation request with nonce + aud + requested claims)
 *   Request object   GET  /openid4vp/requests/:id   (citizen fetches the exact
 *                     request object the wallet will answer)
 *   Response         POST /wallet/presentations     (citizen approves a subset;
 *                     server mints the SD-JWT+KB bound to nonce+aud)
 *   Verification     POST /verifier/verify          (checks nonce/aud/KB/sd_hash
 *                     against the stored request — replays fail here)
 *
 * The request object below follows the OpenID4VP shape (client_id, nonce,
 * presentation_definition with input_descriptors). Transport is direct POST to
 * our own endpoints instead of SIOP/DIDComm, and there is no QR rendering —
 * the UI shows a copyable request reference instead. The cryptography that
 * matters (nonce single-use, audience binding, KB signature, sd_hash) is fully
 * enforced in sdjwt.ts + routes.ts.
 */
import { randomBytes } from 'node:crypto';
import { query, queryOne } from './db';
import { HttpError } from './config';
import type { CredentialType } from './schemas';

export interface PresentationRequestRow {
  id: number;
  verifier_id: number;
  citizen_id: number;
  credential_type: string;
  requested_fields: string[];
  purpose: string;
  nonce: string;
  aud: string;
  client_id: string;
  presentation_definition: PresentationDefinition;
  expires_at: Date;
  used: boolean;
  created_at: Date;
}

export interface PresentationDefinition {
  id: string;
  input_descriptors: {
    id: string;
    name: string;
    purpose: string;
    constraints: {
      fields: { path: string[]; purpose: string; optional?: boolean }[];
    };
  }[];
}

export function newNonce(): string {
  // 128-bit unpredictable nonce, single-use (UNIQUE column in the database).
  return randomBytes(16).toString('base64url');
}

/**
 * Build the presentation_definition for one credential type + field list.
 * Paths address the VC representation (`$.credentialSubject.<field>`) so the
 * request stays meaningful outside this prototype's SD-JWT transport.
 */
export function buildPresentationDefinition(args: {
  requestId: string;
  credentialType: CredentialType;
  requestedFields: string[];
  purpose: string;
}): PresentationDefinition {
  return {
    id: args.requestId,
    input_descriptors: [
      {
        id: `${args.requestId}-descriptor-1`,
        name: args.credentialType,
        purpose: args.purpose,
        constraints: {
          fields: args.requestedFields.map((field) => ({
            path: [`$.credentialSubject.${field}`],
            purpose: `Verify ${field}`,
          })),
        },
      },
    ],
  };
}

/** The request object the wallet fetches and answers (OpenID4VP §5). */
export function buildRequestObject(args: {
  row: PresentationRequestRow;
  requestUri: string;
}): Record<string, unknown> {
  return {
    client_id: args.row.client_id,
    response_mode: 'direct_post',
    response_uri: args.requestUri.replace(/\/requests\/\d+$/, '/responses'),
    nonce: args.row.nonce,
    aud: args.row.aud,
    expires_at: new Date(args.row.expires_at).toISOString(),
    presentation_definition: args.row.presentation_definition,
  };
}

export interface CreateRequestInput {
  verifierId: number;
  citizenId: number;
  credentialType: CredentialType;
  requestedFields: string[];
  purpose: string;
  aud: string;
  clientId: string;
  ttlSeconds?: number;
}

/** Persist a new presentation request (nonce is UNIQUE — collisions retry). */
export async function createPresentationRequest(
  input: CreateRequestInput,
): Promise<PresentationRequestRow> {
  const ttl = input.ttlSeconds ?? 30 * 60;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nonce = newNonce();
    try {
      const requestId = `req_${nonce.slice(0, 12)}`;
      const definition = buildPresentationDefinition({
        requestId,
        credentialType: input.credentialType,
        requestedFields: input.requestedFields,
        purpose: input.purpose,
      });
      const inserted = await queryOne<PresentationRequestRow>(
        `INSERT INTO presentation_requests
           (verifier_id, citizen_id, credential_type, requested_fields, purpose,
            nonce, aud, client_id, presentation_definition, expires_at, used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 NOW() + make_interval(secs => $10), FALSE)
         RETURNING *`,
        [
          input.verifierId,
          input.citizenId,
          input.credentialType,
          input.requestedFields,
          input.purpose,
          nonce,
          input.aud,
          input.clientId,
          JSON.stringify(definition),
          ttl,
        ],
      );
      return inserted as PresentationRequestRow;
    } catch (err) {
      // Unique-violation on the nonce: astronomically unlikely, just retry.
      if (attempt === 2) throw err;
    }
  }
  throw new Error('Could not allocate a unique request nonce');
}

export async function loadRequestById(id: number): Promise<PresentationRequestRow> {
  const row = await queryOne<PresentationRequestRow>('SELECT * FROM presentation_requests WHERE id = $1', [
    id,
  ]);
  if (!row) throw new HttpError(404, `Presentation request ${id} not found`);
  return row;
}

export async function loadRequestByNonce(nonce: string): Promise<PresentationRequestRow> {
  const row = await queryOne<PresentationRequestRow>(
    'SELECT * FROM presentation_requests WHERE nonce = $1',
    [nonce],
  );
  if (!row) {
    throw new HttpError(400, 'Unknown presentation nonce — this presentation answers no known request.');
  }
  return row;
}

/** Freshness rules shared by presentation creation and verification. */
export function assertRequestUsable(row: PresentationRequestRow, action: string): void {
  if (row.used) {
    throw new HttpError(410, `This presentation request was already ${action === 'verify' ? 'answered' : 'used'} (nonce single-use — replay rejected).`);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new HttpError(410, 'This presentation request has expired.');
  }
}

export async function markRequestUsed(id: number): Promise<void> {
  await query('UPDATE presentation_requests SET used = TRUE WHERE id = $1', [id]);
}
