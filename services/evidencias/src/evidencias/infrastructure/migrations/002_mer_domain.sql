-- Modelo ER v2.1; propietario: evidencias. Referencias a otros servicios son UUID opacos.

CREATE SCHEMA IF NOT EXISTS evidence AUTHORIZATION evidence_owner;

CREATE TABLE evidence.sesion_ux (
  sesion_ux_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL ,
  cuenta_id uuid NOT NULL ,
  tipo_sesion text NOT NULL CHECK(tipo_sesion IN ('page','example')),
  ruta text NOT NULL, participante_alias text, tarea text, prototipo text, objetivo text, notas text,
  destino text CHECK(destino IN ('page','example')), sistema_coordenadas text CHECK(sistema_coordenadas IN ('document','example-content')),
  condicion_ejemplo text CHECK(condicion_ejemplo IN ('good','bad')),
  modo text NOT NULL CHECK(modo IN ('observed','cursor','F','Gutenberg','none','mixed')),
  origen_dato text NOT NULL CHECK(origen_dato IN ('measured','simulated','mixed')),
  ancho_documento integer NOT NULL CHECK(ancho_documento>0), alto_documento integer NOT NULL CHECK(alto_documento>0),
  ancho_ventana integer NOT NULL CHECK(ancho_ventana>0), alto_ventana integer NOT NULL CHECK(alto_ventana>0),
  duracion_ms bigint NOT NULL CHECK(duracion_ms>=0), profundidad_maxima_pct numeric NOT NULL CHECK(profundidad_maxima_pct BETWEEN 0 AND 100),
  cantidad_clics integer NOT NULL DEFAULT 0 CHECK(cantidad_clics>=0), eventos_rueda integer NOT NULL DEFAULT 0 CHECK(eventos_rueda>=0),
  error_validacion_px numeric CHECK(error_validacion_px IS NULL OR error_validacion_px>=0), puntos_limitados boolean NOT NULL DEFAULT false,
  iniciada_en timestamptz NOT NULL DEFAULT now(), finalizada_en timestamptz,
  CHECK(finalizada_en IS NULL OR finalizada_en>=iniciada_en),
  CHECK((destino IS NULL AND sistema_coordenadas IS NULL) OR (destino='page' AND sistema_coordenadas='document') OR (destino='example' AND sistema_coordenadas='example-content'))
);

CREATE TABLE evidence.sesion_ux_exposicion (
  sesion_ux_id uuid NOT NULL REFERENCES evidence.sesion_ux ON DELETE CASCADE, banda text NOT NULL,
  segundos numeric NOT NULL CHECK(segundos>=0), PRIMARY KEY(sesion_ux_id,banda)
);

CREATE TABLE evidence.validacion_calibracion (
  sesion_ux_id uuid PRIMARY KEY REFERENCES evidence.sesion_ux ON DELETE CASCADE,
  error_mediano_px numeric NOT NULL CHECK(error_mediano_px>=0), ancho_ventana integer NOT NULL CHECK(ancho_ventana>0),
  alto_ventana integer NOT NULL CHECK(alto_ventana>0), cantidad_muestras integer NOT NULL CHECK(cantidad_muestras>=0), validada_en timestamptz NOT NULL
);

CREATE TABLE evidence.evento_ux (
  evento_ux_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, sesion_ux_id uuid NOT NULL REFERENCES evidence.sesion_ux ON DELETE CASCADE,
  canal text NOT NULL CHECK(canal IN ('click','pointer','gaze','simulation','scroll','wheel','mode')),
  ocurrido_ms bigint NOT NULL CHECK(ocurrido_ms>=0), x numeric, y numeric, peso numeric, area text, ruta text,
  scroll_top_px numeric CHECK(scroll_top_px IS NULL OR scroll_top_px>=0),
  profundidad_pct numeric CHECK(profundidad_pct IS NULL OR profundidad_pct BETWEEN 0 AND 100),
  direccion text, modo text CHECK(modo IS NULL OR modo IN ('cursor','F','Gutenberg','none')),
  origen_dato text NOT NULL CHECK(origen_dato IN ('measured','simulated','mixed'))
);

CREATE TABLE evidence.consentimiento (
  consentimiento_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sesion_ux_id uuid NOT NULL REFERENCES evidence.sesion_ux ON DELETE CASCADE,
  proposito text NOT NULL, version_aviso text NOT NULL, otorgado boolean NOT NULL,
  registrado_en timestamptz NOT NULL DEFAULT now(), revocado_en timestamptz
);

CREATE TABLE evidence.evidencia (
  evidencia_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL ,
  creada_por uuid NOT NULL , nombre text NOT NULL, mime text NOT NULL,
  bytes bigint NOT NULL CHECK(bytes>=0), sha256 char(64) NOT NULL, ubicacion text NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now(), eliminada_en timestamptz
);

CREATE TABLE evidence.entrega_evidencia (
  entrega_id uuid NOT NULL , evidencia_id uuid NOT NULL REFERENCES evidence.evidencia ON DELETE RESTRICT,
  PRIMARY KEY(entrega_id,evidencia_id)
);

CREATE TABLE evidence.informe (
  informe_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), solicitado_por uuid NOT NULL ,
  espacio_id uuid NOT NULL , grupo_id uuid ,
  nombre_proyecto text, objetivo text, metodo text, interpretacion text, mejoras text, limites text, conclusiones text, referencias text,
  incluir_comparacion boolean NOT NULL DEFAULT false, justificacion text,
  formato text NOT NULL CHECK(formato IN ('pdf','markdown','csv','json')), creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence.evento_laboratorio (
  evento_laboratorio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL ,
  cuenta_id uuid NOT NULL ,
  tipo text NOT NULL CHECK(tipo IN ('flow-start','flow-error','flow-complete','appointment-change','ai-run','export')),
  ocurrido_en timestamptz NOT NULL DEFAULT now(), duracion_segundos numeric CHECK(duracion_segundos IS NULL OR duracion_segundos>=0), detalle text
);

CREATE TABLE evidence.verificacion_accesibilidad (
  verificacion_accesibilidad_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL ,
  cuenta_id uuid NOT NULL , codigo text NOT NULL, superada boolean NOT NULL,
  verificada_en timestamptz NOT NULL DEFAULT now(), UNIQUE(espacio_id,codigo)
);

CREATE TABLE evidence.informe_registro (
  informe_registro_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), informe_id uuid NOT NULL REFERENCES evidence.informe ON DELETE CASCADE,
  seccion text NOT NULL CHECK(seccion IN ('selected','before','after')), orden integer NOT NULL CHECK(orden>0),
  ejecucion_id uuid ,
  persona_id uuid , escenario_id uuid ,
  reserva_id uuid , hallazgo_id uuid ,
  sesion_evaluacion_id uuid , sesion_ux_id uuid REFERENCES evidence.sesion_ux ON DELETE RESTRICT,
  evidencia_id uuid REFERENCES evidence.evidencia ON DELETE RESTRICT, usuario_demo_id uuid ,
  evidencia_multimodal_id uuid ,
  evento_laboratorio_id uuid REFERENCES evidence.evento_laboratorio ON DELETE RESTRICT,
  verificacion_accesibilidad_id uuid REFERENCES evidence.verificacion_accesibilidad ON DELETE RESTRICT,
  CHECK(num_nonnulls(ejecucion_id,persona_id,escenario_id,reserva_id,hallazgo_id,sesion_evaluacion_id,sesion_ux_id,evidencia_id,usuario_demo_id,evidencia_multimodal_id,evento_laboratorio_id,verificacion_accesibilidad_id)=1),
  UNIQUE(informe_id,seccion,orden)
);

CREATE INDEX evento_ux_sesion_tiempo_idx ON evidence.evento_ux(sesion_ux_id,ocurrido_ms);

CREATE TABLE evidence.audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL, event_type text NOT NULL, resource_type text NOT NULL, resource_id text, outcome text NOT NULL CHECK(outcome IN ('success','denied','failure')), occurred_at timestamptz NOT NULL DEFAULT now(), correlation_id uuid);

CREATE INDEX audit_events_resource_time_idx ON evidence.audit_events(resource_type,resource_id,occurred_at DESC);

GRANT USAGE ON SCHEMA evidence TO evidence_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA evidence TO evidence_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA evidence TO evidence_app;

ALTER DEFAULT PRIVILEGES FOR ROLE evidence_owner IN SCHEMA evidence GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO evidence_app;

ALTER DEFAULT PRIVILEGES FOR ROLE evidence_owner IN SCHEMA evidence GRANT USAGE, SELECT ON SEQUENCES TO evidence_app;
