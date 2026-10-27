-- Metadata tecnica; ninguna tabla de dominio se aprueba antes del MER.
CREATE SCHEMA IF NOT EXISTS community AUTHORIZATION community_owner;
CREATE TABLE IF NOT EXISTS community._service_metadata(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),service_name text NOT NULL CHECK(service_name='comunidad'),created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO community._service_metadata(singleton,service_name) VALUES(true,'comunidad') ON CONFLICT(singleton) DO NOTHING;
GRANT USAGE ON SCHEMA community TO community_app;
GRANT SELECT ON community._schema_migrations,community._service_metadata TO community_app;
