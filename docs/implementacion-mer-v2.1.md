# Implementación del MER v2.1

Actualizado el 24 de octubre de 2026. Fuentes revisadas: docs/modelo-backend/01-modelo-er.md y docs/modelo-backend/02-ddl-postgresql.sql. El MER contiene 55 entidades lógicas. Su DDL consolidado conserva relaciones entre dominios para explicar el modelo y no se aplica tal cual a cuatro servicios independientes.

## Estado de esquema

Se derivaron y aplicaron migraciones físicas por servicio. Identidad 003 es aditiva respecto de 002_accounts.sql: conserva cuentas, sesiones y hashes; traduce el rol heredado a CUENTA_ROL y deriva pending/active/inactive. Identidad 004 alinea name con display_name sin eliminar el alias legacy. Aprendizaje 003 agrega clave idempotente a ENTREGA. Las migraciones 002 materializan tablas del MER dentro del propietario local. Las bases de desarrollo existentes recibieron las migraciones sin reconstruir datos.

El reparto incluye 58 tablas de dominio físicas: las 55 entidades lógicas más tres copias locales adicionales de EVENTO_AUDITORIA, una por servicio, para que cada propietario audite sin compartir tablas. Se suman cuatro tablas técnicas de metadatos de migración. La cobertura de esquema no significa que las 55 entidades tengan casos de uso HTTP completos.

| Propietario | Entidades del MER y estado |
|---|---|
| Identidad | CUENTA, ROL, PERMISO, CUENTA_ROL, ROL_PERMISO, SESION_ACCESO, TOKEN_CUENTA, PREFERENCIA_CUENTA y EVENTO_AUDITORIA. Registro, verificación, sesión, recuperación, perfil y administración global están implementados. PREFERENCIA_CUENTA y auditoría tienen esquema; API funcional pendiente. |
| Aprendizaje | ESPACIO_TRABAJO, MODULO, ACTIVIDAD, ACTIVIDAD_VERSION, DEFINICION_METRICA, ASIGNACION_ACTIVIDAD, CRITERIO_ASIGNACION, EJECUCION_ACTIVIDAD, VALOR_METRICA, ENSAYO_EXPERIMENTO, RESULTADO_CONCEPTO, OBSERVACION_PATRON, REVISION_IA, EVALUACION_CHATBOT, EVIDENCIA_MULTIMODAL, PERSONA, ESCENARIO, INSTRUMENTO, ITEM_INSTRUMENTO, SESION_EVALUACION, RESPUESTA_ITEM, HEURISTICA_VERSION, HALLAZGO_HEURISTICO, ENTREGA, VALORACION, RETROALIMENTACION, USUARIO_DEMO y auditoría local. Hay APIs de catálogo, espacios, ejecuciones, asignaciones, entregas, revisión/valoración y respuesta a retroalimentación. Las otras entidades tienen persistencia migrada, pero requieren casos de uso. |
| Comunidad | GRUPO, MEMBRESIA_GRUPO, INVITACION_GRUPO, ESPACIO_TRABAJO_GRUPO, SUGERENCIA, HISTORIAL_SUGERENCIA, SERVICIO_RESERVA, RESERVA y auditoría local. Están implementados crear/listar grupos propios, invitaciones de un uso, aceptar/revocar invitación, retiro de participantes y crear sugerencias. Faltan reservas, moderación/historial de sugerencias y compartir/revocar ESPACIO_TRABAJO_GRUPO. |
| Evidencias | SESION_UX, EVENTO_UX, SESION_UX_EXPOSICION, VALIDACION_CALIBRACION, CONSENTIMIENTO, VERIFICACION_ACCESIBILIDAD, EVENTO_LABORATORIO, EVIDENCIA, ENTREGA_EVIDENCIA, INFORME, INFORME_REGISTRO y auditoría local. Se guardan sesiones UX agregadas con consentimiento y definiciones de informe con ejecuciones seleccionadas. Eventos detallados, calibración, accesibilidad, adjuntos binarios y generación/exportación de informes todavía no tienen flujo funcional. |

Las migraciones no crean FKs a cuentas, grupos, espacios o ejecuciones en otras bases. Las APIs propietarias verifican referencias externas. Los binarios de EVIDENCIA no se guardan en PostgreSQL; faltan almacenamiento de objetos, carga, verificación de tipo/hash y eliminación.

## Permisos efectivos

| Actor | Acceso |
|---|---|
| Visitante | Consultar catálogo público y usar prácticas locales. No se crean cuentas temporales ni escrituras API, informes, telemetría o sugerencias. |
| Participante | Perfil propio, espacio propio, ejecuciones y entregas propias; aceptar invitación dirigida a su correo; consultar grupos a los que pertenece dentro de los endpoints disponibles; responder retroalimentación y crear sugerencia. |
| Profesor/líder | leader es función local y requiere membresía activa; permite acciones de liderazgo dentro de ese grupo. Crear asignaciones, valorar o revisar requiere además rol global teacher o evaluator y liderazgo activo en el grupo. Un rol global no concede acceso a grupos sin membresía. |
| Administrador global | Administrar cuentas y roles globales en Identidad. No obtiene acceso automático a espacios, grupos, entregas ni informes ajenos. |

Las solicitudes con cookie usan sesión HttpOnly; mutaciones requieren CSRF y Origin permitido. Roles administrativos nunca se aceptan del cuerpo público. La autenticación entre servicios usa introspección de Identidad y un token interno compartido por el entorno; no hay credencial criptográfica distinta por servicio.

## Contratos REST disponibles

Cada servicio publica OpenAPI 3.1 en /openapi.json y salud en /health/live y /health/ready. Rutas de datos usan /v1; rutas internas en /internal/v1 requieren token de servicio.

- Identidad: /v1/accounts, /v1/email-verifications, /v1/sessions, /v1/password-resets, /v1/accounts/me y /v1/admin/accounts.
- Aprendizaje: GET /v1/activities?locale=es-CO&limit=25&offset=0; /v1/workspaces; /v1/executions; /v1/groups/{groupId}/assignments; /v1/executions/{id}/deliveries; /v1/deliveries/{id}/evaluations, /reviews y /feedback.
- Comunidad: /v1/groups, /v1/groups/{id}/invitations, /v1/group-invitations/accept, /v1/groups/{groupId}/members/{accountId}, /v1/groups/{groupId}/invitations/{invitationId} y /v1/suggestions.
- Evidencias: /v1/ux-sessions, /v1/ux-sessions/{id}/consent y /v1/reports.

Los endpoints de listado que exponen paginación usan limit, por defecto 25 y máximo 100, y offset. Los errores tienen forma {code, requestId}; X-Request-Id correlaciona la respuesta. Códigos estables incluyen INVALID_REQUEST, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, ROUTE_NOT_FOUND, VERSION_CONFLICT, STATE_CONFLICT, DEPENDENCY_UNAVAILABLE, CONSENT_REQUIRED y RATE_LIMITED. Identidad también expone ACCOUNT_NOT_FOUND. El frontend traduce códigos, no depende del texto interno.

POST de ejecución y entrega requiere Idempotency-Key UUID. Repetir la misma clave y contenido devuelve el resultado guardado; reutilizarla con contenido distinto produce conflicto. La ejecución se actualiza mediante version optimista; las entregas reciben número secuencial dentro de transacción. completed indica fin de práctica, no aprendizaje evaluado. La valoración por criterio y la retroalimentación son registros separados.

## Límites y fallos parciales

Aprendizaje consulta a Comunidad para comprobar membresía y Evidencias consulta a Aprendizaje para comprobar propiedad de espacio/ejecución. Si Identidad, Comunidad o Aprendizaje no están disponibles, la operación dependiente falla cerrada con 503 y no guarda el registro. No hay transacción distribuida.

Estas integraciones son síncronas. No hay outbox/inbox, eventos, proyecciones asíncronas ni reintentos durables; son necesarios antes de añadir flujos de consistencia eventual. Un informe guarda su definición y fuentes elegidas, no genera archivo ni agrega automáticamente todas las fuentes.

## Flujo funcional disponible y brechas

1. Visitante explora y practica localmente; puede usar copias locales compatibles. No hay carga automática del respaldo al backend.
2. Crea cuenta, verifica correo e inicia sesión. Puede crear un espacio y sincronizar explícitamente datos mediante las APIs disponibles; integración de importación del respaldo pendiente.
3. Crea un grupo y queda como líder local. Crea una invitación de un uso y la distribuye manualmente; aún no se envía por correo.
4. Un miembro inicia ejecución vinculada a una asignación y envía entregas versionadas. El catálogo no tiene seed de actividades v2.1, así que en una base nueva hay que cargar actividades antes de asignar.
5. Profesor/evaluador autorizado que también lidera el grupo revisa, cambia estado, valora criterios y deja retroalimentación. El participante puede responder.
6. Evidencias valida por API la propiedad y guarda una definición de informe con ejecuciones permitidas. Generación de archivo y otras fuentes del MER pendientes.

## Verificación realizada

Se ejecutaron lint con verificador de arquitectura, compilación TypeScript, pruebas Vitest e integración PostgreSQL, con pruebas de identidad, membresía, aislamiento entre cuentas/grupos, invitaciones, idempotencia, concurrencia de entregas, consentimiento, reportes y evaluación explícita. npm run db:migrate aplicó migraciones nuevas sin modificar migraciones previas. Las pruebas no ejecutan el DDL consolidado entero como una base única; las migraciones físicas por servicio son el contrato desplegable.

Comandos locales: npm run lint; npm run build; definir $env:TEST_POSTGRES = "1"; npm test; npm run db:migrate.

## Pendientes antes de considerar completo el backend del MER

- Sembrar módulos, actividades y versiones en seis idiomas con datos ficticios revisados.
- Completar casos de uso y contratos para métricas, ensayos Fitts/Hick, resultados específicos, personas/escenarios, instrumentos/respuestas, hallazgos, preferencias, usuarios demo, accesibilidad, reservas, moderación de sugerencias, auditoría y compartir espacios.
- Implementar exportación de informes y almacenamiento de evidencias fuera de PostgreSQL.
- Definir política institucional de retención, anonimización y eliminación.
- Definir y probar proveedor SMTP real; solo está validado el adaptador local de desarrollo.
- Separar credenciales internas por servicio o usar mTLS/identidad de carga; añadir observabilidad de dependencias.
- Añadir outbox/inbox e idempotencia durable antes de flujos asíncronos e informes derivados.
- Integrar guardado remoto opcional con frontend sin alterar anónimo, los seis idiomas, accesibilidad ni copias locales.

## Revisión manual

En PowerShell, seguir docs/iteracion-2.md, levantar servicios locales y consultar /health/ready y /openapi.json en los puertos 3001–3004. Verificar que la práctica anónima no genera escritura y que al cerrar sesión no queda token en localStorage. Después recorrer cuenta verificada → espacio → grupo/invitación → catálogo cargado → asignación → entrega → revisión → definición de informe.