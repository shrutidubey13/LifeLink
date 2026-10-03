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

-- W3C VC 2.0 representation of the credential (see vc.ts). Added for wallets
-- and the `schema_valid` verification check.
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS vc_json JSONB;
-- The issuer-signed JWT alone (no disclosures). Used to locate the stored
-- credential during verification.
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS jwt TEXT;
UPDATE credentials SET jwt = split_part(sd_jwt, '~', 1) WHERE jwt IS NULL;

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
-- Custodial holder key for the demo wallet (AES-GCM envelope JSON, KeyStore).
-- Production wallets keep this key on-device; see README.
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS private_jwk_enc TEXT;
ALTER TABLE verifiers ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE verifiers ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Issuer login + trust states (PENDING/TRUSTED/SUSPENDED/REVOKED).
-- `trusted` is kept for backward compatibility; new code reads `status`.
ALTER TABLE issuers ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE issuers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE issuers ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE issuers ADD COLUMN IF NOT EXISTS private_key_enc TEXT;
UPDATE issuers SET status = CASE WHEN trusted THEN 'TRUSTED' ELSE 'SUSPENDED' END
  WHERE status IS NULL;

-- Organization capabilities (single ORGANIZATION role acts as issuer and/or
-- verifier; see auth.ts). Backward compatible: existing rows default to both.
ALTER TABLE issuers ADD COLUMN IF NOT EXISTS org_type TEXT;
ALTER TABLE issuers ADD COLUMN IF NOT EXISTS can_issue BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE issuers ADD COLUMN IF NOT EXISTS can_verify BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE issuers SET org_type = 'University' WHERE org_type IS NULL AND domain LIKE '%university%';
UPDATE issuers SET org_type = 'Employer' WHERE org_type IS NULL AND domain LIKE '%employer%';
UPDATE issuers SET org_type = 'Hospital' WHERE org_type IS NULL AND domain LIKE '%hospital%';
UPDATE issuers SET org_type = 'Bank' WHERE org_type IS NULL AND domain LIKE '%bank%';
UPDATE issuers SET org_type = 'College' WHERE org_type IS NULL;

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OpenID4VCI (pre-authorized code subset): offers + single-use access tokens.
CREATE TABLE IF NOT EXISTS credential_offers (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  issuer_id INTEGER NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
  citizen_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  claims JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issuance_tokens (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  offer_id INTEGER NOT NULL REFERENCES credential_offers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OpenID4VP-style presentation requests (nonce single-use => replay safe).
CREATE TABLE IF NOT EXISTS presentation_requests (
  id SERIAL PRIMARY KEY,
  verifier_id INTEGER NOT NULL REFERENCES verifiers(id) ON DELETE CASCADE,
  citizen_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL,
  requested_fields TEXT[] NOT NULL,
  purpose TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  aud TEXT NOT NULL,
  client_id TEXT NOT NULL,
  presentation_definition JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presentation_requests_nonce ON presentation_requests(nonce);

-- consents: requested/approved distinction + lifecycle states for the
-- verifier-request flow (CONSENT_REQUESTED -> CONSENT_APPROVED/CONSENT_REJECTED).
-- `fields` holds the APPROVED field list; `revoked` is kept for compatibility.
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

ALTER TABLE consents ADD COLUMN IF NOT EXISTS requested_fields TEXT[];
ALTER TABLE consents ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS presentation_request_id INTEGER
  REFERENCES presentation_requests(id) ON DELETE SET NULL;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS presentation TEXT;
-- A rejection may reference no specific credential (citizen owns several of a
-- type, or none yet), so the FK must be nullable.
ALTER TABLE consents ALTER COLUMN credential_id DROP NOT NULL;
UPDATE consents SET status = CASE WHEN revoked THEN 'REVOKED' ELSE 'APPROVED' END
  WHERE status IS NULL;
UPDATE consents SET requested_fields = fields WHERE requested_fields IS NULL;

CREATE INDEX IF NOT EXISTS idx_consents_citizen ON consents(citizen_id);
CREATE INDEX IF NOT EXISTS idx_consents_request ON consents(presentation_request_id);

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

-- Issuer/admin actions need an actor reference too (citizen/verifier columns
-- don't fit them). Payload always repeats the actor for readability.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS issuer_id INTEGER
  REFERENCES issuers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(id);

-- Citizen-submitted documents awaiting organization verification (Flow B).
-- An uploaded document NEVER becomes a credential by itself: it becomes
-- trusted ONLY after the authorized organization reviews it and issues a
-- signed credential (see routes.ts document handlers).
CREATE TABLE IF NOT EXISTS document_requests (
  id SERIAL PRIMARY KEY,
  citizen_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_name TEXT NOT NULL,
  document_ref TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  rejection_reason TEXT,
  credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewer TEXT
);

CREATE INDEX IF NOT EXISTS idx_document_requests_citizen ON document_requests(citizen_id);
CREATE INDEX IF NOT EXISTS idx_document_requests_org ON document_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_requests_status ON document_requests(status);
