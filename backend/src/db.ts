/**
 * Tiny Postgres helper layer built on the `pg` package.
 *
 * We deliberately keep this file small: one shared connection pool, a `query`
 * shortcut, and a `withTransaction` helper (used by the audit log so that
 * concurrent writes are serialised with a Postgres advisory lock).
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.poolMax,
});

pool.on('error', (err) => {
  // A pooled idle client died (e.g. Postgres restarted). Log and move on; the
  // next query will transparently open a fresh connection.
  console.error('[db] idle client error:', err.message);
});

/** Run a single parameterised query. Always use $1/$2 placeholders, never string concat. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/** Convenience: first row or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

/**
 * Run `fn` inside a BEGIN/COMMIT transaction and hand it a dedicated client.
 * Rolls back automatically if `fn` throws.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Apply schema.sql. Every statement in schema.sql is `IF NOT EXISTS`, so this
 * is safe to run on every boot.
 */
export async function applySchema(): Promise<void> {
  // Resolves to backend/schema.sql both when running from src/ (tsx) and
  // from the compiled dist/ folder.
  const schemaPath = path.resolve(__dirname, '..', 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('[db] schema is up to date');
}

export async function closePool(): Promise<void> {
  await pool.end();
}
