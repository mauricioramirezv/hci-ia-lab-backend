-- Metadata tecnica; ninguna tabla de dominio se aprueba antes del MER.
CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION identity_owner;
CREATE TABLE IF NOT EXISTS identity._service_metadata(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),service_name text NOT NULL CHECK(service_name='identidad'),created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO identity._service_metadata(singleton,service_name) VALUES(true,'identidad') ON CONFLICT(singleton) DO NOTHING;
GRANT USAGE ON SCHEMA identity TO identity_app;
GRANT SELECT ON identity._schema_migrations,identity._service_metadata TO identity_app;
