/**
 * W3C Bitstring Status List — one bit per credential, per issuer.
 *
 * Reference: https://www.w3.org/TR/vc-bitstring-status-list/
 *
 * How it works, in one paragraph:
 *   When a credential is issued the issuer allocates the next free bit index.
 *   A bit of 0 means "valid"; flipping it to 1 means "revoked". The list is
 *   published as a real BitstringStatusListCredential (see
 *   getStatusListCredential): the bitstring is gzipped, base64url-encoded with
 *   the multibase prefix "u", and served from `GET /status-lists/:issuerId`.
 *   Every credential embeds a credentialStatus entry pointing at its index, so
 *   a verifier checks revocation from the list — never from a bare boolean,
 *   and without a blockchain.
 *
 * Prototype notes (see README): the list auto-grows by doubling when it fills
 * up (spec lists are fixed-size; ours refuses to overflow instead), and only
 * the revocation purpose is implemented (no suspension bit).
 */
import * as zlib from 'node:zlib';
import { query, queryOne, withTransaction } from './db';
import { base64urlDecode, base64urlEncode } from './crypto';
import type { IssuerRow, StatusListRow } from './types';

/**
 * Spec minimum: 16KB = 131,072 entries per list. (The old prototype used 1KB;
 * existing rows auto-grow on demand, see allocateStatusIndex.)
 */
export const INITIAL_BITS_BYTES = 16 * 1024;

/** Hard cap for auto-growth (1MB = 8M credentials per issuer — plenty). */
const MAX_BITS_BYTES = 1024 * 1024;

/** LSB-first bit order, as the specification requires. */
function bitPosition(index: number): { byte: number; mask: number } {
  return { byte: index >> 3, mask: 1 << index % 8 };
}

/** Read one bit. True = revoked. */
export function isRevoked(bits: Buffer, index: number): boolean {
  const { byte, mask } = bitPosition(index);
  if (byte >= bits.length) return false; // never issued
  return (bits[byte] & mask) === mask;
}

/** Return a copy of `bits` with `index` set to 1 (revoked). */
export function setRevoked(bits: Buffer, index: number): Buffer {
  const copy = Buffer.from(bits);
  const { byte, mask } = bitPosition(index);
  if (byte < copy.length) {
    copy[byte] = copy[byte] | mask;
  }
  return copy;
}

/** Serialise a bitstring per the spec: gzip, base64url, multibase "u" prefix. */
export function encodeBitstring(bits: Buffer): string {
  return `u${base64urlEncode(zlib.gzipSync(bits))}`;
}

/** Inverse of encodeBitstring (accepts the "u" prefix or a bare payload). */
export function decodeBitstring(encoded: string): Buffer {
  const payload = encoded.startsWith('u') ? encoded.slice(1) : encoded;
  return zlib.gunzipSync(base64urlDecode(payload));
}

/** Every revoked index — used by the status list endpoint for readability. */
export function revokedIndexes(bits: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length * 8; i += 1) {
    if (isRevoked(bits, i)) out.push(i);
  }
  return out;
}

/**
 * Reserve the next free status-list index for an issuer.
 *
 * Atomic UPSERT, so two credentials issued at the same time can never receive
 * the same index. If the list is full it doubles (up to MAX_BITS_BYTES);
 * beyond that issuance FAILS loudly instead of silently overflowing and
 * aliasing two credentials onto one bit.
 */
export async function allocateStatusIndex(issuerId: number): Promise<number> {
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [7_654_321]);
    const existing = await client.query<StatusListRow>(
      'SELECT * FROM status_lists WHERE issuer_id = $1 FOR UPDATE',
      [issuerId],
    );
    let row = existing.rows[0] ?? null;
    if (!row) {
      const inserted = await client.query<StatusListRow>(
        `INSERT INTO status_lists (issuer_id, bits, next_index)
         VALUES ($1, $2, 1) RETURNING *`,
        [issuerId, Buffer.alloc(INITIAL_BITS_BYTES, 0)],
      );
      return inserted.rows[0].next_index - 1;
    }
    if (row.next_index >= row.bits.length * 8) {
      const grown = row.bits.length * 2;
      if (grown > MAX_BITS_BYTES) {
        throw new Error(
          `Status list for issuer ${issuerId} is full (${row.bits.length * 8} entries). ` +
            `Create a new status list (new issuance period) instead of overflowing.`,
        );
      }
      const bigger = Buffer.alloc(grown, 0);
      row.bits.copy(bigger);
      await client.query('UPDATE status_lists SET bits = $1 WHERE issuer_id = $2', [bigger, issuerId]);
      row = { ...row, bits: bigger };
    }
    await client.query(
      'UPDATE status_lists SET next_index = next_index + 1, updated_at = NOW() WHERE issuer_id = $1',
      [issuerId],
    );
    return row.next_index;
  });
}

/** Load (or lazily create) an issuer's status list. */
export async function getStatusListRow(issuerId: number): Promise<StatusListRow> {
  const existing = await queryOne<StatusListRow>('SELECT * FROM status_lists WHERE issuer_id = $1', [
    issuerId,
  ]);
  if (existing) return existing;

  await query(
    `INSERT INTO status_lists (issuer_id, bits, next_index)
     VALUES ($1, $2, 0) ON CONFLICT (issuer_id) DO NOTHING`,
    [issuerId, Buffer.alloc(INITIAL_BITS_BYTES, 0)],
  );
  const created = await queryOne<StatusListRow>('SELECT * FROM status_lists WHERE issuer_id = $1', [
    issuerId,
  ]);
  if (!created) throw new Error(`Could not create status list for issuer ${issuerId}`);
  return created;
}

/** Flip a credential's bit to "revoked". Returns true if it was not already revoked. */
export async function revokeStatusIndex(issuerId: number, index: number): Promise<boolean> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<StatusListRow>(
      'SELECT * FROM status_lists WHERE issuer_id = $1 FOR UPDATE',
      [issuerId],
    );
    const row = rows[0];
    if (!row) throw new Error(`Issuer ${issuerId} has no status list`);

    const alreadyRevoked = isRevoked(row.bits, index);
    const bits = setRevoked(row.bits, index);

    await client.query(
      'UPDATE status_lists SET bits = $1, updated_at = NOW() WHERE issuer_id = $2',
      [bits, issuerId],
    );
    return !alreadyRevoked;
  });
}

/** Everything GET /status-lists/:issuerId returns. */
export interface StatusListCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: {
    id: string;
    type: 'BitstringStatusList';
    statusPurpose: 'revocation';
    encodedList: string;
  };
}

export interface StatusListView {
  issuerId: number;
  issuer: { name: string; did: string; domain: string };
  url: string;
  /** The spec-shaped status list credential (machine-readable revocation source). */
  credential: StatusListCredential;
  /** Prototype conveniences (NOT part of the spec): human-readable extras. */
  encoding: string;
  bitstring: string;
  bitsRawLength: number;
  nextIndex: number;
  revoked: { index: number; credentialId: number | null; type: string }[];
  updatedAt: string;
}

export function buildStatusListCredential(args: {
  url: string;
  issuerDid: string;
  validFrom: Date;
  encodedList: string;
}): StatusListCredential {
  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://www.w3.org/ns/credentials/status/v1',
    ],
    id: args.url,
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: args.issuerDid,
    validFrom: args.validFrom.toISOString(),
    credentialSubject: {
      id: `${args.url}#list`,
      type: 'BitstringStatusList',
      statusPurpose: 'revocation',
      encodedList: args.encodedList,
    },
  };
}

export async function getStatusListView(issuerId: number, appBaseUrl: string): Promise<StatusListView> {
  const issuer = await queryOne<IssuerRow>('SELECT * FROM issuers WHERE id = $1', [issuerId]);
  if (!issuer) throw new Error(`Issuer ${issuerId} not found`);

  const row = await getStatusListRow(issuerId);
  const revokedIndexesList = revokedIndexes(row.bits);

  // Look up which credential each revoked bit belongs to, so the response is
  // human readable as well as machine readable.
  const credentials = revokedIndexesList.length
    ? await query<{ id: number; type: string; status_index: number }>(
        `SELECT id, type, status_index FROM credentials
         WHERE issuer_id = $1 AND status_index = ANY($2::int[])
         ORDER BY status_index`,
        [issuerId, revokedIndexesList],
      )
    : { rows: [] as { id: number; type: string; status_index: number }[] };

  const credentialByIndex = new Map(credentials.rows.map((c) => [c.status_index, c]));

  const url = `${appBaseUrl}/status-lists/${issuerId}`;
  const bitstring = encodeBitstring(row.bits);

  return {
    issuerId,
    issuer: { name: issuer.name, did: issuer.did, domain: issuer.domain },
    url,
    credential: buildStatusListCredential({
      url,
      issuerDid: issuer.did,
      validFrom: row.updated_at,
      encodedList: bitstring,
    }),
    encoding: 'gzip + base64url with multibase "u" prefix, LSB-first bits (W3C Bitstring Status List)',
    bitstring,
    bitsRawLength: row.bits.length,
    nextIndex: row.next_index,
    revoked: revokedIndexesList.map((index) => {
      const match = credentialByIndex.get(index);
      return { index, credentialId: match?.id ?? null, type: match?.type ?? 'unknown' };
    }),
    updatedAt: row.updated_at.toISOString(),
  };
}
