-- Medharya server repository, PostgreSQL schema version 1.
-- Apply once with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_initial.sql

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT users_id_length CHECK (char_length(id) BETWEEN 1 AND 200),
  CONSTRAINT users_email_length CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT users_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT users_password_hash_length CHECK (char_length(password_hash) BETWEEN 1 AND 500),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT projects_id_length CHECK (char_length(id) BETWEEN 1 AND 200),
  CONSTRAINT projects_workspace_object CHECK (jsonb_typeof(workspace) = 'object'),
  CONSTRAINT projects_timestamps_order CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS anonymous_drafts (
  id text PRIMARY KEY,
  request jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  attached_user_id text REFERENCES users(id) ON DELETE CASCADE,
  attached_project_id text UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT anonymous_drafts_id_length CHECK (char_length(id) BETWEEN 1 AND 200),
  CONSTRAINT anonymous_drafts_request_object CHECK (jsonb_typeof(request) = 'object'),
  CONSTRAINT anonymous_drafts_timestamps_order CHECK (updated_at >= created_at),
  CONSTRAINT anonymous_drafts_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT anonymous_drafts_attachment_pair CHECK (
    (attached_user_id IS NULL AND attached_project_id IS NULL)
    OR (attached_user_id IS NOT NULL AND attached_project_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT sessions_id_length CHECK (char_length(id) BETWEEN 1 AND 200),
  CONSTRAINT sessions_token_hash_length CHECK (char_length(token_hash) = 64),
  CONSTRAINT sessions_token_hash_lowercase CHECK (token_hash = lower(token_hash)),
  CONSTRAINT sessions_token_hash_hex CHECK (translate(token_hash, '0123456789abcdef', '') = ''),
  CONSTRAINT sessions_expiry_order CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
CREATE INDEX IF NOT EXISTS projects_owner_updated_idx ON projects (owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS anonymous_drafts_expiry_idx ON anonymous_drafts (expires_at);
CREATE INDEX IF NOT EXISTS anonymous_drafts_attached_user_idx ON anonymous_drafts (attached_user_id);
CREATE INDEX IF NOT EXISTS sessions_user_expiry_idx ON sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

INSERT INTO schema_migrations (version)
VALUES ('001_initial')
ON CONFLICT (version) DO NOTHING;

COMMIT;
