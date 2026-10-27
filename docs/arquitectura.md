# Arquitectura actual del backend

## Límites de servicio

Cada servicio es un proceso TypeScript/Fastify desplegable por separado y propietario de su esquema PostgreSQL en una base dedicada en el entorno local. Puede compartir la instancia PostgreSQL; no comparte tablas, permisos de runtime ni transacciones.

| Servicio | Propiedad de datos | Contratos entre servicios |
|---|---|---|
| Identidad | Cuentas, estado, sesión, tokens de un uso, roles/permisos globales, preferencias y auditoría local | Introspección de sesión para los otros servicios |
| Aprendizaje | Espacios, catálogo versionado, asignaciones, ejecuciones, resultados, evaluación, entregas, personas/escenarios y usuarios ficticios | Consulta de membresía a Comunidad; ofrece autorización de propietario a Evidencias |
| Comunidad | Grupos, membresías locales, invitaciones, sugerencias e historial, servicios/reservas | Verificación interna de sesión de Identidad; ofrece membresía a Aprendizaje |
| Evidencias | Sesiones UX, consentimiento, evidencia, informes y fuentes seleccionadas | Verificación de sesión de Identidad y propiedad de ejecuciones/espacios en Aprendizaje |

El DDL consolidado del MER documenta relaciones lógicas. Las migraciones físicas mantienen claves foráneas solo dentro del mismo servicio. IDs como cuenta, grupo, espacio, asignación o entrega que cruzan límites se tratan como referencias opacas y se autorizan por contrato HTTP. No hay consultas a tablas ajenas.

## Capas y dependencias

Cada dominio organiza código en domain, application, infrastructure y presentation. Domain y application no importan Fastify ni PostgreSQL; presentation traduce HTTP y delega reglas; infrastructure contiene adaptadores PostgreSQL y clientes HTTP. El chequeo scripts/check-architecture.mjs forma parte de lint.

Identidad usa cookie de sesión HttpOnly y token CSRF para escrituras desde navegador. Los servicios consultan la sesión en Identidad; llamadas internas llevan un token compartido configurado fuera del código. CORS permite credenciales solo a orígenes explícitos. Cada petición expone X-Request-Id; errores tienen código estable y requestId.

Las operaciones entre servicios implementadas son síncronas: una falla de autenticación o autorización de propietario/membresía cancela la escritura dependiente y devuelve error de dependencia. No se usa transacción distribuida. Actualmente no hay outbox/inbox ni proyección asíncrona; reintentos durables y consistencia eventual quedan pendientes antes de añadir flujos que los requieran.

## Persistencia y cambios de esquema

El DDL de docs/modelo-backend/02-ddl-postgresql.sql es una referencia relacional consolidada, no una migración ejecutable sin transformación. Las migraciones 001 conservan metadatos, 002 materializan entidades locales del MER y las 003 de Identidad y Aprendizaje son aditivas. La migración 003 de Identidad conserva cuentas, hashes, tokens y sesiones existentes al asignar roles globales y derivar el estado de cuenta. No se editan migraciones ya aplicadas.

Cada servicio usa propietario NOLOGIN, migrador restringido y rol runtime con permisos locales. Las transacciones se ubican en adaptadores de persistencia; PostgreSQL impone restricciones, índices, unicidad y controles de concurrencia donde corresponden. Los detalles, endpoints y brechas están en docs/implementacion-mer-v2.1.md.

## Seguridad y privacidad

Visitantes consultan el catálogo público y ejecutan el laboratorio de forma local; no escriben trabajo en la API. Cuentas reales y usuarios ficticios permanecen separados. Finalizar una práctica no equivale a evaluar aprendizaje. Las entregas son versionadas. El seguimiento UX remoto guarda agregados con consentimiento; no escribe coordenadas/eventos detallados ni almacena video.

Desactivación y archivado preservan historial. Evidencias ejecuta limpieza automática al arrancar y cada 24 horas, con 30 días como mínimo configurable; las reglas específicas se documentan en `eventos-e-informes-remotos.md`.
