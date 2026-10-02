/**
 * Express app entry point.
 *
 * Start with:  npm run dev     (hot reload, tsx)
 *              npm run build && npm start
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { HttpError, config } from './config';
import { applySchema, closePool } from './db';
import router from './routes';

export function createApp() {
  const app = express();

  // The Vite dev server runs on a different port, so CORS is required.
  app.use(cors());
  // Presentations are the largest payload (a credential with many claims).
  app.use(express.json({ limit: '1mb' }));

  // Small request log — helpful while demoing.
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
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[error] unhandled:', err);
    res.status(500).json({ error: 'Internal server error', details: message });
  });

  return app;
}

async function main(): Promise<void> {
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
