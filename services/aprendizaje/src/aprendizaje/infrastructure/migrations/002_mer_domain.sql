-- Modelo ER v2.1; propietario: aprendizaje. Referencias a otros servicios son UUID opacos.

CREATE SCHEMA IF NOT EXISTS learning AUTHORIZATION learning_owner;

CREATE TABLE learning.espacio_trabajo (
  espacio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), propietario_id uuid NOT NULL ,
  nombre text NOT NULL, creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now(), archivado_en timestamptz
);

CREATE TABLE learning.modulo (
  modulo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE, nombre text NOT NULL, descripcion text, ruta text
);

CREATE TABLE learning.actividad (
  actividad_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), modulo_id uuid NOT NULL REFERENCES learning.modulo ON DELETE RESTRICT,
  codigo text NOT NULL, nombre text NOT NULL, tipo text NOT NULL, activa boolean NOT NULL DEFAULT true,
  UNIQUE(modulo_id,codigo)
);

CREATE TABLE learning.actividad_version (
  actividad_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actividad_id uuid NOT NULL REFERENCES learning.actividad ON DELETE RESTRICT,
  numero_version integer NOT NULL CHECK(numero_version>0), locale text NOT NULL,
  titulo text NOT NULL, descripcion text NOT NULL, reglas jsonb NOT NULL DEFAULT '{}'::jsonb,
  publicada_en timestamptz, UNIQUE(actividad_id,numero_version,locale)
);

CREATE TABLE learning.definicion_metrica (
  metrica_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actividad_version_id uuid NOT NULL REFERENCES learning.actividad_version ON DELETE RESTRICT,
  codigo text NOT NULL, nombre text NOT NULL, tipo_valor text NOT NULL CHECK(tipo_valor IN ('numeric','text','boolean')),
  unidad text, minimo numeric, maximo numeric, formula text, version_formula text, derivada boolean NOT NULL DEFAULT false,
  UNIQUE(actividad_version_id,codigo), CHECK(minimo IS NULL OR maximo IS NULL OR minimo<=maximo)
);

CREATE TABLE learning.asignacion_actividad (
  asignacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grupo_id uuid NOT NULL ,
  actividad_version_id uuid NOT NULL REFERENCES learning.actividad_version ON DELETE RESTRICT,
  creada_por uuid NOT NULL , titulo text NOT NULL, instrucciones text NOT NULL,
  abre_en timestamptz, vence_en timestamptz, estado text NOT NULL DEFAULT 'draft' CHECK(estado IN ('draft','published','closed','archived')),
  creada_en timestamptz NOT NULL DEFAULT now(), CHECK(vence_en IS NULL OR abre_en IS NULL OR vence_en>=abre_en)
);

CREATE TABLE learning.criterio_asignacion (
  criterio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asignacion_id uuid NOT NULL REFERENCES learning.asignacion_actividad ON DELETE RESTRICT,
  codigo text NOT NULL, nombre text NOT NULL, descripcion text, puntaje_maximo numeric CHECK(puntaje_maximo IS NULL OR puntaje_maximo>=0),
  orden integer NOT NULL CHECK(orden>0), UNIQUE(asignacion_id,codigo), UNIQUE(asignacion_id,orden)
);

CREATE TABLE learning.ejecucion_actividad (
  ejecucion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES learning.espacio_trabajo ON DELETE RESTRICT,
  cuenta_id uuid NOT NULL , actividad_version_id uuid NOT NULL REFERENCES learning.actividad_version ON DELETE RESTRICT,
  asignacion_id uuid REFERENCES learning.asignacion_actividad ON DELETE RESTRICT, alias_participante text,
  condicion text, origen_dato text NOT NULL CHECK(origen_dato IN ('measured','declared','simulated','mixed','derived')),
  estado text NOT NULL DEFAULT 'in_progress' CHECK(estado IN ('in_progress','completed','cancelled')),
  iniciada_en timestamptz NOT NULL DEFAULT now(), finalizada_en timestamptz, notas text,
  version_registro integer NOT NULL DEFAULT 1 CHECK(version_registro>0), prototipo text, es_demo boolean NOT NULL DEFAULT false,
  clave_idempotencia uuid, UNIQUE(cuenta_id,clave_idempotencia),
  CHECK(finalizada_en IS NULL OR finalizada_en>=iniciada_en)
);

CREATE TABLE learning.valor_metrica (
  valor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL REFERENCES learning.ejecucion_actividad ON DELETE CASCADE,
  metrica_id uuid NOT NULL REFERENCES learning.definicion_metrica ON DELETE RESTRICT, indice_repeticion integer NOT NULL DEFAULT 1 CHECK(indice_repeticion>0),
  valor_numerico numeric, valor_texto text, valor_booleano boolean, registrado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ejecucion_id,metrica_id,indice_repeticion),
  CHECK(num_nonnulls(valor_numerico,valor_texto,valor_booleano)=1)
);

CREATE TABLE learning.ensayo_experimento (
  ensayo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL REFERENCES learning.ejecucion_actividad ON DELETE CASCADE,
  numero integer NOT NULL CHECK(numero>0), fase text NOT NULL CHECK(fase IN ('practice','measurement')),
  segundos numeric NOT NULL CHECK(segundos>=0), errores integer NOT NULL CHECK(errores>=0),
  tipo_entrada text NOT NULL CHECK(tipo_entrada IN ('keyboard','pointer')),
  distancia_px numeric CHECK(distancia_px IS NULL OR distancia_px>=0), tamano_objetivo_px numeric CHECK(tamano_objetivo_px IS NULL OR tamano_objetivo_px>0),
  numero_opciones integer CHECK(numero_opciones IS NULL OR numero_opciones>0), indice_dificultad numeric CHECK(indice_dificultad IS NULL OR indice_dificultad>=0),
  UNIQUE(ejecucion_id,numero),
  CHECK((distancia_px IS NULL AND tamano_objetivo_px IS NULL AND indice_dificultad IS NULL) OR
        (distancia_px IS NOT NULL AND tamano_objetivo_px IS NOT NULL AND indice_dificultad IS NOT NULL)),
  CHECK(numero_opciones IS NULL OR (distancia_px IS NULL AND tamano_objetivo_px IS NULL AND indice_dificultad IS NULL))
);

CREATE TABLE learning.persona (
  persona_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES learning.espacio_trabajo ON DELETE RESTRICT,
  creada_por uuid NOT NULL , nombre text NOT NULL, edad_texto text NOT NULL,
  contexto text NOT NULL, objetivo text NOT NULL, barrera text NOT NULL, dispositivo text NOT NULL,
  dice text NOT NULL, piensa text NOT NULL, hace text NOT NULL, siente text NOT NULL,
  base text CHECK(base IN ('observed','assumed','mixed')), observacion text, supuestos text,
  fuente_emocion text CHECK(fuente_emocion IN ('observed','declared')), creada_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning.escenario (
  escenario_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES learning.espacio_trabajo ON DELETE RESTRICT,
  creado_por uuid NOT NULL , persona_id uuid REFERENCES learning.persona ON DELETE RESTRICT,
  titulo text NOT NULL, actor text NOT NULL, contexto text NOT NULL, tarea text NOT NULL, restriccion text NOT NULL,
  criterio_exito text NOT NULL, ficticio boolean NOT NULL DEFAULT false, creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning.instrumento (
  instrumento_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL, numero_version integer NOT NULL CHECK(numero_version>0),
  locale text NOT NULL, nombre text NOT NULL, tipo text NOT NULL CHECK(tipo IN ('SUS','NASA_TLX','custom')),
  formula_version text, UNIQUE(codigo,numero_version,locale)
);

CREATE TABLE learning.item_instrumento (
  item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instrumento_id uuid NOT NULL REFERENCES learning.instrumento ON DELETE RESTRICT,
  codigo text NOT NULL, enunciado text NOT NULL, orden integer NOT NULL CHECK(orden>0), minimo numeric, maximo numeric,
  UNIQUE(instrumento_id,codigo), UNIQUE(instrumento_id,orden), CHECK(minimo IS NULL OR maximo IS NULL OR minimo<=maximo)
);

CREATE TABLE learning.sesion_evaluacion (
  sesion_evaluacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cuenta_id uuid NOT NULL ,
  espacio_id uuid NOT NULL REFERENCES learning.espacio_trabajo ON DELETE RESTRICT, ejecucion_id uuid REFERENCES learning.ejecucion_actividad ON DELETE RESTRICT,
  instrumento_id uuid REFERENCES learning.instrumento ON DELETE RESTRICT, tipo text NOT NULL CHECK(tipo IN ('task','SUS','NASA_TLX','heuristic','custom')),
  participante_alias text, tarea text, exito boolean, segundos numeric CHECK(segundos IS NULL OR segundos>=0),
  errores integer CHECK(errores IS NULL OR errores>=0), seq numeric CHECK(seq IS NULL OR seq BETWEEN 1 AND 7),
  emocion numeric CHECK(emocion IS NULL OR emocion BETWEEN 1 AND 5), notas text,
  iniciada_en timestamptz NOT NULL DEFAULT now(), finalizada_en timestamptz,
  CHECK(finalizada_en IS NULL OR finalizada_en>=iniciada_en)
);

CREATE TABLE learning.respuesta_item (
  respuesta_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sesion_evaluacion_id uuid NOT NULL REFERENCES learning.sesion_evaluacion ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES learning.item_instrumento ON DELETE RESTRICT, valor_numerico numeric, valor_texto text,
  respondida_en timestamptz NOT NULL DEFAULT now(), UNIQUE(sesion_evaluacion_id,item_id),
  CHECK(num_nonnulls(valor_numerico,valor_texto)=1)
);

CREATE TABLE learning.heuristica_version (
  heuristica_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL CHECK(codigo ~ '^h([1-9]|10)$'),
  numero_version integer NOT NULL CHECK(numero_version>0), locale text NOT NULL, nombre text NOT NULL,
  explicacion text NOT NULL, pregunta text NOT NULL, ejemplo text NOT NULL, UNIQUE(codigo,numero_version,locale)
);

CREATE TABLE learning.hallazgo_heuristico (
  hallazgo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES learning.espacio_trabajo ON DELETE RESTRICT,
  sesion_evaluacion_id uuid REFERENCES learning.sesion_evaluacion ON DELETE RESTRICT, ejecucion_id uuid REFERENCES learning.ejecucion_actividad ON DELETE RESTRICT,
  creado_por uuid NOT NULL , heuristica_version_id uuid REFERENCES learning.heuristica_version ON DELETE RESTRICT,
  heuristica_etiqueta text NOT NULL, tarea text NOT NULL, severidad smallint NOT NULL CHECK(severidad BETWEEN 0 AND 4), problema text NOT NULL,
  evidencia text NOT NULL, recomendacion text NOT NULL, fuente text NOT NULL CHECK(fuente IN ('human','ai')),
  estado text NOT NULL DEFAULT 'pending' CHECK(estado IN ('pending','validated','rejected')), creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK(sesion_evaluacion_id IS NOT NULL OR ejecucion_id IS NOT NULL)
);

CREATE TABLE learning.entrega (
  entrega_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL REFERENCES learning.ejecucion_actividad ON DELETE RESTRICT,
  numero_version integer NOT NULL CHECK(numero_version>0), estado text NOT NULL DEFAULT 'submitted' CHECK(estado IN ('submitted','revision','changes_requested','accepted')),
  comentario_estudiante text, enviada_en timestamptz NOT NULL DEFAULT now(), UNIQUE(ejecucion_id,numero_version)
);

CREATE TABLE learning.valoracion (
  valoracion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entrega_id uuid NOT NULL REFERENCES learning.entrega ON DELETE RESTRICT,
  criterio_id uuid NOT NULL REFERENCES learning.criterio_asignacion ON DELETE RESTRICT, evaluada_por uuid NOT NULL ,
  puntaje numeric CHECK(puntaje IS NULL OR puntaje>=0), comentario text, evaluada_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entrega_id,criterio_id,evaluada_por)
);

CREATE TABLE learning.retroalimentacion (
  retroalimentacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entrega_id uuid NOT NULL REFERENCES learning.entrega ON DELETE RESTRICT,
  autor_id uuid NOT NULL , respuesta_a uuid REFERENCES learning.retroalimentacion ON DELETE RESTRICT,
  mensaje text NOT NULL, tipo text NOT NULL CHECK(tipo IN ('comment','request_changes','response')), creada_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning.usuario_demo (
  usuario_demo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creado_por uuid NOT NULL ,
  nombre text NOT NULL, correo_demo text NOT NULL, rol_demo text NOT NULL CHECK(rol_demo IN ('student','teacher','evaluator')),
  estado text NOT NULL DEFAULT 'active' CHECK(estado IN ('active','inactive')), creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning.resultado_concepto (
  ejecucion_id uuid PRIMARY KEY REFERENCES learning.ejecucion_actividad ON DELETE CASCADE,
  concepto_codigo text NOT NULL CHECK(concepto_codigo IN ('ux','usability','accessibility','awareness','engagement','emotions','ergonomics','cognition','information','universal','responsibleAI')),
  resultado text NOT NULL CHECK(resultado IN ('completed','cancelled')),
  texto_usuario text, razon text, edicion text, decision text,
  emocion_antes smallint CHECK(emocion_antes BETWEEN 1 AND 5), emocion_despues smallint CHECK(emocion_despues BETWEEN 1 AND 5),
  confianza_antes smallint CHECK(confianza_antes BETWEEN 1 AND 5), confianza_despues smallint CHECK(confianza_despues BETWEEN 1 AND 5)
);

CREATE TABLE learning.observacion_patron (
  ejecucion_id uuid PRIMARY KEY REFERENCES learning.ejecucion_actividad ON DELETE CASCADE,
  patron_codigo text NOT NULL CHECK(patron_codigo IN ('form','navigation','feedback','choice','content','privacy')),
  problema text NOT NULL, principio text NOT NULL, correccion text NOT NULL
);

CREATE TABLE learning.revision_ia (
  ejecucion_id uuid PRIMARY KEY REFERENCES learning.ejecucion_actividad ON DELETE CASCADE,
  tipo text NOT NULL CHECK(tipo IN ('persona','scenario','interface','evaluation')),
  proveedor text, modelo text, prompt text NOT NULL, propuesta text NOT NULL, base_propuesta text,
  limites text, revision_humana text, razon_decision text,
  decision text NOT NULL CHECK(decision IN ('accept','applyEdit','reject')),
  generada_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE learning.evaluacion_chatbot (
  ejecucion_id uuid PRIMARY KEY REFERENCES learning.ejecucion_actividad ON DELETE CASCADE,
  variante text NOT NULL CHECK(variante IN ('A','B')),
  prompt text NOT NULL, respuesta text NOT NULL, respuesta_humana boolean NOT NULL,
  claridad smallint CHECK(claridad BETWEEN 1 AND 5), control smallint CHECK(control BETWEEN 1 AND 5),
  tono smallint CHECK(tono BETWEEN 1 AND 5), transparencia smallint CHECK(transparencia BETWEEN 1 AND 5)
);

CREATE TABLE learning.evidencia_multimodal (
  ejecucion_id uuid PRIMARY KEY REFERENCES learning.ejecucion_actividad ON DELETE CASCADE,
  dispositivo text NOT NULL CHECK(dispositivo IN ('desktop','tablet','mobile','watch','car','tv','kiosk','iot')),
  practica text NOT NULL CHECK(practica IN ('good','bad')),
  modo_visual text NOT NULL CHECK(modo_visual IN ('normal','protanopia','deuteranopia','tritanopia','achromatopsia')),
  notas text, confianza smallint NOT NULL CHECK(confianza BETWEEN 1 AND 5),
  estado_demo text NOT NULL, estado_canal text NOT NULL
);

CREATE INDEX espacio_propietario_idx ON learning.espacio_trabajo(propietario_id,archivado_en);

CREATE INDEX asignacion_grupo_estado_idx ON learning.asignacion_actividad(grupo_id,estado,vence_en);

CREATE INDEX ejecucion_cuenta_idx ON learning.ejecucion_actividad(cuenta_id,iniciada_en DESC);

CREATE INDEX ejecucion_espacio_actividad_idx ON learning.ejecucion_actividad(espacio_id,actividad_version_id,iniciada_en DESC);

CREATE INDEX ejecucion_asignacion_idx ON learning.ejecucion_actividad(asignacion_id,estado);

CREATE INDEX hallazgo_espacio_estado_idx ON learning.hallazgo_heuristico(espacio_id,estado,creado_en DESC);

CREATE UNIQUE INDEX usuario_demo_correo_propietario_uq ON learning.usuario_demo(creado_por,lower(btrim(correo_demo)));

CREATE TABLE learning.audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL, event_type text NOT NULL, resource_type text NOT NULL, resource_id text, outcome text NOT NULL CHECK(outcome IN ('success','denied','failure')), occurred_at timestamptz NOT NULL DEFAULT now(), correlation_id uuid);

CREATE INDEX audit_events_resource_time_idx ON learning.audit_events(resource_type,resource_id,occurred_at DESC);

GRANT USAGE ON SCHEMA learning TO learning_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA learning TO learning_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA learning TO learning_app;

ALTER DEFAULT PRIVILEGES FOR ROLE learning_owner IN SCHEMA learning GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO learning_app;

ALTER DEFAULT PRIVILEGES FOR ROLE learning_owner IN SCHEMA learning GRANT USAGE, SELECT ON SEQUENCES TO learning_app;
