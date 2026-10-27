# Iteración 6 — Aprendizaje: cursos y evaluación

Aprendizaje expone asignaciones con criterios, sesiones de evaluación, instrumentos y heurísticas versionados, hallazgos, entregas con historial, valoraciones, retroalimentación y usuarios ficticios. Los cambios quedan dentro del servicio Aprendizaje; no se consultan tablas de Identidad ni Comunidad.

## Contratos

- GET /v1/instruments?locale=es-CO&type=SUS|NASA_TLX|custom lista cada versión y sus ítems. GET /v1/heuristics?locale=es-CO lista las diez heurísticas versionadas. Ambos catálogos son públicos y existen en los seis locales del frontend 2.5.0.
- POST /v1/workspaces/{workspaceId}/evaluation-sessions inicia una sesión. Solo admite una cuenta activa y un espacio propio activo. Si se informa executionId, debe pertenecer a esa cuenta y espacio. Las sesiones SUS y NASA_TLX deben conservar el instrumento/version seleccionados.
- POST /v1/evaluation-sessions/{id}/responses guarda el conjunto completo de respuestas y finaliza la sesión en una transacción. No admite cambios posteriores; la clave idempotente permite repetir de forma segura la misma petición.
- GET /v1/workspaces/{workspaceId}/evaluation-sessions y GET /v1/evaluation-sessions/{id} consultan historial solo para la cuenta propietaria.
- POST /v1/workspaces/{workspaceId}/heuristic-findings crea un hallazgo humano o una propuesta de IA revisada. Conserva la etiqueta histórica de la heurística aunque se catalogue por ID. PATCH /v1/heuristic-findings/{id}/state aplica revisión optimista de estado.
- POST, GET y PATCH en /v1/demo-users administran datos ficticios aislados por creador. Nunca crean una cuenta, sesión de identidad ni credencial.
- GET /v1/executions/{id}/deliveries expone el historial de versiones al propietario. GET /v1/groups/{groupId}/deliveries lo expone a una membresía de liderazgo activa.

Las escrituras requieren cookie de sesión, protección CSRF y origen permitido por CORS. Las creaciones repetibles requieren Idempotency-Key UUID. Los listados usan limit y offset, con máximo de 100. Los errores mantienen códigos estables: INVALID_INPUT, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, STATE_CONFLICT, VERSION_CONFLICT, IDEMPOTENCY_KEY_REUSED y DEPENDENCY_UNAVAILABLE.

## Fórmulas conservadas

SUS-5PT-1.0 usa diez respuestas de 1 a 5. Para ítems impares suma respuesta menos uno; para pares suma cinco menos respuesta; multiplica el total por 2,5. El resultado va de 0 a 100.

RAW-TLX-MEAN-1.0 usa las seis respuestas Raw TLX del frontend, cada una de 0 a 100, y calcula el promedio simple. No es el NASA-TLX ponderado: el frontend no registra las comparaciones por pares necesarias para obtener sus pesos. Los resultados devuelven el código y la versión de fórmula vinculados al instrumento versionado. No se persiste una puntuación derivada por separado.

Los instrumentos tienen versiones iniciales en español, inglés, portugués, francés, italiano y catalán, reutilizando los textos existentes del frontend. Los cambios de cuestionario o fórmula deben crear una versión nueva; no se deben editar las versiones históricas.

## Propiedad, concurrencia y fallos

Los grupos siguen siendo propiedad de Comunidad. Aprendizaje conserva únicamente el UUID opaco en la asignación y consulta el contrato interno de membresía para autorizar liderazgo o participación; una indisponibilidad del contrato falla cerrada. El liderazgo de grupo no necesita ni concede un rol global, y un administrador global sin membresía no obtiene acceso automático al grupo.

La creación de una asignación y sus criterios es atómica. El envío de respuestas, su recibo idempotente y el cierre de sesión comparten una transacción; un error deja la sesión abierta y sin respuestas parciales. Un bloqueo de fila permite un solo cierre. El historial de entregas asigna el número bajo bloqueo de la ejecución; el índice único mantiene la secuencia. La valoración mantiene su unicidad por entrega, criterio y evaluador; si dos peticiones compiten, solo una se confirma. La retroalimentación de revisión se confirma junto con el cambio de estado.

La migración 005 es posterior y aditiva. Añade índices de lectura y carga catálogos iniciales idempotentes; las migraciones 001–004 no se modifican. No introduce claves foráneas entre servicios. Los grupos y cuentas se validan mediante contratos y sesión de Identidad. La retención, anonimización y eliminación de datos siguen la decisión institucional pendiente descrita en el MER.

## Revisión manual

1. Desde la raíz del backend, ejecutar npm run db:migrate y comprobar que 005 se registra aplicada una sola vez.
2. Consultar GET /v1/instruments?locale=es-CO y GET /v1/heuristics?locale=ca-ES; confirmar diez heurísticas, diez ítems SUS y seis ítems Raw TLX por instrumento.
3. Con cookie y CSRF de una cuenta activa, crear una sesión SUS dentro de un espacio propio; enviar diez respuestas válidas con Idempotency-Key y revisar el resultado y la fórmula.
4. Repetir la petición exacta: debe devolver la sesión existente. Cambiar el cuerpo con la misma clave debe dar IDEMPOTENCY_KEY_REUSED. Enviar otro conjunto tras finalizar debe dar STATE_CONFLICT.
5. Crear un hallazgo con heuristicVersionId y verificar que su etiqueta queda guardada. Intentar leerlo con otra cuenta: debe dar NOT_FOUND.
6. Crear y desactivar un usuario ficticio. Verificar que otra cuenta no lo lista y que no existe una cuenta equivalente en Identidad.
7. Crear varias entregas de una ejecución; consultar su historial y probar envíos concurrentes. Solo deben aparecer versiones distintas sin sobrescritura. Una membresía que no sea líder no puede consultar entregas del grupo ni valorar.

## Pendientes

El backend entrega contratos independientes y no modifica la interfaz del frontend en esta iteración. Los informes agregados y su proyección entre servicios quedan fuera de alcance. Los instrumentos custom se conservan como metadatos; no reciben un cálculo automático. RAW TLX queda explícitamente diferenciado de la variante ponderada.
