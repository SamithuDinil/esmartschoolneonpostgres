-- Neon/PostgreSQL persistence for Edusphere.
-- Application records are stored as JSONB documents addressed by their existing
-- tenant-scoped document path (e.g. schools/<schoolId>/students/<studentId>).
-- Firebase Authentication remains the identity provider; Firebase UIDs are
-- referenced in document payloads and are not mirrored as password records.

CREATE TABLE IF NOT EXISTS app_documents (
  path text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_documents_path_pattern_idx
  ON app_documents (path text_pattern_ops);
CREATE INDEX IF NOT EXISTS app_documents_data_gin_idx
  ON app_documents USING gin (data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS app_documents_updated_at_idx
  ON app_documents (updated_at DESC);

-- Keep tenant documents and all child records under schools/<schoolId>/...
-- Authorization remains enforced by the server using Firebase-verified sessions.
COMMENT ON TABLE app_documents IS
  'Edusphere application data; Firebase Auth is the identity provider. Access only via trusted server routes.';
