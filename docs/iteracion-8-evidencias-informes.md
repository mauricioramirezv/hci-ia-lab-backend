# Iteración 8 — Evidencias e informes

La base del servicio Evidencias sigue siendo propietaria de sus tablas `evidence.*`. La migración `003_evidence_workflows.sql` es aditiva: añade la clave de idempotencia e índices de acceso, sin cambiar las migraciones 001/002 aplicadas ni añadir claves foráneas a Identidad, Aprendizaje o Comunidad.

## Datos y privacidad

- Los visitantes continúan trabajando localmente. Todas las escrituras REST requieren una sesión activa de Identidad, protección CSRF y autorización de propiedad en Aprendizaje o Evidencias.
- Una sesión sincronizada guarda métricas agregadas, tiempos de exposición por banda si se proporcionan y consentimiento `aggregate_metrics`. No se envían eventos desde segundo plano: los eventos detallados solo se aceptan por la API explícita y mientras exista consentimiento `detailed_telemetry` vigente.
- La calibración guarda únicamente error mediano, dimensiones, cantidad de muestras y fecha; nunca imágenes, fotogramas o video de cámara. Los eventos UX son puntos resumidos enviados explícitamente y tienen un máximo de 500 por lote.
- El almacenamiento de archivos queda fuera de esta iteración. El endpoint registra metadatos y una clave relativa de almacenamiento bajo el prefijo de cuenta y ejecución; no recibe contenido binario. Rechaza MIME/extensiones de video y no acepta URLs.
- `EVIDENCE_RETENTION_DAYS` vale 30 por defecto y acepta de 30 a 36500 días. Evidencias limpia al arrancar y cada 24 horas; el endpoint interno `POST /internal/v1/retention/sweep` permite un barrido manual con `x-identity-internal-token`. El barrido elimina registros vencidos de Evidencias no referenciados por informes, respuestas idempotentes, inbox procesados y proyecciones. Conserva mensajes outbox no entregados. No borra objetos binarios externos; en este diseño solo se guardan metadatos.

## Contratos principales

La API está disponible bajo `/v1` y en `/openapi.json`. Las escrituras de sesión, consentimiento, eventos, calibración, verificación, metadatos e informe requieren `Idempotency-Key`; las mutaciones desde navegador requieren cookie de sesión y `X-CSRF-Token`.

- `POST /v1/ux-sessions`, `GET /v1/ux-sessions/{id}`, `GET /v1/ux-sessions/{id}/events?limit=100&offset=0`
- `GET|POST /v1/ux-sessions/{id}/consents`, `DELETE /v1/ux-sessions/{id}/consents/{purpose}`; permanece la ruta de revocación total para compatibilidad.
- `POST /v1/ux-sessions/{id}/events`, `PUT /v1/ux-sessions/{id}/calibration`
- `GET /v1/workspaces/{workspaceId}/accessibility-checks`, `PUT /v1/workspaces/{workspaceId}/accessibility-checks/{code}`; códigos `keyboard`, `labels`, `contrast`, `zoom`, `screenReader`, `motion`.
- `POST|GET /v1/executions/{executionId}/files`, `DELETE /v1/files/{id}`. El borrado marca los metadatos como eliminados.
- `POST /v1/reports`, `GET /v1/reports/{id}`. Los informes guardan selecciones tipadas con las secciones `selected`, `before` y `after`. `executionIds` se mantiene como entrada compatible y se transforma a registros `execution`.

La selección de fuentes usa contratos internos autenticados: Aprendizaje valida ejecuciones, personas, escenarios, hallazgos, sesiones de evaluación, usuarios demo y resultados multimodales en `/internal/v1/report-records/authorize`; Comunidad valida reservas en `/internal/v1/reservations/authorize`. Evidencias valida sus propias sesiones, archivos, eventos y verificaciones en su base. No se consultan tablas ajenas ni se crean FK cruzadas. Como no existe transacción distribuida, los permisos externos se verifican antes de guardar la definición; se debe reintentar ante fallos de dependencia y volver a validar al generar/exportar el informe en una iteración posterior.

## Códigos estables añadidos

`IDEMPOTENCY_KEY_REUSED` (409) indica que se reutilizó una clave con contenido distinto; `RETENTION_DISABLED` (409) indica que el barrido no está configurado. Se conservan `CONSENT_REQUIRED`, `NOT_FOUND`, `INVALID_INPUT` y `DEPENDENCY_UNAVAILABLE`.

## Revisión manual

1. Aplicar migraciones en una base vacía y en `evidence_db` existente; confirmar que 001/002 conservan sus checksums y aparece 003.
2. Crear una sesión con consentimiento agregado; confirmar que no aparecen eventos UX.
3. Sin consentimiento detallado, intentar enviar puntos y una calibración; confirmar `CONSENT_REQUIRED`. Otorgar consentimientos separados, repetir y comprobar que solo se persisten los agregados definidos; revocar y comprobar que nuevos puntos se rechazan.
4. Enviar `video/mp4` o un nombre `.webm` a metadatos; confirmar `INVALID_INPUT`. Un archivo aceptado debe guardar solamente nombre, tipo, bytes, SHA-256 y clave externa.
5. Guardar un informe que combine fuentes propias y externas; confirmar que IDs de otro propietario no se incluyen y que se preservan sección y tipo.
6. Dejar `EVIDENCE_RETENTION_DAYS` vacío y verificar el valor por defecto de 30 días. Confirmar que 29 se rechaza y que un barrido elimina solo datos sintéticos más antiguos que el corte, conservando elementos recientes y outbox pendiente.

## Pendientes de operación

La configuración del bucket/proveedor de archivos y su política de borrado no está incluida. Tampoco se conecta el frontend a estos endpoints en esta iteración; por ello no se declara sincronización remota funcional ni telemetría remota habilitada. La planificación real del barrido debe ajustarse a la política institucional cuando exista.
