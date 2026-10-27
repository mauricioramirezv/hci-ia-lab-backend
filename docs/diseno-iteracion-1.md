> Estado histórico: este inventario se redactó antes de recibir el MER y era una propuesta provisional. El MER v2.1 ya fue revisado e incorporado; para el estado actual del esquema, contratos y pendientes, consultar [Implementación MER v2.1](implementacion-mer-v2.1.md). No usar las propuestas de esta iteración como modelo vigente.
# Diseno verificable del backend — iteracion 1

Estado: inventario contrastado con el frontend; propuesta de contratos y
relaciones sin esquema aprobado. El MER del usuario no esta disponible aun.
No se afirma conformidad con un MER ni se definen migraciones/tablas finales.
Esta entrega no incorpora casos de uso. El servicio de salud creado antes
sigue siendo solo una comprobacion del proceso.

## 1. Hallazgos del frontend

Fuente vigente: `src/features/project/domain/state.ts`, version 2.
La persistencia funcional actual es un agregado local en localStorage, no una
base relacional ni una cuenta. `ProjectState` agrupa:

| Coleccion / dato | Productor observable | Que significa y cautela al migrar |
| --- | --- | --- |
| users | CRUD didactico de usuarios; evidencia adicional users:create/edit/status/delete/restore | Datos ficticios: nombre, correo de prueba, rol student/teacher/evaluator, estado active/inactive. No identidad, acceso ni autorizacion. Se reportan como simulacion. |
| personas, scenarios | Laboratorio de investigacion, escenarios y actividades | Modelos de diseno; pueden ser observados, supuestos o mixtos. Escenario puede ser ficticio. No son cuentas ni necesariamente personas identificables. |
| appointments | Reserva de asesoria/servicio | Datos locales de practica y estado confirmed/cancelled; no presumir una reserva real de servicio externo. |
| findings | Evaluacion heuristica | Autor humano/IA y estado pending/validated/rejected; una propuesta IA pendiente no es hallazgo validado. |
| sessions | Pruebas de usuario, exito, tiempo, errores, SEQ, emocion y respuestas SUS | Registro declarado/observado de una sesion de evaluacion, distinto de haber completado una leccion. Puede incluir alias. |
| evidence | Conceptos, patrones, Fitts/Hick, SUS, UX, TLX, chatbot, IA y comparaciones | Registro explicito con demo opcional, tarea, condicion, prototipo, puntuaciones y notas. Cada tipo tiene payload y reglas propias; no equivale por defecto a entrega ni aprendizaje demostrado. |
| trackingSessions, pageSessions | Practicas de seguimiento de cursor/scroll, simulacion y captura opcional | Puede contener muchas muestras con coordenadas, rutas, dimensiones, canal, alias, tiempos y exposicion. No migrar automaticamente, especialmente mirada/camara. |
| multimodalEvidence | Practicas de vision/dispositivo y canal | Resultado declarado o simulado, no prueba de una capacidad del usuario. |
| events | Flujo de reserva local, errores/completado, cambios, IA y export | Telemetria local asociada al prototipo. No importar el historial detallado como telemetria del servidor por defecto. |
| a11yChecks | Checklist local de accesibilidad | Estado del proyecto/demo, no evaluacion externa ni propiedad de una cuenta. |
| reportDraft | Editor de informe | Borrador mutable y guardado explicito; no informe emitido ni entrega inmutable. |
| preferencias/idioma | claves separadas de proyecto | La exportacion puede incluir preferencias e idioma; son ajustes de cliente, no datos de dominio compartibles automaticamente. |

Actividades: conceptos guardan evidencia al registrar decision/respuesta;
patrones requieren problema/principio/correccion; practicas Fitts/Hick solo
guardan una medicion final de ocho ensayos, separada de la practica;
SUS y TLX guardan cuestionarios/puntuaciones; UX guarda observaciones;
chatbot/IA separa propuesta de revision humana; seguimiento puede capturar
muestras detalladas y queda fuera de sincronizacion predeterminada. Reglas y
payloads estan repartidos entre `features/*/application`, `domain` y
`tests/unit/*Operations.test.ts`.

### Respaldos existentes

`hci-lab-ia-project-v2`: estado version 2 local.
`hci-lab-ia-backup`: sobre version 1, `exportedAt`, preferencias e idioma;
contiene un proyecto version 2. `parseBackup` valida campos permitidos,
rangos, enumeraciones, IDs duplicados, nesting y algunos invariantes. Se
aceptan colecciones opcionales antiguas ausentes y se completan con listas
vacias; se conservan versiones locales de tracking/capturas. El reset es local.

Contrato futuro de importacion/exportacion: mantener los formatos locales;
no reinterpretar su version como esquema de servidor. Solo proponer una
importacion previa, seleccionada y consentida a una cuenta; mostrar categorias,
conteos, datos de alto riesgo, conflictos y destino; validar completamente
antes de escribir; aceptar una transaccion atomica por agregado; informar
errores por categoria sin exponer datos; no enviar preferencias, alias,
muestras de camara/mirada o eventos detallados de forma implicita. Original
descargable y recuperacion local permanecen utilizables sin backend.

## 2. Distinciones del dominio

- Cuenta real: sujeto autenticable, identificador interno opaco, credenciales/
  proveedor, verificacion y ciclo de vida. Solo Identidad la gestiona.
- Usuario ficticio: recurso de ejemplo del CRUD, sin autenticacion ni permisos.
  La palabra `role` de ese modelo es contenido academico; renombrar a
  `simulatedRole` al transferir datos si la importacion se habilita.
- Rol global: permisos de plataforma asignados por mecanismo administrativo
  separado, escasos y auditados. El rol `participant` solo expresa uso normal;
  `teacher/leader` no se infiere de un rol didactico ni de ser autor.
- Responsabilidad de grupo: owner, leader, instructor, member o reviewer ligada
  a membresia de un group y su alcance. Un usuario puede tener distinto rol en
  cada grupo. Administrador de plataforma no obtiene automaticamente acceso a
  contenido privado.
- Borrador: mutable, privado al autor salvo comparticion explicita.
- Resultado de actividad: salida validada de una sesion/practica; se puede
  mantener privado o adjuntar al trabajo.
- Entrega versionada: instantanea inmutable de un trabajo para una actividad,
  curso o grupo; correcciones producen nueva version, no alteran la anterior.
- Evidencia: artefacto con procedencia, metodo, origen (humano/medido/declarado/
  simulado/mixto), consentimiento y relaciones; es materia de revision.
- Actividad completada: evento operacional (pasos minimos satisfechos).
- Aprendizaje evaluado: juicio versionado con instrumento/criterios, evaluador,
  fecha y resultado. No derivar automaticamente de abrir pagina, completar
  simulador o guardar evidencia. Progreso y evaluacion deben ser registros
  distintos.

## 3. Propuesta relacional provisional para contrastar con el MER

Esto es una lista de entidades candidatas y relaciones, no DDL ni tablas
aprobadas. Confirmar granularidad, atributos, cardinalidad y retencion con el MER.

| Candidatas | Relaciones/cardinalidad por validar | Restricciones e indices candidatos |
| --- | --- | --- |
| Identity: Account, Credential/ExternalIdentity, Session | Account 1:N credenciales y sesiones; proveedores externos opcionales | UNIQUE(provider, subject); email normalizado UNIQUE solo si sera identificador; hash de credencial solamente; index de expiracion/revocacion; nunca email en logs |
| Community: Group, Membership, Invitation | Account N:M Group via Membership; Group 1:N invitaciones; invitacion aceptada crea membresia | UNIQUE(group_id, account_id); CHECK rol/estado; expiracion e invitacion de un uso; indices por cuenta/grupo/estado |
| Learning: Workspace/Work, WorkRevision, ActivityDefinition/Attempt, ProgressRecord, LearningAssessment | Account 1:N work; work 1:N revisiones/attempts; assessment referencia revision e instrumento; grupo opcional mediante referencia opaca | version monotona por work; UNIQUE(work_id, revision_number); clave de idempotencia acotada a actor/operacion; indices por propietario/actualizacion y curso/estado |
| Evidences: Submission, SubmissionRevision, Artifact/Evidence, Feedback, ReportSnapshot | revision N:M evidencias segun el MER; entrega 1:N revisiones; retroalimentacion apunta a una revision exacta; informe captura versiones de origen | UNIQUE(submission_id, revision_number); evidence provenance obligatoria; indexes por revision/autor/creacion; no editar una revision entregada |
| Join service-specific | FK solo dentro de servicio; ids de otros servicios son UUID opacos sin FK | referencias remotas validadas por contrato/evento; evaluar outbox local para eventos requeridos |

Cuestiones MER: quien es propietario de trabajo (persona, grupo o ambos);
si Workspace y curso son agregados separados; cardinalidad attempt a revision;
tipo de entrega individual/grupal; evaluadores multiples y rubrica; multiples
pertenencias/invitaciones; borrado anonimizacion o retencion; identidad de
participante menor/anonima; catalogo estable de actividad; version de rubrica;
modelo de consentimiento; borradores de informe; referencias y snapshot;
preservar historial si cuenta se elimina; tratar evidencia biometrica.
No definir PK/FK, nulabilidad, cascadas, tipos, particiones o RLS finales antes
de resolver esas cuestiones con el MER.

Politica candidata: cuenta se desactiva/revoca sesiones de inmediato; eliminar
datos personales segun solicitud y ley aplicable cuando se defina jurisdiccion;
preservar agregados anonimizados solo si no reidentifican. Borrar grupo archiva
tras resolver propiedad de trabajos y entregas. Borrar work como tombstone/
solicitud de eliminacion con referencias, no CASCADE interservicio. Una revision
entregada se retiene segun politica aprobada; correccion crea nueva revision.
Evidencia con identificadores personales, mirada, video y telemetria detallada
no se recoge por defecto. Las cascadas locales aun requieren aprobacion del MER.

## 4. Requisitos con identificadores

| ID | Requisito |
| --- | --- |
| RNF-01 | El visitante explora conceptos y practica sin cuenta ni disponibilidad de API. |
| RNF-02 | Los cuatro servicios despliegan y almacenan por separado; ningun servicio consulta tablas de otro. |
| RNF-03 | Dominio y aplicacion no dependen de HTTP, framework ni PostgreSQL. |
| RNF-04 | Autorizacion se aplica en cada operacion y en servidor; denegar si un permiso remoto no se puede validar. |
| RNF-05 | Datos de grupos se filtran por membresia actual; identificador conocido no concede acceso. |
| RNF-06 | Toda API publica tiene OpenAPI, errores estables y paginacion con orden determinista. |
| RNF-07 | Migraciones son idempotentes/versionadas, verificadas en base vacia y desde revision anterior. |
| RNF-08 | Cambios de un agregado son atomicos; conflicto concurrente da 409/412, nunca sobreescritura silenciosa. |
| RNF-09 | Reintentos de operaciones mutables no duplican resultados cuando el contrato admite idempotencia. |
| RNF-10 | Seis idiomas del frontend (es/en/fr/pt/it/ca), teclado, foco y anuncios siguen siendo requisito de interfaz integrada. |
| RNF-11 | No persistir video, mirada ni telemetria detallada por defecto; minimizacion, consentimiento y retencion antes de captura explicita. |
| RNF-12 | Ningun secreto, datos personales reales ni fixtures identificables se versiona. |
| RNF-13 | Importacion de respaldos valida esquema completo y requiere accion explicita; el modo anonimo conserva operacion. |
| RNF-14 | Actividad completada y aprendizaje evaluado son estados/entidades separados y con procedencia. |
| RNF-15 | Fallos parciales entre servicios se comunican como estado pendiente/reintentable, no exito falso. |

## 5. Historias y criterios de aceptacion

**HU-01 Visitante anonimo.** Como visitante quiero estudiar y probar el laboratorio.
CA: no hay red obligatoria; sin sesion puedo navegar y reiniciar; no se crea
cuenta ni progreso remoto sin accion.

**HU-02 Alta de cuenta.** Como participante quiero crear/acceder a una cuenta
opcional. CA: errores no revelan si una cuenta existe; credencial nunca se
devuelve; verificacion y limite de intentos segun politica; revocar sesiones.
Metodo de autenticacion y proveedor aun por decidir.

**HU-03 Guardar trabajo.** Como participante autenticado quiero guardar y
versionar trabajo. CA: servidor asigna owner desde sujeto verificado; rechazo
de owner suministrado por cliente; version esperada obsoleta produce conflicto;
reintento con misma clave no duplica revision; visitante mantiene flujo local.

**HU-04 Crear grupo.** Como profesor/lider quiero crear grupo e invitar
participantes. CA: rol de plataforma no basta para modificar membresias; codigo
de invitacion expira/consume una vez; cambiar/quitar rol se autoriza y audita.

**HU-05 Compartir trabajo.** Como miembro quiero colaborar dentro de mi grupo.
CA: cada lectura/escritura verifica membresia y alcance actual; cuenta de otro
grupo y miembro expulsado obtienen respuesta que no confirma existencia del
recurso privado.

**HU-06 Entregar revision.** Como participante quiero presentar version para
revision. CA: entrega identifica revision inmutable, autoria, grupo/actividad
y hora; corregir crea nueva revision; doble submit idempotente retorna mismo
resultado; validaciones devuelven errores de campo estables.

**HU-07 Retroalimentar.** Como profesor/revisor autorizado quiero comentar
una entrega. CA: comentario apunta a revision especifica; autor recibe
retroalimentacion; nueva version no muta la anterior; alumno no puede emitir
feedback como evaluador.

**HU-08 Evaluar aprendizaje.** Como evaluador quiero aplicar criterio versionado.
CA: registrar instrumento/criterios, evaluador, revision objetivo y juicio;
actividad completada sola no establece aprobado ni dominio; cambios publican
otra evaluacion o revision auditable.

**HU-09 Generar informe.** Como profesor quiero resumir trabajo autorizado.
CA: solo agrega entregas visibles; snapshot identifica revisiones e instrumento;
si servicio fuente falla se marca parcial/stale y no se presenta como completo;
no extrae datos de otro grupo.

**HU-10 Importar respaldo.** Como titular quiero elegir que importar desde el
respaldo local. CA: vista previa de categorias, simulaciones y capturas;
ningun dato se transfiere hasta confirmar; se reportan omisiones/conflictos;
fallo no deja importacion parcial del agregado elegido.

## 6. Matriz de permisos inicial

Convenciones: V visitante, P participante autenticado, L profesor/lider con
membresia y permiso en el grupo, A administrador de plataforma. Crear un grupo
asigna owner responsable. Profesor/lider sin membresia no es L para ese grupo.
A no lee contenido privado automaticamente; break-glass futuro requiere razon,
alcance, expiracion y auditoria. "—" deniega.

| Accion | V | P | L del grupo | A |
| --- | --- | --- | --- | --- |
| Leer conceptos/practicar local | Si | Si | Si | Si |
| Crear cuenta / iniciar sesion | Opcional | Propia | Propia | Propia |
| Leer/editar cuenta y sesiones propias | — | Propia | Propia | Propia; gestion autorizada auditada |
| Guardar/leer/borrar borrador privado | — | Propio | Propio; ajeno solo si compartido | —; no implica acceso |
| Crear grupo/invitar | — | Grupo propio/solicitud segun politica | Grupo donde puede gestionar | administrar configuracion, auditado |
| Leer material de grupo | — | Miembro actual | Miembro actual | — salvo break-glass aprobado |
| Cambiar miembros/roles | — | — | Solo permiso de gestion; no su propio ascenso | Administrar plataforma, no asumir rol docente |
| Entregar/revisar trabajo | — | Entregar propio / ver feedback propio | Ver segun asignacion; comentar con permiso | —; break-glass explicito |
| Emitir evaluacion / informe grupal | — | — | Asignado y autorizado; datos visibles | — salvo acceso temporal auditado |
| Datos CRUD usuarios ficticios | Solo simulacion local | Igual | Igual | Igual; nunca sirve de ACL real |

Todas las filas autenticadas prueban sujeto, recurso, grupo y operacion en
servidor. No aceptar `role`, `ownerId`, `groupId` como prueba de permiso.
Listados filtran antes de paginar; conteos y facetas no filtran datos ajenos.

## 7. Limites y operaciones interservicio

Identidad: cuentas, autenticadores, verificacion, sesiones y sujeto. Emite
identificador/claims de autenticacion, sin importar tablas docentes.
Comunidad: grupo, membresia, invitacion y rol contextual. Autoriza grupo.
Aprendizaje: trabajos, revisiones de trabajo, actividad, intentos, progreso
operacional, evaluaciones de aprendizaje, reglas de sugerencia.
Evidencias: registro fuente/metodo, entregas versionadas si se consideran
artefactos evaluables, feedback, snapshots de informe. El solapamiento entre
revision de Work y Submission es decision del MER; la propuesta inicial:
Learning posee revision de work; Evidencias posee el acto de entrega y feedback.

**Lectura privada de grupo:** servicio recurso obtiene identidad autenticada;
si referencia group, consulta a Comunidad `authorize(subject, group, action,
resource)` con solicitud interna autenticada y timeout corto. Si denegado,
ausente o timeout: falla cerrada; API externa devuelve error generico sin
filtrar existencia. Riesgo: disponibilidad/latencia y carreras de revocacion.
Mitigar con grants versionados de corta vida, invalidacion por evento y
comparacion de membership version; no cache amplia hasta fijar SLA y garantia
de revocacion. Decidir consistencia fuerte vs ventana tolerada con el MER.

**Entrega:** cliente envia intento con clave idempotente; Learning verifica
dueno/version y guarda en transaccion local. Evidencias crea submission ligada
a revision de Learning por API. No hay transaccion distribuida. Registrar
estado `submissionPending` / outbox y reintento idempotente; una caida no
informa "entregado" hasta confirmacion de Evidence. Si Evidence acepta y falla
la respuesta, reintentar misma clave. Si Learning confirma evento y Evidence
falla, reconciliar; no compensar borrando una revision. Politica de cola y
retencion pendientes.

**Feedback:** Evidence verifica scope con Comunidad, escribe comentario en
su servicio y encola notificacion fuera de transaccion. Notificacion fallida
no pierde feedback; reintento/outbox e idempotencia. No se crea quinto servicio
hasta existir requisito de notificacion sostenida.

**Informe:** Evidence captura un conjunto limitado y autorizado de IDs y
versiones por contrato; fallo parcial marca snapshot partial/stale y servicios
faltantes. Reintentar, no combinar tablas. Definir TTL/cache y dato permitido.

Eventos asincronos futuros usan outbox en transaccion del productor e inbox/
deduplicacion del consumidor. Esquema de evento versionado, actor opaco,
timestamp y correlation ID; evitar contenido privado en payloads. No asumir
exactly-once ni orden global.

## 8. Contratos REST iniciales (propuesta, no implementada)

Prefijo `/v1` por servicio y OpenAPI 3.1. JSON UTF-8. Errores:
`{ "code": "WORK_VERSION_CONFLICT", "requestId": "...", "fields": [] }`;
no texto traducido en backend, stack, SQL, tokens ni dato privado. Codigos
candidatos: `INVALID_REQUEST` 400, `UNAUTHENTICATED` 401,
`FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409,
`PRECONDITION_FAILED` 412, `VALIDATION_FAILED` 422,
`RATE_LIMITED` 429, `DEPENDENCY_UNAVAILABLE` 503.
404 generico para recursos de grupo cuya existencia filtraria informacion.

| Servicio | Rutas candidatas |
| --- | --- |
| Identidad | POST /v1/accounts; POST /v1/sessions; DELETE /v1/sessions/current; GET /v1/accounts/me; PATCH /v1/accounts/me |
| Aprendizaje | POST/GET /v1/works; GET/PATCH/DELETE /v1/works/{id}; POST /v1/works/{id}/revisions; GET /v1/works/{id}/revisions; POST /v1/activities/{id}/attempts; POST /v1/works/{id}/assessments |
| Comunidad | POST/GET /v1/groups; GET/PATCH/DELETE /v1/groups/{id}; POST /v1/groups/{id}/invitations; POST /v1/invitations/{token}/accept; GET/PATCH/DELETE /v1/groups/{id}/members/{accountId} |
| Evidencias | POST/GET /v1/submissions; GET /v1/submissions/{id}; POST /v1/submissions/{id}/revisions; POST /v1/submissions/{id}/feedback; GET /v1/submissions/{id}/feedback; POST /v1/reports; GET /v1/reports/{id} |

Revisar si DELETE de submission/feedback debe ser retract, supersede o policy
de borrado; no dar DELETE a revision entregada por defecto. Catalogos estaticos
de actividades pueden ser versionados en Learning sin CRUD publico.

Paginacion cursor opaco para colecciones crecientes, keyset estable por
(created_at,id), limite default 25 y max 100. Cursor ligado a filtro/orden,
sin total exacto salvo necesidad; respuestas `items,nextCursor`. Fechas UTC
RFC 3339, IDs opacos. Orden documentado y estable; limites min/max en servidor.
Filtros no controlan SQL libre. Buscar por owner/scope solo despues de ACL.
OpenAPI debe precisar esquema de entrada y salida, scopes, status, errores,
limites, headers y ejemplos sinteticos no personales.

Autenticacion: sesion opaca en cookie Secure, HttpOnly, SameSite y defensa
CSRF para browser; para movil evaluar OAuth/OIDC Authorization Code con PKCE.
Elegir proveedor, registro, verificacion, recuperacion MFA y expiracion antes
de HU-02. No almacenar access tokens en localStorage; cookies cross-site/CORS
solo con origenes explicitos y credenciales configuradas. No conectar frontend
hasta definir URL, origen y flujo anonimo. HTTPS fuera de localhost.
Servicio-servidor usa identidad de servicio con credenciales rotables y scopes.

Concurrencia: GET entrega ETag/version; PATCH/submit condicionados con
If-Match. Revision conflictiva devuelve 412; conflicto de unicidad/invitacion
consumida devuelve 409. Transacciones locales y constraints como autoridad
final, no solo validaciones en app. Idempotency-Key en creacion de cuenta cuando haya efectos repetibles de
provisionamiento, y en entrega/feedback/invitacion/callbacks con side effects;
no registrar cuerpos de autenticacion ni guardar contrasenas en respuestas
idempotentes. En creacion de cuenta, disenar primero respuestas que no permitan
enumerar cuentas y la interaccion entre idempotencia y privacidad. Guardar hash de request, actor, scope,
status y respuesta minima por TTL; misma clave/cuerpo retorna resultado; misma
clave/cuerpo distinto da 409. TTL y respuesta con datos sensibles pendientes.

## 9. Stack minimo compatible

| Pieza | Seleccion inicial | Motivo y verificacion |
| --- | --- | --- |
| Runtime | Node.js 24 LTS, ESM | Version instalada al revisar frontend; Fastify 5 exige Node 20+. Fijar patch/imagen y engines en setup reproducible. |
| TypeScript | TypeScript 5.8 actual del frontend, compilado a ESM JavaScript | Permite tipos en dominio/aplicacion sin depender del soporte runtime de TS; alinear con frontend reduce curva, actualizar tras revisar matriz Fastify/TS y lockfile. |
| HTTP/OpenAPI | Fastify 5 + JSON Schema TypeBox, plugin oficial OpenAPI | Schemas de request/response versionados y documentables desde rutas; validar dependencias y tipos con build antes de fijar. Fastify v5 compatible con Node 20+, por tanto 24 cumple minimo publicado. |
| PostgreSQL | PostgreSQL 18 como objetivo candidato; probar version exacta/driver | 18 figura soportada; 17 es alternativa si imagen/CI/hosting limita. No fijar DDL ni version en esquema antes de conocer despliegue/MER. |
| Driver/migraciones | `pg` con SQL parametrizado; migraciones SQL versionadas con runner minimo por servicio | Evita ORM y abstraccion transversal; constraint SQL es autoridad. Elegir runner (node-pg-migrate o SQL simple con tabla local schema_migrations) despues de spike de migracion reproducible. |
| Tests | `node:test` para dominio/HTTP; Vitest si se comparte ergonomia con frontend; Supertest/inject; PostgreSQL real en integracion | Frontend ya usa Vitest. No simular constraint/concurrency con SQLite/mocks. Tests centrales en `services/<servicio>/tests`; PostgreSQL via CI service/container aislado y reset por esquema. |
| Contratos | OpenAPI 3.1 JSON en cada servicio; linter de contrato en CI | Ruta 3.1 consistente con documento generado/validado y consumidores web/movil. Aun falta generar contrato de cada ruta real. |

Compatibilidad parcialmente comprobada: Node v24.15.0 estaba instalado;
frontend usa TS ~5.8.3, ESM y Vitest 3.2.4; Fastify 5 soporta Node 20+ segun su
guia oficial, por lo que cumple runtime. PostgreSQL 18 es una version soportada
por el proyecto upstream en la fecha de revision; probar imagen y hosting aun
pendiente. No se instalaron paquetes, no se ejecutaron pruebas en esta tarea.
No se declara compatibilidad efectiva del conjunto Fastify/TypeBox/TS ni driver
hasta lockfile, build, test de arranque y test PostgreSQL real.

Referencias de compatibilidad consultadas (23 oct 2026): [Fastify v5 migracion](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/),
[PostgreSQL versiones soportadas](https://www.postgresql.org/support/versioning/),
[PostgreSQL release notes](https://www.postgresql.org/docs/current/release.html).

## 10. Flujo integral y fallos

1. Visitante: leer material y practicar sin backend, sesion o progreso remoto.
2. Crear cuenta opcional y verificarla. Fallo de entrega de email/notificacion
   no expone si hay cuenta; operacion queda reintentable.
3. Guardar trabajo: crear Workspace privado con owner server-side; cliente
   conserva el trabajo anonimo hasta que autorice importar. Conflictos entre
   local/remoto requieren vista previa y seleccion, nunca merge opaco.
4. Grupo: crear o aceptar invitacion; verificar rol contextual. Fallo al
   notificar no deshace membresia creada; outbox reintenta. Token consumido
   idempotentemente responde estado estable sin volver a dar acceso.
5. Entrega: congelar una revision, validar el permiso actual y aceptar de modo
   idempotente. Fallo de Evidence marca pendiente y se reconcilia.
6. Feedback: comentario asociado a version de entrega; acceso verificado en
   Comunidad. Notificacion es eventual; contenido persiste si esa falla.
7. Informe: agregar solo versiones autorizadas y declarar fuente/alcance;
   errores parciales se muestran como parcial y permiten regenerar snapshot.
8. Evaluacion: evaluador autorizado registra criterio y resultado separado
   del evento completion; estudiante puede leer su resultado y feedback.
9. Retiro/borrado: revocar sesiones, resolver propiedad de grupos, ejecutar
   solicitudes idempotentes por servicio y reportar estados parciales; retencion
   y anonimizado requieren policy/jurisdiccion definida.

## 11. Decision log y entradas requeridas

| ID | Decision pendiente | Bloquea |
| --- | --- | --- |
| D-01 | MER que entregara el usuario; atributos, cardinalidades y reglas | Tablas y migraciones definitivas |
| D-02 | Quien crea grupos y fuente de rol global/admin | Autorizacion y HU-04 |
| D-03 | Owner y colaboracion de Workspace individual/grupal | Aislamiento y consultas |
| D-04 | Division exacta de WorkRevision frente a Submission | Limites Learning/Evidence |
| D-05 | Instrumentos, escalas, umbrales y autoridad de evaluacion | HU-08 y estados |
| D-06 | Proveedor/metodo de identidad, verificacion y recuperacion | Esquema Identity y sesiones |
| D-07 | Politica de borrado, retencion, exportacion y jurisdiccion | Cascadas, legal hold, backup |
| D-08 | Datos permitidos de captura/consentimiento/menores | Modelado de evidencias |
| D-09 | Infraestructura, tenancy, SLA de Comunidad y eventos | Autorizacion cacheada/consistencia |
| D-10 | Canales y seis traducciones del cliente | Contratos de errores y UI |

**Entrada solicitada para cerrar el diseno:** entregar el MER (imagen legible o
exportacion fuente, incluyendo cardinalidades, claves y notas). Luego se
contrastara entidad por entidad; hasta entonces, el inventario relacional de
arriba sigue siendo candidato. La presente iteracion cierra solo el inventario
y el contrato conceptual, no el diseno fisico.
