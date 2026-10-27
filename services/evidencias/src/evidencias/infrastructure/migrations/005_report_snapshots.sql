-- Immutable report snapshots and resumable generation, all references remain within Evidencias.
ALTER TABLE evidence.informe
 ADD COLUMN generation_status text NOT NULL DEFAULT 'pending' CHECK(generation_status IN ('pending','partial','ready','failed')),
 ADD COLUMN snapshot_version integer NOT NULL DEFAULT 0 CHECK(snapshot_version>=0),
 ADD COLUMN snapshot_data jsonb,
 ADD COLUMN missing_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN last_error text,
 ADD COLUMN generated_at timestamptz,
 ADD COLUMN snapshot_stale boolean NOT NULL DEFAULT true,
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0);
CREATE INDEX report_generation_due_idx ON evidence.informe(next_attempt_at,informe_id) WHERE generation_status IN ('pending','partial','failed');
CREATE INDEX report_workspace_created_idx ON evidence.informe(espacio_id,creado_en DESC,informe_id);
CREATE TABLE evidence.report_snapshot(report_id uuid NOT NULL REFERENCES evidence.informe(informe_id) ON DELETE CASCADE,version integer NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN ('partial','ready','failed')),snapshot_data jsonb NOT NULL,missing_sources jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),correlation_id text NOT NULL,PRIMARY KEY(report_id,version));
CREATE TABLE evidence.report_generation_request(report_id uuid NOT NULL REFERENCES evidence.informe(informe_id) ON DELETE CASCADE,account_id uuid NOT NULL,idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),response_data jsonb,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,PRIMARY KEY(report_id,account_id,idempotency_key));
GRANT SELECT,INSERT,UPDATE,DELETE ON evidence.report_snapshot,evidence.report_generation_request TO evidence_app;
