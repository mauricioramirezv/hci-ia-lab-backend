# Iteración 5 — Aprendizaje: espacios y actividades

Aprendizaje ofrece catálogos publicados por locale, espacios privados de cuenta, personas y escenarios, ejecuciones y resultados tipados. La migración 004 es aditiva; las migraciones 001–003 no se modifican. Los recibos de idempotencia son almacenamiento operativo del servicio, no una tabla lógica adicional del MER.

## API y acceso

- Los visitantes pueden consultar el catálogo publicado. No pueden crear espacios ni generan filas en PostgreSQL.
- Solo una sesión de cuenta activa permite escrituras. Cada lectura o escritura de persona, escenario y resultado comprueba que la cuenta sea propietaria activa del espacio. En esta iteración el espacio es privado para su propietario; compartirlo con grupo requiere la operación de Comunidad aún pendiente.
- POST /v1/workspaces crea espacios con Idempotency-Key; las escrituras de personas, escenarios y resultados también exigen una clave UUID. Una clave repetida con el mismo cuerpo devuelve la operación original (200); otra carga devuelve IDEMPOTENCY_KEY_REUSED (409).
- Las ejecuciones conservan el activity_version_id seleccionado y la condition del experimento. Las definiciones métricas de esa versión fijan tipo, unidad, fórmula y formula_version; no se altera una definición al registrar resultados.
- El registro final de resultados exige expectedVersion y cambia la ejecución de in_progress a completed (o cancelled para una actividad de concepto cancelada) dentro de la misma transacción que guarda métricas y resultado especializado.

## Datos del frontend

La API conserva los campos de persona (edad como texto, empatía en cuatro campos, base observada/asumida/mixta, observación, supuestos y fuente de emoción) y escenario (actor, contexto, tarea, restricción, criterio de éxito, asociación opcional a persona y marca ficticia). No deduce características personales ni enlaza un escenario a una persona fuera del mismo espacio.

Los resultados de concepto y las observaciones de patrón se almacenan en sus tablas especializadas. Métricas aceptan un solo valor numérico, textual o booleano por definición y repetición. Fitts y Hick guardan ocho mediciones; las dos prácticas quedan locales y no se convierten en resultados. Para Fitts se conservan distancia e índice de dificultad recibidos como métricas tipadas. El frontend no persiste ancho de objetivo para cada intento, por ello no se fabrica ni almacena ese valor. Para Hick se permite registrar option_count como métrica cuando la actividad lo define; no se estiman coeficientes a ni b.

La versión de fórmula de Fitts queda publicada en la definición de métrica enlazada a la versión de actividad. Recalcular el índice más adelante requiere conservar el ancho original, dato que no existe en el respaldo 2.5.0; por ahora el valor registrado es la fuente de ese resultado. Completar una actividad no crea una evaluación de aprendizaje. No se almacena video ni telemetría de cámara.

## Operaciones y fallos

Las escrituras de espacio, persona, escenario y resultado son transaccionales. Las restricciones únicas de PostgreSQL y el bloqueo de la ejecución evitan registros repetidos y resultados concurrentes. La finalización usa control optimista (expectedVersion); una versión antigua produce VERSION_CONFLICT (409). Los recibos y los datos se confirman en la misma transacción, por lo que un fallo antes del COMMIT deja ambos sin efecto. El catálogo no tiene dependencias entre servicios. Aprendizaje valida la sesión con Identidad en cada solicitud y no consulta sus tablas ni las de Comunidad.

## Revisión manual

1. Aplicar npm run db:migrate y arrancar los servicios con docker compose up -d --build.
2. Consultar GET /openapi.json y GET /v1/catalog/activities?locale=es-CO.
3. Con sesión y CSRF válidos, crear espacio, persona y escenario usando claves idempotentes UUID distintas; repetir la misma petición y confirmar respuesta idempotente.
4. Crear una ejecución publicada y enviar sus métricas/resultados con expectedVersion: 1; repetir exactamente la clave y comprobar que el estado no duplica valores.
5. Intentar usar espacio y ejecución con otra cuenta: deben devolver NOT_FOUND. Probar una versión antigua: debe devolver VERSION_CONFLICT.

## Límites

El catálogo inicial de seis locales es semilla técnica para conceptos, patrones y experimentos Fitts/Hick, no aprobación editorial del contenido del curso. El frontend continúa guardando visitantes y borradores localmente; la sincronización de esos respaldos requiere un trabajo posterior de integración. No hay permisos compartidos de grupo para espacios ni sincronización de borradores parciales en esta iteración.
