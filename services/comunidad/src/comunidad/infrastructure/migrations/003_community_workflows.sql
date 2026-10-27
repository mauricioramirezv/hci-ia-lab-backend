-- Additive workflow metadata. The logical MER identities remain opaque across services.
ALTER TABLE community.sugerencia
  ADD COLUMN actualizada_en timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE community.reserva
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN clave_idempotencia uuid,
  ADD COLUMN request_hash char(64);

ALTER TABLE community.reserva
  ADD CONSTRAINT reserva_idempotency_pair_ck CHECK ((clave_idempotencia IS NULL) = (request_hash IS NULL));

CREATE UNIQUE INDEX reserva_account_idempotency_uq
  ON community.reserva(creada_por, clave_idempotencia)
  WHERE clave_idempotencia IS NOT NULL;
CREATE INDEX sugerencia_author_created_idx
  ON community.sugerencia(autor_id, creada_en DESC, sugerencia_id);
CREATE INDEX sugerencia_status_created_idx
  ON community.sugerencia(estado, creada_en DESC, sugerencia_id);
CREATE INDEX sugerencia_history_order_idx
  ON community.historial_sugerencia(sugerencia_id, cambiado_en DESC, historial_id DESC);
CREATE INDEX group_shared_workspace_active_idx
  ON community.espacio_trabajo_grupo(grupo_id, compartido_en DESC, espacio_id)
  WHERE revocado_en IS NULL;
CREATE INDEX reservation_owner_history_idx
  ON community.reserva(creada_por, fecha DESC, hora DESC, reserva_id);

CREATE TABLE community.write_idempotency (
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('group.create','suggestion.create','reservation.create')),
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL,
  response_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, operation, idempotency_key)
);
CREATE INDEX write_idempotency_created_idx ON community.write_idempotency(created_at);

ALTER TABLE community.write_idempotency OWNER TO community_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON community.write_idempotency TO community_app;
