# Eventos durables e informes remotos

Los cuatro servicios conservan sus propios `event_outbox`, entregas, `event_inbox` y proyecciones. Las migraciones son aditivas: Identidad 006, Aprendizaje 006, Comunidad 004 y Evidencias 004. Evidencias 005 incorpora el estado de generación y los snapshots inmutables del informe. No hay claves foráneas ni consultas entre bases de servicios.

## Operaciones y entrega

Los triggers locales insertan el evento y sus destinos dentro de la misma transacción que la cuenta, ejecución, entrega, revisión, membresía, reserva o informe. El payload de transporte contiene identificadores, versiones y estados; no incluye correos, nombres, contraseñas, tokens, sugerencias privadas, trayectorias UX ni video.

El worker adquiere entregas con `FOR UPDATE SKIP LOCKED`, identifica cada lease y recupera leases vencidos. Reintenta errores temporales con backoff exponencial acotado; después de ocho intentos deja la entrega en `deadletter`. Los errores HTTP permanentes van a `deadletter`. La entrega es al menos una vez: el receptor confirma solamente después de insertar su inbox, actualizar la proyección y ejecutar el consumidor en una sola transacción. `UNIQUE(source,event_id)` impide procesamiento duplicado; reutilizar un identificador con otro contenido devuelve `EVENT_ID_REUSED`. Una secuencia por servicio evita que un evento atrasado reemplace una proyección más reciente.

`x-request-id` se propaga al evento y al HTTP entre servicios. El pool instrumentado establece la correlación con `SET LOCAL` en la transacción, sin contaminar conexiones reutilizadas. Las proyecciones no conceden permisos: cada escritura y generación consulta la autorización vigente de forma síncrona.

Los endpoints internos usan `x-identity-internal-token` y no están destinados al navegador:

- `POST /internal/v1/events`: recepción y confirmación transaccional.
- `GET /internal/v1/events/status`: cantidades por destino y estado, sin payloads.
- `POST /internal/v1/events/retry`: `{eventId,target}` reabre una entrega en deadletter después de corregir su causa.

Las URLs de los destinos deben corresponder al entorno: localhost en ejecución nativa, nombres de servicio en Compose. Un token interno ausente desactiva el envío; no transforma solicitudes de visitantes en escrituras. Para componer otro servicio: usar `instrumentEventPool(rawPool)`, registrar `registerEventRoutes` directamente sobre Fastify antes de las rutas de negocio y arrancar `startEventWorker` con `schema`, `source`, token y destinos; detenerlo antes de cerrar el pool.

## Definición, generación y exportación

- `POST /v1/reports` conserva una selección tipada de registros después de verificar cuenta activa y acceso actual al espacio y a las fuentes. Acepta `Idempotency-Key` y CSRF con cookie HttpOnly.
- `GET /v1/reports?workspaceId=UUID&limit=25&offset=0` lista informes del espacio autorizado.
- `GET /v1/reports/:id` obtiene definición, selección, estado, snapshot, versión y fuentes pendientes.
- `POST /v1/reports/:id/generate` no lleva cuerpo y requiere `Idempotency-Key`; un lease evita generaciones simultáneas y el resultado de la clave se conserva para reintentos.
- `GET /v1/reports/:id/export?format=json|markdown|csv` descarga el contenido real del snapshot. PDF devuelve `FORMAT_UNSUPPORTED`: no hay renderer PDF implementado.

Aprendizaje autoriza al propietario del espacio o consulta a Comunidad para confirmar un líder activo de un grupo que lo comparte. Un rol global de profesor o administrador no sustituye esa responsabilidad local. Cada fuente responde a `POST /internal/v1/report-records/snapshot` con `{accountId,workspaceId,records:[{source,id}]}` y devuelve `{items:[{source,id,version,activityVersion?,instrumentVersion?,formulaVersion?,data}],missing:[{source,id}]}`. Comunidad responde por `reservation`; Aprendizaje por sus registros. Los registros de Evidencias vinculados a ejecuciones se contrastan también con Aprendizaje. Ningún consumidor consulta tablas ajenas.

Estados: `pending` al guardar o invalidar; `ready` cuando todas las fuentes responden; `partial` si faltan fuentes o registros y queda información disponible; `failed` si no se pudo reunir información. Cada generación conserva un snapshot nuevo con las versiones de actividad, instrumento y fórmula devueltas por la fuente. Una caída temporal conserva los registros anteriores con `stale=true` y `missingSources`; no se presentan como información actualizada. El worker revalida la cuenta y la autorización antes de reconciliar. Las notificaciones de cambios invalidan los informes afectados por medio del inbox; no existe una transacción distribuida ni una garantía de simultaneidad entre las distintas fuentes.

La retención de Evidencias tiene un mínimo operativo de 30 días (`EVIDENCE_RETENTION_DAYS`, por defecto `30`). El servicio ejecuta una limpieza al arrancar y cada 24 horas. El borrado se limita a datos propiedad de Evidencias que hayan superado ese plazo y no estén referenciados por informes; también elimina inbox ya procesados y proyecciones vencidas. Conserva entregas outbox pendientes, en reintento o en dead-letter. No guarda ni borra binarios externos: solo metadatos. El plazo mínimo fue autorizado para este entorno; cualquier retención institucional mayor debe configurarse con un valor superior.

## Verificación

Las pruebas de cada servicio permanecen en `tests/`. Las suites de eventos comprueban rollback conjunto, duplicados, reutilización alterada, orden, fallo del consumidor, reintentos, deadletter, leases vencidos, concurrencia y correlación. Evidencias añade snapshots versionados, autorización de propietario/líder, caída y recuperación de una fuente, exportación y rechazo de sesiones/CSRF ausentes.

En PowerShell, desde el backend:

```powershell
$env:TEST_POSTGRES = '1'
npm test -- services/evidencias/tests
```

Las pruebas de migración crean bases temporales aisladas y requieren administración PostgreSQL. Por defecto usan `POSTGRES_BOOTSTRAP_USER` y `POSTGRES_BOOTSTRAP_PASSWORD`. Si el volumen local conserva otra contraseña, puede usarse explícitamente el socket del contenedor para la administración de esas bases, sin cambiar credenciales:

```powershell
$env:TEST_POSTGRES_ADMIN_DOCKER = '1'
npm test -- services/evidencias/tests/report-migrations.integration.test.ts
```

Las conexiones de migrador y aplicación siguen usando sus credenciales separadas. La base temporal se elimina al terminar. Este modo requiere Docker Compose local; CI puede usar el modo TCP habitual.
