/**
 * Database setup without psql: applies schema.sql through the `pg` driver.
 *
 *   npm run db:init
 *
 * Every statement in schema.sql is `IF NOT EXISTS`, so running it repeatedly is
 * harmless.
 */
import { applySchema, closePool } from './db';

applySchema()
  .then(() => {
    console.log('✔ Database schema ready.');
    return closePool();
  })
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('✖ Could not apply schema.sql');
    console.error(err instanceof Error ? err.message : err);
    console.error('Check that Postgres is running and DATABASE_URL in .env is correct.');
    process.exit(1);
  });
