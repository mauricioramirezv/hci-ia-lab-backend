-- Metadata tecnica; ninguna tabla de dominio se aprueba antes del MER.
CREATE SCHEMA IF NOT EXISTS evidence AUTHORIZATION evidence_owner;
CREATE TABLE IF NOT EXISTS evidence._service_metadata(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),service_name text NOT NULL CHECK(service_name='evidencias'),created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO evidence._service_metadata(singleton,service_name) VALUES(true,'evidencias') ON CONFLICT(singleton) DO NOTHING;
GRANT USAGE ON SCHEMA evidence TO evidence_app;
GRANT SELECT ON evidence._schema_migrations,evidence._service_metadata TO evidence_app;
