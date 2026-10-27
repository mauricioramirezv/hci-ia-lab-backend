-- Iteración 8: idempotencia de escrituras y lectura eficiente del historial.
-- No se modifica el MER base ni se agregan referencias a otros servicios.
CREATE TABLE evidence.write_idempotency (
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('ux.session.create','consent.set','ux.events','ux.calibration','accessibility.check','evidence.metadata.create','report.create')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_hash char(64) NOT NULL,
  response_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,operation,idempotency_key)
);

CREATE INDEX evento_ux_sesion_tiempo_v2_idx ON evidence.evento_ux(sesion_ux_id,ocurrido_ms,evento_ux_id);
CREATE INDEX consentimiento_sesion_proposito_idx ON evidence.consentimiento(sesion_ux_id,proposito,registrado_en DESC);
CREATE INDEX evidencia_ejecucion_creacion_idx ON evidence.evidencia(ejecucion_id,creada_por,creada_en DESC) WHERE eliminada_en IS NULL;
CREATE INDEX informe_solicitante_workspace_idx ON evidence.informe(solicitado_por,espacio_id,creado_en DESC);
CREATE INDEX informe_registro_ux_session_idx ON evidence.informe_registro(sesion_ux_id) WHERE sesion_ux_id IS NOT NULL;
CREATE INDEX informe_registro_evidence_idx ON evidence.informe_registro(evidencia_id) WHERE evidencia_id IS NOT NULL;
CREATE INDEX informe_registro_lab_event_idx ON evidence.informe_registro(evento_laboratorio_id) WHERE evento_laboratorio_id IS NOT NULL;
CREATE INDEX informe_registro_a11y_idx ON evidence.informe_registro(verificacion_accesibilidad_id) WHERE verificacion_accesibilidad_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON evidence.write_idempotency TO evidence_app;
ALTER DEFAULT PRIVILEGES FOR ROLE evidence_owner IN SCHEMA evidence GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO evidence_app;
