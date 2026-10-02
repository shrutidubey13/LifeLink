/**
 * W3C Bitstring Status List — a single bit per credential, per issuer.
 *
 * How it works, in one paragraph:
 *   When a credential is issued the issuer allocates the next free bit index.
 *   A bit of 0 means "valid"; flipping it to 1 means "revoked". The whole
 *   bitstring is served gzipped + base64url encoded from
 *   `GET /status-lists/:issuerId`, and the URL + index are embedded in the
 *   signed SD-JWT. A verifier can therefore check revocation without asking the
 *   issuer for anything but a download — and without a blockchain.
 *
 * Reference: W3C Bitstring Status List v1.0.
 */
import * as zlib from 'node:zlib';
import { query, queryOne, withTransaction } from './db';
import { base64urlDecode, base64urlEncode } from './crypto';
import type { IssuerRow, StatusListRow } from './types';

/** Start with 8KB of bits => room for 65,536 credentials per issuer. */
export const INITIAL_BITS_BYTES = 1024;

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

/** Serialise a bitstring the way the spec wants it on the wire. */
export function encodeBitstring(bits: Buffer): string {
  return base64urlEncode(zlib.gzipSync(bits));
}

/** Inverse of encodeBitstring. */
export function decodeBitstring(encoded: string): Buffer {
  return zlib.gunzipSync(base64urlDecode(encoded));
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
 * This is a single atomic UPSERT inside a transaction, so two credentials
 * issued at the same time can never receive the same index.
 */
export async function allocateStatusIndex(issuerId: number): Promise<number> {
  const empty = Buffer.alloc(INITIAL_BITS_BYTES, 0);
  const result = await query<{ allocated: number }>(
    `INSERT INTO status_lists (issuer_id, bits, next_index)
     VALUES ($1, $2, 1)
     ON CONFLICT (issuer_id)
     DO UPDATE SET next_index = status_lists.next_index + 1, updated_at = NOW()
     RETURNING next_index - 1 AS allocated`,
    [issuerId, empty],
  );
  return result.rows[0].allocated;
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
export interface StatusListView {
  issuerId: number;
  issuer: { name: string; did: string; domain: string };
  url: string;
  encoding: string;
  /** gzipped + base64url, exactly as embedded in credentials. */
  bitstring: string;
  bitsRawLength: number;
  nextIndex: number;
  revoked: { index: number; credentialId: number | null; type: string }[];
  updatedAt: string;
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

  return {
    issuerId,
    issuer: { name: issuer.name, did: issuer.did, domain: issuer.domain },
    url: `${appBaseUrl}/status-lists/${issuerId}`,
    encoding: 'application/octet-stream (gzip + base64url), LSB-first bits',
    bitstring: encodeBitstring(row.bits),
    bitsRawLength: row.bits.length,
    nextIndex: row.next_index,
    revoked: revokedIndexesList.map((index) => {
      const match = credentialByIndex.get(index);
      return { index, credentialId: match?.id ?? null, type: match?.type ?? 'unknown' };
    }),
    updatedAt: row.updated_at.toISOString(),
  };
}
