/**
 * Tamper-evident audit log (no blockchain).
 *
 * Every entry stores:
 *   payload    — canonical JSON text, so the hash can be recomputed later
 *   prev_hash  — the `hash` of the previous entry ("GENESIS" for the first)
 *   hash       — base64url(SHA-256(prev_hash + payload))
 *
 * Two properties fall out of this for free:
 *   1. Changing or deleting any historic entry breaks every hash after it.
 *   2. Appending is serialised with a Postgres advisory lock, so two
 *      simultaneous events can never read the same `prev_hash` and fork the
 *      chain.
 *
 * `GET /audit/verify` recomputes the whole chain to prove nothing was edited.
 */
import { query, withTransaction } from './db';
import { base64urlEncode, sha256 } from './crypto';
import type { AuditEventType, AuditLogRow } from './types';

/**
 * Arbitrary but fixed advisory-lock key. Every process appending to this log
 * uses the same number, which is what serialises the writes.
 */
const ADVISORY_LOCK_KEY = 918_273_645;

/** The `prev_hash` of the very first entry. */
export const GENESIS = 'GENESIS';

export interface AuditEventInput {
  eventType: AuditEventType;
  citizenId?: number | null;
  verifierId?: number | null;
  credentialId?: number | null;
  /** Any JSON-serialisable summary. Values are NOT stored (see README on privacy). */
  payload: Record<string, unknown>;
}

/**
 * Deterministic JSON: object keys are sorted, so hashing the same logical
 * payload always produces the same bytes.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = sortValue(source[key]);
    }
    return out;
  }
  return value;
}

/**
 * The one and only hash rule, used both when writing and when verifying:
 *   hash = base64url(SHA-256(utf8(prev_hash) + utf8(payload)))
 */
export function computeHash(prevHash: string, payload: string): string {
  return base64urlEncode(sha256(Buffer.concat([Buffer.from(prevHash, 'utf8'), Buffer.from(payload, 'utf8')])));
}

/**
 * Append one event to the chain.
 *
 * The whole read-previous-hash + insert sequence runs in one transaction that
 * first takes a transaction-scoped advisory lock, which guarantees the chain
 * stays linear even under concurrent requests.
 */
export async function appendAuditEvent(event: AuditEventInput): Promise<AuditLogRow> {
  const payload = stableStringify({
    eventType: event.eventType,
    citizenId: event.citizenId ?? null,
    verifierId: event.verifierId ?? null,
    credentialId: event.credentialId ?? null,
    ...event.payload,
  });

  return withTransaction(async (client) => {
    // Serialise all writers for this key until the transaction ends.
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);

    const { rows } = await client.query<{ hash: string }>(
      'SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1',
    );
    const prevHash = rows[0]?.hash ?? GENESIS;
    const hash = computeHash(prevHash, payload);

    const inserted = await client.query<AuditLogRow>(
      `INSERT INTO audit_log
         (event_type, citizen_id, verifier_id, credential_id, payload, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        event.eventType,
        event.citizenId ?? null,
        event.verifierId ?? null,
        event.credentialId ?? null,
        payload,
        prevHash,
        hash,
      ],
    );
    return inserted.rows[0];
  });
}

export interface ChainVerification {
  valid: boolean;
  /** Number of entries recomputed. */
  length: number;
  /** 1-based position of the first bad entry, or null. */
  brokenAtEntry: number | null;
  /** Its `id`, or null. */
  brokenAtId: number | null;
  /** Why it failed. */
  reason: string | null;
  headHash: string | null;
}

/**
 * Recompute the entire chain and report the first entry that does not match.
 * (Entry N is `id === N` only when nothing was ever deleted — we use the real
 * `id` so the report stays accurate even after deletions.)
 */
export async function verifyAuditChain(limit?: number): Promise<ChainVerification> {
  const result = await query<AuditLogRow>(
    limit
      ? 'SELECT * FROM audit_log ORDER BY id ASC LIMIT $1'
      : 'SELECT * FROM audit_log ORDER BY id ASC',
    limit ? [limit] : [],
  );
  const rows = result.rows;

  let prevHash = GENESIS;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const entryNumber = i + 1;
    const expected = computeHash(prevHash, row.payload);

    if (row.prev_hash !== prevHash) {
      return {
        valid: false,
        length: rows.length,
        brokenAtEntry: entryNumber,
        brokenAtId: row.id,
        reason: `entry #${entryNumber} (id ${row.id}) has prev_hash "${row.prev_hash}" but the previous entry hashes to "${prevHash}"`,
        headHash: prevHash,
      };
    }
    if (row.hash !== expected) {
      return {
        valid: false,
        length: rows.length,
        brokenAtEntry: entryNumber,
        brokenAtId: row.id,
        reason: `entry #${entryNumber} (id ${row.id}) hash "${row.hash}" does not match the recomputed "${expected}" — its payload was changed after signing`,
        headHash: prevHash,
      };
    }
    prevHash = row.hash;
  }

  return {
    valid: true,
    length: rows.length,
    brokenAtEntry: null,
    brokenAtId: null,
    reason: null,
    headHash: prevHash,
  };
}
