/**
 * Express app entry point.
 *
 * Start with:  npm run dev     (hot reload, tsx)
 *              npm run build && npm start
 *
 * Hardening applied here (hackathon-proportionate, see README § Security):
 *   - env validated at boot (fail fast when the key-encryption key is missing)
 *   - helmet security headers
 *   - strict CORS origin (one frontend origin, no credentials needed)
 *   - rate limits: tight on auth/token endpoints (brute-force protection),
 *     generous elsewhere so demos never trip it
 *   - 1MB JSON body cap (presentations are the largest payload)
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { HttpError, config } from './config';
import { validateEnv } from './env';
import { applySchema, closePool } from './db';
import router from './routes';

export function createApp() {
  const app = express();

  // Trust proxy headers only when explicitly behind one (default: no).
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : 0);

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  // Presentations are the largest payload (a credential with many claims).
  app.use(express.json({ limit: '1mb' }));

  // Brute-force protection on anything that mints or redeems secrets.
  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Wait a minute and try again.' },
  });
  app.use(['/auth/', '/openid4vci/token'], authLimiter);

  // General safety net (high enough to never trip during a demo).
  const generalLimiter = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Slow down and try again.' },
  });
  app.use(generalLimiter);

  // Small request log — helpful while demoing. Never logs bodies, tokens,
  // keys, or disclosures.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
    });
    next();
  });

  app.use(router);

  // 404 for unknown endpoints.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new HttpError(404, `No route for ${req.method} ${req.originalUrl}`));
  });

  // Central error handler. Only HttpError messages are sent to the client;
  // anything else is an unexpected bug and is logged with a generic 500.
  // Validation details (zod issues) ARE safe: they describe the caller's own
  // input, never secrets.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
      return;
    }
    // Errors raised by express.json(): malformed JSON / oversized body are the
    // caller's fault (4xx), not a server bug.
    const bodyErr = err as { type?: string; status?: number } | null;
    if (bodyErr?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    if (bodyErr?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body is too large (1MB limit)' });
      return;
    }
    console.error('[error] unhandled:', err);
    // Never leak internal error text (SQL, stack hints) to the client.
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function main(): Promise<void> {
  // Fail fast on bad/missing secrets BEFORE touching the database.
  try {
    validateEnv();
  } catch (err) {
    console.error('[env]', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (config.autoMigrate) {
    try {
      await applySchema();
    } catch (err) {
      console.error('[db] could not apply schema.sql — is Postgres running and DATABASE_URL correct?');
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`LifeLink API listening on http://localhost:${config.port}`);
    console.log(`Health check: http://localhost:${config.port}/health`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close(() => {
      closePool().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only auto-start when this file is the entry point (so tests can import createApp).
if (require.main === module) {
  main().catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
}
