-- Migration 001: Encrypted document files at rest
-- Creates document_files table and links to document_requests and credentials

CREATE TABLE IF NOT EXISTS document_files (
  id SERIAL PRIMARY KEY,
  owner INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL DEFAULT 'document.pdf',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  encrypted_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_files_owner ON document_files(owner);

ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS file_id INTEGER REFERENCES document_files(id) ON DELETE SET NULL;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS attachment_id INTEGER REFERENCES document_files(id) ON DELETE SET NULL;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS share_attachment BOOLEAN NOT NULL DEFAULT FALSE;
