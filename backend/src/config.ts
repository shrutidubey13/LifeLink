/**
 * Central configuration.
 *
 * Everything is read from environment variables (see .env.example) so the same
 * code can run on a laptop, in a container, or on a free cloud Postgres.
 */
import 'dotenv/config';

const port = Number(process.env.PORT ?? 4000);

export const config = {
  /** Port the Express API listens on. */
  port,
  /** Postgres connection string. */
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/gitlink',
  /**
   * Maximum number of pooled Postgres clients. Lower it to 1 if you run
   * Postgres behind a single-session proxy (e.g. PGlite during testing).
   */
  poolMax: Number(process.env.PG_POOL_MAX ?? 10),
  /**
   * Public base URL of this API. It is used to build the credential status list
   * URL that gets embedded inside every SD-JWT (`status.url`), so a verifier can
   * find the issuer's revocation bitstring.
   */
  appBaseUrl: process.env.APP_BASE_URL ?? `http://localhost:${port}`,
  /**
   * When true, the server applies schema.sql on boot.
   */
  autoMigrate: (process.env.AUTO_MIGRATE ?? 'true').toLowerCase() !== 'false',
  /**
   * Secret used to sign login session tokens (HS256). Must be replaced with
   * a long random value in production — anyone holding it can mint sessions.
   */
  authJwtSecret: process.env.AUTH_JWT_SECRET ?? 'change-me-production-secret',
  /** How long a login session lasts, in seconds (default: 12 hours). */
  authTokenTtlSeconds: Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 12 * 60 * 60),
};

/**
 * An error that is safe to show to the client.
 *
 * Anything thrown that is NOT an HttpError is treated as a bug/500 by the
 * central error handler in server.ts (and its details are never leaked).
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}
