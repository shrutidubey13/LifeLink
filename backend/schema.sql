-- LifeLink PostgreSQL schema
-- Run with: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS citizens (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  did TEXT NOT NULL UNIQUE,
  public_jwk JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issuers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  did TEXT NOT NULL UNIQUE,
  public_jwk JSONB NOT NULL,
  private_jwk JSONB NOT NULL,
  trusted BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS status_lists (
  issuer_id INTEGER PRIMARY KEY REFERENCES issuers(id) ON DELETE CASCADE,
  bits BYTEA NOT NULL,
  next_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credentials (
  id SERIAL PRIMARY KEY,
  citizen_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  issuer_id INTEGER NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  sd_jwt TEXT NOT NULL,
  status_index INTEGER NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credentials_citizen ON credentials(citizen_id);
CREATE INDEX IF NOT EXISTS idx_credentials_issuer ON credentials(issuer_id);

CREATE TABLE IF NOT EXISTS verifiers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  did TEXT NOT NULL UNIQUE
);

-- Login columns. Added with ALTER ... IF NOT EXISTS so the migration is safe
-- to re-run on databases created before login existed (existing rows simply
-- get NULL until the seed script or registration backfills them).
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE verifiers ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE verifiers ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- consents: revoked column is a small documented superset of the spec
-- (spec listed no revoked flag; we expire early AND flag it so history is clear).
CREATE TABLE IF NOT EXISTS consents (
  id SERIAL PRIMARY KEY,
  citizen_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  verifier_id INTEGER NOT NULL REFERENCES verifiers(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  fields TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consents_citizen ON consents(citizen_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  citizen_id INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  verifier_id INTEGER REFERENCES verifiers(id) ON DELETE SET NULL,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  payload TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(id);
