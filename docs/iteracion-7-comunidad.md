# Iteración 7 — Comunidad

## Resultado

Comunidad administra grupos, membresías, invitaciones, espacios compartidos, sugerencias con historial y reservas. Las escrituras de usuarios pasan por introspección de sesión de Identidad; el principal debe estar activo y las mutaciones con cookies requieren CSRF y origen permitido. Ninguna API admite una identidad elegida por el cliente.

Las funciones `leader` y `participant` viven en `community.membresia_grupo`. No se derivan de `globalRoles`: un profesor sin membresía no obtiene datos del grupo, y un líder no recibe permisos globales. La moderación de sugerencias y la edición del catálogo requieren simultáneamente el rol global `administrator` y el permiso global `account:manage`, presentes en el contrato actual de Identidad.

| Perfil | Acceso de Comunidad |
|---|---|
| Visitante | Consulta catálogo de reservas; no lee ni escribe grupos, sugerencias o reservas personales |
| Participante | Crea grupos, administra solo los grupos donde es líder, consulta los grupos donde tiene membresía activa y tramita sus propias sugerencias/reservas |
| Profesor/líder | El rol global profesor por sí solo no añade acceso; la función `leader` solo da gestión en su grupo |
| Administrador global | Modera sugerencias y activa/desactiva catálogo; no obtiene membresía ni acceso implícito a grupos privados |

## Persistencia y límites

La migración `003_community_workflows.sql` es aditiva. Mantiene los UUID opacos de cuenta y espacio sin FK entre servicios. Añade versiones para sugerencias y reservas, índices de paginación y una tabla local de idempotencia para crear grupos, sugerencias y reservas. No se modifican las migraciones aplicadas 001/002. El historial de sugerencias conserva los cambios de moderación; no se eliminan grupos, invitaciones, sugerencias ni reservas físicamente por las operaciones de usuario.

Las invitaciones guardan solo SHA-256 del token aleatorio, expiran a los siete días, se bloquean durante la aceptación y se consumen atómicamente. Una repetición del mismo token por la misma cuenta devuelve la misma aceptación; otra cuenta no lo puede reutilizar. Las invitaciones direccionadas comparan el correo normalizado.

Una sugerencia anónima siempre guarda `autor_id`, pero las respuestas de creación, listado, detalle e historial no exponen su autor. El acceso del autor a su propia sugerencia se valida internamente en la consulta; moderadores pueden ver el contenido para tramitarlo sin recibir la identidad anónima. Las transiciones son `received → reviewing → accepted → implemented`, con rechazo desde `received`, `reviewing` o `accepted`; las filas de historial se escriben en la misma transacción y la versión esperada evita sobrescrituras.

Los cinco servicios `advice`, `workshop`, `health`, `visit` y `culture` conservan sus contextos existentes. La fecha y hora se mantienen como hora local de Bogotá, según el modelo actual sin columna de zona horaria. Se rechaza una fecha pasada, una hora pasada para el día actual y un duplicado confirmado para el mismo espacio, servicio, fecha y hora. Las reservas canceladas permanecen como historial y liberan el índice único parcial. La creación requiere `Idempotency-Key`; una clave repetida con el mismo cuerpo devuelve el resultado y una clave con cuerpo distinto produce `IDEMPOTENCY_KEY_REUSED`. Las ediciones y cancelaciones requieren `If-Match` con la versión actual y solo el creador puede acceder al recurso.

Para compartir o reservar un espacio, Comunidad llama `POST /internal/v1/workspaces/authorize` de Aprendizaje con el token interno. Si Aprendizaje no responde, falla de forma cerrada (`DEPENDENCY_UNAVAILABLE`); si no reconoce al titular, devuelve no encontrado. No se consulta la base de Aprendizaje ni se crean FKs cruzadas. Comunidad conserva la concesión y revocación del espacio al grupo en su propia tabla.

Los límites transaccionales son locales: crear grupo y su liderazgo se confirman juntos; aceptar invitación consume el token y activa membresía en una transacción; actualizar sugerencia e insertar historial son atómicos; los índices únicos parciales de PostgreSQL arbitran dos reservas concurrentes. La autorización remota del espacio es una consulta sin mutación: si falla no se escribe en Comunidad; si la operación local falla no queda una modificación remota pendiente ni hace falta compensación.

## API inicial

Base: `/v1`. Especificación: `GET /openapi.json`.

| Área | Operaciones |
|---|---|
| Grupos | `GET/POST /groups`; `GET /groups/{id}/members`; crear, revocar y aceptar invitaciones; retirar participantes |
| Espacios compartidos | `GET /groups/{groupId}/workspaces`; `PUT/DELETE /groups/{groupId}/workspaces/{workspaceId}` |
| Sugerencias | `POST/GET /suggestions`; `GET /suggestions/{id}` y `/history`; `PATCH /suggestions/{id}` para moderación |
| Catálogo | `GET /reservation-services`; `PATCH /reservation-services/{code}` para activar o desactivar |
| Reservas | `GET/POST /reservations`; `PATCH /reservations/{id}`; `POST /reservations/{id}/cancellation` |
| Contrato interno | `GET /internal/v1/groups/{groupId}/members/{accountId}` para Aprendizaje |

Listados usan `limit` (1–100, predeterminado 25), `offset` y `total`. Errores mantienen `{code, requestId}` con códigos estables. La API usa cookies seguras de sesión de Identidad; el token de acceso no se copia a `localStorage`.

## Verificación y operación

Las pruebas unitarias cubren reglas de fecha/hora y transiciones. La integración PostgreSQL verifica liderazgo local, acceso entre grupos, destinatario/expiración/reutilización de invitaciones, anonimato conservado, concurrencia de historial, idempotencia, autorización del titular del espacio y duplicados concurrentes de reserva. Las pruebas de contrato inspeccionan rutas, seguridad, paginación y errores OpenAPI.

Para aplicar la migración al DB local: `npm run db:migrate`. Para probar integración: en PowerShell, ` $env:TEST_POSTGRES='1'; npm test -- services/comunidad/tests`. Para abrir la API en Swagger JSON use `http://localhost:3003/openapi.json` una vez reconstruido/arrancado el servicio. La configuración en contenedor debe dirigir `LEARNING_BASE_URL` a `http://aprendizaje:3002`.

Esta iteración no reconstruye ni reinicia contenedores y no cambia el frontend. Un despliegue local debe aplicar migraciones antes de arrancar una imagen que incluya estos binarios.

## Pendientes explícitos

- Definir si los miembros de un grupo deben reservar espacios compartidos además del titular. El contrato actual de Aprendizaje solo confirma propiedad individual, por lo que Comunidad falla de forma cerrada para cuentas que no sean titulares.
- Definir retención/limpieza para `community.write_idempotency` y política de conservación del historial.
- Si se amplía el servicio de catálogo, acordar cómo traducir las etiquetas visibles para los seis idiomas; esta API guarda el código/etiqueta y el frontend conserva su localización.
- Verificar en entorno de ejecución la conectividad entre contenedores al contrato interno de Aprendizaje y la política de clave compartida.
