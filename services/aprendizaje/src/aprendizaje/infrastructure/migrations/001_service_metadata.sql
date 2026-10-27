-- Metadata tecnica; ninguna tabla de dominio se aprueba antes del MER.
CREATE SCHEMA IF NOT EXISTS learning AUTHORIZATION learning_owner;
CREATE TABLE IF NOT EXISTS learning._service_metadata(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),service_name text NOT NULL CHECK(service_name='aprendizaje'),created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO learning._service_metadata(singleton,service_name) VALUES(true,'aprendizaje') ON CONFLICT(singleton) DO NOTHING;
GRANT USAGE ON SCHEMA learning TO learning_app;
GRANT SELECT ON learning._schema_migrations,learning._service_metadata TO learning_app;
