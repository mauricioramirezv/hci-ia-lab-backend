-- Modelo ER v2.1; propietario: comunidad. Referencias a otros servicios son UUID opacos.

CREATE SCHEMA IF NOT EXISTS community AUTHORIZATION community_owner;

CREATE TABLE community.grupo (
  grupo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text NOT NULL, descripcion text,
  estado text NOT NULL DEFAULT 'active' CHECK(estado IN ('active','archived')),
  creado_por uuid NOT NULL , creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(), archivado_en timestamptz
);

CREATE TABLE community.membresia_grupo (
  grupo_id uuid NOT NULL REFERENCES community.grupo ON DELETE RESTRICT, cuenta_id uuid NOT NULL ,
  funcion text NOT NULL CHECK(funcion IN ('leader','participant')), estado text NOT NULL DEFAULT 'active' CHECK(estado IN ('invited','active','inactive','removed')),
  invitado_por uuid , unido_en timestamptz, retirado_en timestamptz,
  PRIMARY KEY(grupo_id,cuenta_id), CHECK(retirado_en IS NULL OR unido_en IS NULL OR retirado_en>=unido_en)
);

CREATE TABLE community.invitacion_grupo (
  invitacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grupo_id uuid NOT NULL REFERENCES community.grupo ON DELETE RESTRICT,
  codigo_hash text NOT NULL UNIQUE, correo_destino text, creada_por uuid NOT NULL ,
  creada_en timestamptz NOT NULL DEFAULT now(), expira_en timestamptz NOT NULL, revocada_en timestamptz,
  aceptada_por uuid , aceptada_en timestamptz,
  CHECK(expira_en>creada_en)
);

CREATE TABLE community.espacio_trabajo_grupo (
  espacio_id uuid NOT NULL , grupo_id uuid NOT NULL REFERENCES community.grupo ON DELETE RESTRICT,
  compartido_por uuid NOT NULL , compartido_en timestamptz NOT NULL DEFAULT now(), revocado_en timestamptz,
  PRIMARY KEY(espacio_id,grupo_id)
);

CREATE TABLE community.sugerencia (
  sugerencia_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), autor_id uuid NOT NULL ,
  categoria text NOT NULL, titulo text NOT NULL, descripcion text NOT NULL, anonima boolean NOT NULL DEFAULT false,
  estado text NOT NULL DEFAULT 'received' CHECK(estado IN ('received','reviewing','accepted','implemented','rejected')),
  creada_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community.historial_sugerencia (
  historial_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sugerencia_id uuid NOT NULL REFERENCES community.sugerencia ON DELETE RESTRICT,
  cambiado_por uuid , estado_anterior text, estado_nuevo text NOT NULL,
  respuesta text, cambiado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE community.servicio_reserva (
  servicio_codigo text PRIMARY KEY CHECK(servicio_codigo IN ('advice','workshop','health','visit','culture')),
  contexto text NOT NULL CHECK(contexto IN ('university','healthcare','culture')),
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE community.reserva (
  reserva_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL ,
  creada_por uuid NOT NULL , servicio_codigo text REFERENCES community.servicio_reserva ON DELETE RESTRICT,
  servicio_etiqueta text NOT NULL, fecha date NOT NULL, hora time without time zone NOT NULL,
  estado text NOT NULL DEFAULT 'confirmed' CHECK(estado IN ('confirmed','cancelled')),
  condicion text CHECK(condicion IN ('good','bad')), creada_en timestamptz NOT NULL DEFAULT now(), actualizada_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX membresia_cuenta_estado_idx ON community.membresia_grupo(cuenta_id,estado);

CREATE UNIQUE INDEX reserva_catalogo_confirmada_uq ON community.reserva(espacio_id,servicio_codigo,fecha,hora) WHERE estado='confirmed' AND servicio_codigo IS NOT NULL;

CREATE UNIQUE INDEX reserva_legacy_confirmada_uq ON community.reserva(espacio_id,lower(servicio_etiqueta),fecha,hora) WHERE estado='confirmed' AND servicio_codigo IS NULL;

INSERT INTO community.servicio_reserva(servicio_codigo,contexto) VALUES
 ('advice','university'),('workshop','university'),('health','healthcare'),('visit','culture'),('culture','culture');

CREATE TABLE community.audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL, event_type text NOT NULL, resource_type text NOT NULL, resource_id text, outcome text NOT NULL CHECK(outcome IN ('success','denied','failure')), occurred_at timestamptz NOT NULL DEFAULT now(), correlation_id uuid);

CREATE INDEX audit_events_resource_time_idx ON community.audit_events(resource_type,resource_id,occurred_at DESC);

GRANT USAGE ON SCHEMA community TO community_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA community TO community_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA community TO community_app;

ALTER DEFAULT PRIVILEGES FOR ROLE community_owner IN SCHEMA community GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO community_app;

ALTER DEFAULT PRIVILEGES FOR ROLE community_owner IN SCHEMA community GRANT USAGE, SELECT ON SEQUENCES TO community_app;
