-- HCI Lab + IA 2.5.0 — DDL PostgreSQL, modelo lógico v2.1 (revisión de diseño)
-- Contraste: main/deployment @ c17011a. Datos remotos exclusivamente para cuentas registradas.
-- Referencia consolidada: 55 tablas. Este archivo expresa el ER completo en un esquema
-- relacional y conserva FKs entre dominios para revisión; NO es aún el conjunto de
-- migraciones desplegables de Identidad, Aprendizaje, Comunidad y Evidencias.
-- Antes de desplegar servicios separados, derivar migraciones por propietario, mantener
-- FKs solo dentro de cada servicio y convertir referencias externas en IDs validados por API.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE cuenta (
  cuenta_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correo text NOT NULL,
  correo_normalizado text NOT NULL UNIQUE,
  nombre text NOT NULL,
  apellido text,
  hash_contrasena text NOT NULL,
  estado text NOT NULL DEFAULT 'pending' CHECK (estado IN ('pending','active','inactive','locked')),
  correo_verificado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  desactivado_en timestamptz,
  version_registro integer NOT NULL DEFAULT 1 CHECK (version_registro > 0),
  CHECK (correo_normalizado = lower(btrim(correo))),
  CHECK (estado <> 'active' OR correo_verificado_en IS NOT NULL),
  CHECK ((estado = 'inactive') = (desactivado_en IS NOT NULL))
);
CREATE TABLE rol (rol_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE, nombre text NOT NULL, descripcion text);
CREATE TABLE permiso (permiso_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE, descripcion text NOT NULL);
CREATE TABLE cuenta_rol (
  cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE CASCADE,
  rol_id uuid NOT NULL REFERENCES rol ON DELETE RESTRICT,
  asignado_por uuid REFERENCES cuenta ON DELETE SET NULL,
  asignado_en timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(cuenta_id,rol_id)
);
CREATE TABLE rol_permiso (
  rol_id uuid NOT NULL REFERENCES rol ON DELETE CASCADE,
  permiso_id uuid NOT NULL REFERENCES permiso ON DELETE CASCADE,
  PRIMARY KEY(rol_id,permiso_id)
);
CREATE TABLE sesion_acceso (
  sesion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE, csrf_hash char(64) NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now(), ultimo_uso_en timestamptz NOT NULL DEFAULT now(),
  expira_en timestamptz NOT NULL, revocada_en timestamptz,
  CHECK(expira_en>creada_en), CHECK(ultimo_uso_en>=creada_en)
);
CREATE INDEX sesion_acceso_cuenta_idx ON sesion_acceso(cuenta_id,expira_en);
CREATE TABLE token_cuenta (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE CASCADE,
  proposito text NOT NULL CHECK(proposito IN ('verify_email','reset_password')),
  token_hash char(64) NOT NULL UNIQUE, expira_en timestamptz NOT NULL,
  consumido_en timestamptz, creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK(expira_en>creado_en), CHECK(consumido_en IS NULL OR consumido_en>=creado_en)
);
CREATE INDEX token_cuenta_expiracion_idx ON token_cuenta(expira_en) WHERE consumido_en IS NULL;
CREATE TABLE espacio_trabajo (
  espacio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), propietario_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  nombre text NOT NULL, creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now(), archivado_en timestamptz
);
CREATE INDEX espacio_propietario_idx ON espacio_trabajo(propietario_id,archivado_en);
CREATE TABLE grupo (
  grupo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text NOT NULL, descripcion text,
  estado text NOT NULL DEFAULT 'active' CHECK(estado IN ('active','archived')),
  creado_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(), archivado_en timestamptz
);
CREATE TABLE membresia_grupo (
  grupo_id uuid NOT NULL REFERENCES grupo ON DELETE RESTRICT, cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  funcion text NOT NULL CHECK(funcion IN ('leader','participant')), estado text NOT NULL DEFAULT 'active' CHECK(estado IN ('invited','active','inactive','removed')),
  invitado_por uuid REFERENCES cuenta ON DELETE SET NULL, unido_en timestamptz, retirado_en timestamptz,
  PRIMARY KEY(grupo_id,cuenta_id), CHECK(retirado_en IS NULL OR unido_en IS NULL OR retirado_en>=unido_en)
);
CREATE INDEX membresia_cuenta_estado_idx ON membresia_grupo(cuenta_id,estado);
CREATE TABLE invitacion_grupo (
  invitacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grupo_id uuid NOT NULL REFERENCES grupo ON DELETE RESTRICT,
  codigo_hash text NOT NULL UNIQUE, correo_destino text, creada_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT now(), expira_en timestamptz NOT NULL, revocada_en timestamptz,
  aceptada_por uuid REFERENCES cuenta ON DELETE SET NULL, aceptada_en timestamptz,
  CHECK(expira_en>creada_en)
);

CREATE TABLE modulo (
  modulo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL UNIQUE, nombre text NOT NULL, descripcion text, ruta text
);
CREATE TABLE actividad (
  actividad_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), modulo_id uuid NOT NULL REFERENCES modulo ON DELETE RESTRICT,
  codigo text NOT NULL, nombre text NOT NULL, tipo text NOT NULL, activa boolean NOT NULL DEFAULT true,
  UNIQUE(modulo_id,codigo)
);
CREATE TABLE actividad_version (
  actividad_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actividad_id uuid NOT NULL REFERENCES actividad ON DELETE RESTRICT,
  numero_version integer NOT NULL CHECK(numero_version>0), locale text NOT NULL,
  titulo text NOT NULL, descripcion text NOT NULL, reglas jsonb NOT NULL DEFAULT '{}'::jsonb,
  publicada_en timestamptz, UNIQUE(actividad_id,numero_version,locale)
);
CREATE TABLE definicion_metrica (
  metrica_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actividad_version_id uuid NOT NULL REFERENCES actividad_version ON DELETE RESTRICT,
  codigo text NOT NULL, nombre text NOT NULL, tipo_valor text NOT NULL CHECK(tipo_valor IN ('numeric','text','boolean')),
  unidad text, minimo numeric, maximo numeric, formula text, version_formula text, derivada boolean NOT NULL DEFAULT false,
  UNIQUE(actividad_version_id,codigo), CHECK(minimo IS NULL OR maximo IS NULL OR minimo<=maximo)
);
CREATE TABLE asignacion_actividad (
  asignacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grupo_id uuid NOT NULL REFERENCES grupo ON DELETE RESTRICT,
  actividad_version_id uuid NOT NULL REFERENCES actividad_version ON DELETE RESTRICT,
  creada_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, titulo text NOT NULL, instrucciones text NOT NULL,
  abre_en timestamptz, vence_en timestamptz, estado text NOT NULL DEFAULT 'draft' CHECK(estado IN ('draft','published','closed','archived')),
  creada_en timestamptz NOT NULL DEFAULT now(), CHECK(vence_en IS NULL OR abre_en IS NULL OR vence_en>=abre_en)
);
CREATE INDEX asignacion_grupo_estado_idx ON asignacion_actividad(grupo_id,estado,vence_en);
CREATE TABLE criterio_asignacion (
  criterio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asignacion_id uuid NOT NULL REFERENCES asignacion_actividad ON DELETE RESTRICT,
  codigo text NOT NULL, nombre text NOT NULL, descripcion text, puntaje_maximo numeric CHECK(puntaje_maximo IS NULL OR puntaje_maximo>=0),
  orden integer NOT NULL CHECK(orden>0), UNIQUE(asignacion_id,codigo), UNIQUE(asignacion_id,orden)
);
CREATE TABLE espacio_trabajo_grupo (
  espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE CASCADE, grupo_id uuid NOT NULL REFERENCES grupo ON DELETE RESTRICT,
  compartido_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, compartido_en timestamptz NOT NULL DEFAULT now(), revocado_en timestamptz,
  PRIMARY KEY(espacio_id,grupo_id)
);

CREATE TABLE ejecucion_actividad (
  ejecucion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT,
  cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, actividad_version_id uuid NOT NULL REFERENCES actividad_version ON DELETE RESTRICT,
  asignacion_id uuid REFERENCES asignacion_actividad ON DELETE RESTRICT, alias_participante text,
  condicion text, origen_dato text NOT NULL CHECK(origen_dato IN ('measured','declared','simulated','mixed','derived')),
  estado text NOT NULL DEFAULT 'in_progress' CHECK(estado IN ('in_progress','completed','cancelled')),
  iniciada_en timestamptz NOT NULL DEFAULT now(), finalizada_en timestamptz, notas text,
  version_registro integer NOT NULL DEFAULT 1 CHECK(version_registro>0), prototipo text, es_demo boolean NOT NULL DEFAULT false,
  clave_idempotencia uuid, UNIQUE(cuenta_id,clave_idempotencia),
  CHECK(finalizada_en IS NULL OR finalizada_en>=iniciada_en)
);
CREATE INDEX ejecucion_cuenta_idx ON ejecucion_actividad(cuenta_id,iniciada_en DESC);
CREATE INDEX ejecucion_espacio_actividad_idx ON ejecucion_actividad(espacio_id,actividad_version_id,iniciada_en DESC);
CREATE INDEX ejecucion_asignacion_idx ON ejecucion_actividad(asignacion_id,estado);
CREATE TABLE valor_metrica (
  valor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL REFERENCES ejecucion_actividad ON DELETE CASCADE,
  metrica_id uuid NOT NULL REFERENCES definicion_metrica ON DELETE RESTRICT, indice_repeticion integer NOT NULL DEFAULT 1 CHECK(indice_repeticion>0),
  valor_numerico numeric, valor_texto text, valor_booleano boolean, registrado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ejecucion_id,metrica_id,indice_repeticion),
  CHECK(num_nonnulls(valor_numerico,valor_texto,valor_booleano)=1)
);
CREATE TABLE ensayo_experimento (
  ensayo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL REFERENCES ejecucion_actividad ON DELETE CASCADE,
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

CREATE TABLE persona (
  persona_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT,
  creada_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, nombre text NOT NULL, edad_texto text NOT NULL,
  contexto text NOT NULL, objetivo text NOT NULL, barrera text NOT NULL, dispositivo text NOT NULL,
  dice text NOT NULL, piensa text NOT NULL, hace text NOT NULL, siente text NOT NULL,
  base text CHECK(base IN ('observed','assumed','mixed')), observacion text, supuestos text,
  fuente_emocion text CHECK(fuente_emocion IN ('observed','declared')), creada_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE escenario (
  escenario_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT,
  creado_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, persona_id uuid REFERENCES persona ON DELETE RESTRICT,
  titulo text NOT NULL, actor text NOT NULL, contexto text NOT NULL, tarea text NOT NULL, restriccion text NOT NULL,
  criterio_exito text NOT NULL, ficticio boolean NOT NULL DEFAULT false, creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE instrumento (
  instrumento_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL, numero_version integer NOT NULL CHECK(numero_version>0),
  locale text NOT NULL, nombre text NOT NULL, tipo text NOT NULL CHECK(tipo IN ('SUS','NASA_TLX','custom')),
  formula_version text, UNIQUE(codigo,numero_version,locale)
);
CREATE TABLE item_instrumento (
  item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instrumento_id uuid NOT NULL REFERENCES instrumento ON DELETE RESTRICT,
  codigo text NOT NULL, enunciado text NOT NULL, orden integer NOT NULL CHECK(orden>0), minimo numeric, maximo numeric,
  UNIQUE(instrumento_id,codigo), UNIQUE(instrumento_id,orden), CHECK(minimo IS NULL OR maximo IS NULL OR minimo<=maximo)
);
CREATE TABLE sesion_evaluacion (
  sesion_evaluacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT, ejecucion_id uuid REFERENCES ejecucion_actividad ON DELETE RESTRICT,
  instrumento_id uuid REFERENCES instrumento ON DELETE RESTRICT, tipo text NOT NULL CHECK(tipo IN ('task','SUS','NASA_TLX','heuristic','custom')),
  participante_alias text, tarea text, exito boolean, segundos numeric CHECK(segundos IS NULL OR segundos>=0),
  errores integer CHECK(errores IS NULL OR errores>=0), seq numeric CHECK(seq IS NULL OR seq BETWEEN 1 AND 7),
  emocion numeric CHECK(emocion IS NULL OR emocion BETWEEN 1 AND 5), notas text,
  iniciada_en timestamptz NOT NULL DEFAULT now(), finalizada_en timestamptz,
  CHECK(finalizada_en IS NULL OR finalizada_en>=iniciada_en)
);
CREATE TABLE respuesta_item (
  respuesta_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sesion_evaluacion_id uuid NOT NULL REFERENCES sesion_evaluacion ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES item_instrumento ON DELETE RESTRICT, valor_numerico numeric, valor_texto text,
  respondida_en timestamptz NOT NULL DEFAULT now(), UNIQUE(sesion_evaluacion_id,item_id),
  CHECK(num_nonnulls(valor_numerico,valor_texto)=1)
);
CREATE TABLE heuristica_version (
  heuristica_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), codigo text NOT NULL CHECK(codigo ~ '^h([1-9]|10)$'),
  numero_version integer NOT NULL CHECK(numero_version>0), locale text NOT NULL, nombre text NOT NULL,
  explicacion text NOT NULL, pregunta text NOT NULL, ejemplo text NOT NULL, UNIQUE(codigo,numero_version,locale)
);
CREATE TABLE hallazgo_heuristico (
  hallazgo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT,
  sesion_evaluacion_id uuid REFERENCES sesion_evaluacion ON DELETE RESTRICT, ejecucion_id uuid REFERENCES ejecucion_actividad ON DELETE RESTRICT,
  creado_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, heuristica_version_id uuid REFERENCES heuristica_version ON DELETE RESTRICT,
  heuristica_etiqueta text NOT NULL, tarea text NOT NULL, severidad smallint NOT NULL CHECK(severidad BETWEEN 0 AND 4), problema text NOT NULL,
  evidencia text NOT NULL, recomendacion text NOT NULL, fuente text NOT NULL CHECK(fuente IN ('human','ai')),
  estado text NOT NULL DEFAULT 'pending' CHECK(estado IN ('pending','validated','rejected')), creado_en timestamptz NOT NULL DEFAULT now(),
  CHECK(sesion_evaluacion_id IS NOT NULL OR ejecucion_id IS NOT NULL)
);
CREATE INDEX hallazgo_espacio_estado_idx ON hallazgo_heuristico(espacio_id,estado,creado_en DESC);

CREATE TABLE entrega (
  entrega_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL REFERENCES ejecucion_actividad ON DELETE RESTRICT,
  numero_version integer NOT NULL CHECK(numero_version>0), estado text NOT NULL DEFAULT 'submitted' CHECK(estado IN ('submitted','revision','changes_requested','accepted')),
  comentario_estudiante text, enviada_en timestamptz NOT NULL DEFAULT now(), UNIQUE(ejecucion_id,numero_version)
);
CREATE TABLE valoracion (
  valoracion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entrega_id uuid NOT NULL REFERENCES entrega ON DELETE RESTRICT,
  criterio_id uuid NOT NULL REFERENCES criterio_asignacion ON DELETE RESTRICT, evaluada_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  puntaje numeric CHECK(puntaje IS NULL OR puntaje>=0), comentario text, evaluada_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entrega_id,criterio_id,evaluada_por)
);
CREATE TABLE retroalimentacion (
  retroalimentacion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entrega_id uuid NOT NULL REFERENCES entrega ON DELETE RESTRICT,
  autor_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, respuesta_a uuid REFERENCES retroalimentacion ON DELETE RESTRICT,
  mensaje text NOT NULL, tipo text NOT NULL CHECK(tipo IN ('comment','request_changes','response')), creada_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sesion_ux (
  sesion_ux_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL REFERENCES ejecucion_actividad ON DELETE RESTRICT,
  cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
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
CREATE TABLE sesion_ux_exposicion (
  sesion_ux_id uuid NOT NULL REFERENCES sesion_ux ON DELETE CASCADE, banda text NOT NULL,
  segundos numeric NOT NULL CHECK(segundos>=0), PRIMARY KEY(sesion_ux_id,banda)
);
CREATE TABLE validacion_calibracion (
  sesion_ux_id uuid PRIMARY KEY REFERENCES sesion_ux ON DELETE CASCADE,
  error_mediano_px numeric NOT NULL CHECK(error_mediano_px>=0), ancho_ventana integer NOT NULL CHECK(ancho_ventana>0),
  alto_ventana integer NOT NULL CHECK(alto_ventana>0), cantidad_muestras integer NOT NULL CHECK(cantidad_muestras>=0), validada_en timestamptz NOT NULL
);
CREATE TABLE evento_ux (
  evento_ux_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, sesion_ux_id uuid NOT NULL REFERENCES sesion_ux ON DELETE CASCADE,
  canal text NOT NULL CHECK(canal IN ('click','pointer','gaze','simulation','scroll','wheel','mode')),
  ocurrido_ms bigint NOT NULL CHECK(ocurrido_ms>=0), x numeric, y numeric, peso numeric, area text, ruta text,
  scroll_top_px numeric CHECK(scroll_top_px IS NULL OR scroll_top_px>=0),
  profundidad_pct numeric CHECK(profundidad_pct IS NULL OR profundidad_pct BETWEEN 0 AND 100),
  direccion text, modo text CHECK(modo IS NULL OR modo IN ('cursor','F','Gutenberg','none')),
  origen_dato text NOT NULL CHECK(origen_dato IN ('measured','simulated','mixed'))
);
CREATE INDEX evento_ux_sesion_tiempo_idx ON evento_ux(sesion_ux_id,ocurrido_ms);
CREATE TABLE consentimiento (
  consentimiento_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sesion_ux_id uuid NOT NULL REFERENCES sesion_ux ON DELETE CASCADE,
  proposito text NOT NULL, version_aviso text NOT NULL, otorgado boolean NOT NULL,
  registrado_en timestamptz NOT NULL DEFAULT now(), revocado_en timestamptz
);

CREATE TABLE evidencia (
  evidencia_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ejecucion_id uuid NOT NULL REFERENCES ejecucion_actividad ON DELETE RESTRICT,
  creada_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, nombre text NOT NULL, mime text NOT NULL,
  bytes bigint NOT NULL CHECK(bytes>=0), sha256 char(64) NOT NULL, ubicacion text NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now(), eliminada_en timestamptz
);
CREATE TABLE entrega_evidencia (
  entrega_id uuid NOT NULL REFERENCES entrega ON DELETE RESTRICT, evidencia_id uuid NOT NULL REFERENCES evidencia ON DELETE RESTRICT,
  PRIMARY KEY(entrega_id,evidencia_id)
);
CREATE TABLE informe (
  informe_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), solicitado_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT, grupo_id uuid REFERENCES grupo ON DELETE RESTRICT,
  nombre_proyecto text, objetivo text, metodo text, interpretacion text, mejoras text, limites text, conclusiones text, referencias text,
  incluir_comparacion boolean NOT NULL DEFAULT false, justificacion text,
  formato text NOT NULL CHECK(formato IN ('pdf','markdown','csv','json')), creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sugerencia (
  sugerencia_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), autor_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  categoria text NOT NULL, titulo text NOT NULL, descripcion text NOT NULL, anonima boolean NOT NULL DEFAULT false,
  estado text NOT NULL DEFAULT 'received' CHECK(estado IN ('received','reviewing','accepted','implemented','rejected')),
  creada_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE historial_sugerencia (
  historial_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sugerencia_id uuid NOT NULL REFERENCES sugerencia ON DELETE RESTRICT,
  cambiado_por uuid REFERENCES cuenta ON DELETE SET NULL, estado_anterior text, estado_nuevo text NOT NULL,
  respuesta text, cambiado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario_demo (
  usuario_demo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creado_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  nombre text NOT NULL, correo_demo text NOT NULL, rol_demo text NOT NULL CHECK(rol_demo IN ('student','teacher','evaluator')),
  estado text NOT NULL DEFAULT 'active' CHECK(estado IN ('active','inactive')), creado_en timestamptz NOT NULL DEFAULT now(), actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuario_demo_correo_propietario_uq ON usuario_demo(creado_por,lower(btrim(correo_demo)));
CREATE TABLE servicio_reserva (
  servicio_codigo text PRIMARY KEY CHECK(servicio_codigo IN ('advice','workshop','health','visit','culture')),
  contexto text NOT NULL CHECK(contexto IN ('university','healthcare','culture')),
  activo boolean NOT NULL DEFAULT true
);
CREATE TABLE reserva (
  reserva_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT,
  creada_por uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, servicio_codigo text REFERENCES servicio_reserva ON DELETE RESTRICT,
  servicio_etiqueta text NOT NULL, fecha date NOT NULL, hora time without time zone NOT NULL,
  estado text NOT NULL DEFAULT 'confirmed' CHECK(estado IN ('confirmed','cancelled')),
  condicion text CHECK(condicion IN ('good','bad')), creada_en timestamptz NOT NULL DEFAULT now(), actualizada_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reserva_catalogo_confirmada_uq ON reserva(espacio_id,servicio_codigo,fecha,hora) WHERE estado='confirmed' AND servicio_codigo IS NOT NULL;
CREATE UNIQUE INDEX reserva_legacy_confirmada_uq ON reserva(espacio_id,lower(servicio_etiqueta),fecha,hora) WHERE estado='confirmed' AND servicio_codigo IS NULL;
CREATE TABLE preferencia_cuenta (
  cuenta_id uuid PRIMARY KEY REFERENCES cuenta ON DELETE CASCADE, idioma text NOT NULL DEFAULT 'es-CO' CHECK(idioma IN ('es-CO','en-US','pt-BR','fr-FR','it-IT','ca-ES')),
  tema_oscuro boolean NOT NULL DEFAULT false, alto_contraste boolean NOT NULL DEFAULT false,
  tamano_fuente_pct smallint NOT NULL DEFAULT 100 CHECK(tamano_fuente_pct BETWEEN 100 AND 200 AND tamano_fuente_pct%25=0),
  espaciado boolean NOT NULL DEFAULT false, fuente_dislexia boolean NOT NULL DEFAULT false, movimiento_reducido boolean NOT NULL DEFAULT false,
  actualizada_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE resultado_concepto (
  ejecucion_id uuid PRIMARY KEY REFERENCES ejecucion_actividad ON DELETE CASCADE,
  concepto_codigo text NOT NULL CHECK(concepto_codigo IN ('ux','usability','accessibility','awareness','engagement','emotions','ergonomics','cognition','information','universal','responsibleAI')),
  resultado text NOT NULL CHECK(resultado IN ('completed','cancelled')),
  texto_usuario text, razon text, edicion text, decision text,
  emocion_antes smallint CHECK(emocion_antes BETWEEN 1 AND 5), emocion_despues smallint CHECK(emocion_despues BETWEEN 1 AND 5),
  confianza_antes smallint CHECK(confianza_antes BETWEEN 1 AND 5), confianza_despues smallint CHECK(confianza_despues BETWEEN 1 AND 5)
);
CREATE TABLE observacion_patron (
  ejecucion_id uuid PRIMARY KEY REFERENCES ejecucion_actividad ON DELETE CASCADE,
  patron_codigo text NOT NULL CHECK(patron_codigo IN ('form','navigation','feedback','choice','content','privacy')),
  problema text NOT NULL, principio text NOT NULL, correccion text NOT NULL
);
CREATE TABLE revision_ia (
  ejecucion_id uuid PRIMARY KEY REFERENCES ejecucion_actividad ON DELETE CASCADE,
  tipo text NOT NULL CHECK(tipo IN ('persona','scenario','interface','evaluation')),
  proveedor text, modelo text, prompt text NOT NULL, propuesta text NOT NULL, base_propuesta text,
  limites text, revision_humana text, razon_decision text,
  decision text NOT NULL CHECK(decision IN ('accept','applyEdit','reject')),
  generada_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evaluacion_chatbot (
  ejecucion_id uuid PRIMARY KEY REFERENCES ejecucion_actividad ON DELETE CASCADE,
  variante text NOT NULL CHECK(variante IN ('A','B')),
  prompt text NOT NULL, respuesta text NOT NULL, respuesta_humana boolean NOT NULL,
  claridad smallint CHECK(claridad BETWEEN 1 AND 5), control smallint CHECK(control BETWEEN 1 AND 5),
  tono smallint CHECK(tono BETWEEN 1 AND 5), transparencia smallint CHECK(transparencia BETWEEN 1 AND 5)
);
CREATE TABLE evidencia_multimodal (
  ejecucion_id uuid PRIMARY KEY REFERENCES ejecucion_actividad ON DELETE CASCADE,
  dispositivo text NOT NULL CHECK(dispositivo IN ('desktop','tablet','mobile','watch','car','tv','kiosk','iot')),
  practica text NOT NULL CHECK(practica IN ('good','bad')),
  modo_visual text NOT NULL CHECK(modo_visual IN ('normal','protanopia','deuteranopia','tritanopia','achromatopsia')),
  notas text, confianza smallint NOT NULL CHECK(confianza BETWEEN 1 AND 5),
  estado_demo text NOT NULL, estado_canal text NOT NULL
);

CREATE TABLE evento_laboratorio (
  evento_laboratorio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT,
  cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  tipo text NOT NULL CHECK(tipo IN ('flow-start','flow-error','flow-complete','appointment-change','ai-run','export')),
  ocurrido_en timestamptz NOT NULL DEFAULT now(), duracion_segundos numeric CHECK(duracion_segundos IS NULL OR duracion_segundos>=0), detalle text
);
CREATE TABLE verificacion_accesibilidad (
  verificacion_accesibilidad_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), espacio_id uuid NOT NULL REFERENCES espacio_trabajo ON DELETE RESTRICT,
  cuenta_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT, codigo text NOT NULL, superada boolean NOT NULL,
  verificada_en timestamptz NOT NULL DEFAULT now(), UNIQUE(espacio_id,codigo)
);

CREATE TABLE informe_registro (
  informe_registro_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), informe_id uuid NOT NULL REFERENCES informe ON DELETE CASCADE,
  seccion text NOT NULL CHECK(seccion IN ('selected','before','after')), orden integer NOT NULL CHECK(orden>0),
  ejecucion_id uuid REFERENCES ejecucion_actividad ON DELETE RESTRICT,
  persona_id uuid REFERENCES persona ON DELETE RESTRICT, escenario_id uuid REFERENCES escenario ON DELETE RESTRICT,
  reserva_id uuid REFERENCES reserva ON DELETE RESTRICT, hallazgo_id uuid REFERENCES hallazgo_heuristico ON DELETE RESTRICT,
  sesion_evaluacion_id uuid REFERENCES sesion_evaluacion ON DELETE RESTRICT, sesion_ux_id uuid REFERENCES sesion_ux ON DELETE RESTRICT,
  evidencia_id uuid REFERENCES evidencia ON DELETE RESTRICT, usuario_demo_id uuid REFERENCES usuario_demo ON DELETE RESTRICT,
  evidencia_multimodal_id uuid REFERENCES evidencia_multimodal ON DELETE RESTRICT,
  evento_laboratorio_id uuid REFERENCES evento_laboratorio ON DELETE RESTRICT,
  verificacion_accesibilidad_id uuid REFERENCES verificacion_accesibilidad ON DELETE RESTRICT,
  CHECK(num_nonnulls(ejecucion_id,persona_id,escenario_id,reserva_id,hallazgo_id,sesion_evaluacion_id,sesion_ux_id,evidencia_id,usuario_demo_id,evidencia_multimodal_id,evento_laboratorio_id,verificacion_accesibilidad_id)=1),
  UNIQUE(informe_id,seccion,orden)
);

CREATE TABLE evento_auditoria (
  evento_auditoria_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL REFERENCES cuenta ON DELETE RESTRICT,
  tipo text NOT NULL, recurso_tipo text NOT NULL, recurso_id text, resultado text NOT NULL CHECK(resultado IN ('success','denied','failure')),
  ocurrido_en timestamptz NOT NULL DEFAULT now(), correlation_id uuid
);
CREATE INDEX auditoria_recurso_fecha_idx ON evento_auditoria(recurso_tipo,recurso_id,ocurrido_en DESC);

-- Catálogo inicial de roles globales; las funciones de membresia_grupo son distintas.
-- No hay herencia implícita: teacher/evaluator no conceden administrator.
-- Las filas rol_permiso se incorporan cuando se aplique la matriz exacta aprobada;
-- un permiso ausente se deniega (fail closed).
-- Las auditorías de usuario requieren actor registrado; tareas internas automatizadas no se registran como usuario.
INSERT INTO rol(codigo,nombre,descripcion) VALUES
 ('administrator','Administrador','Administración global del laboratorio'),
 ('participant','Participante','Cuenta para guardar trabajo personal'),
 ('teacher','Profesor','Acompañamiento de grupos mediante membresía'),
 ('evaluator','Evaluador','Evaluación de trabajo autorizado');
INSERT INTO servicio_reserva(servicio_codigo,contexto) VALUES
 ('advice','university'),('workshop','university'),('health','healthcare'),('visit','culture'),('culture','culture');
COMMIT;

-- Integridad adicional en aplicación/transacción: consumir token de un solo uso con UPDATE
-- condicional y una sola fila afectada; confirmar cuenta activa, propiedad/compartición del
-- espacio, pertenencia al grupo, correspondencia de métricas con versión de actividad,
-- y que el criterio valorado pertenece a la asignación de la entrega.
-- Duplicados confirmados de reserva se bloquean por índices únicos; las reglas de fecha futura
-- y la política distinta del ejemplo didáctico se validan en el caso de uso.

-- Límites de servicio pendientes de materializar: Identidad posee cuenta/rol/permiso/sesión/
-- token/preferencia; Comunidad posee grupo/membresía/invitación/sugerencia/reserva; Aprendizaje
-- posee espacio/catálogos/ejecuciones/evaluaciones/entregas/CRUD didáctico; Evidencias posee
-- seguimiento consentido/evidencias/informes. Auditoría queda en el servicio que ejecuta la
-- operación. Las FKs de este DDL consolidado que cruzan esos límites son relaciones lógicas;
-- no se conservan como FKs físicas en despliegues independientes. No ejecutar este archivo
-- como sustituto de las migraciones por servicio.
