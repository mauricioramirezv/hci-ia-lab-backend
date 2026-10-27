# Iteración 3 — Identidad y acceso

Actualización alineada al MER v2.1: las cuentas reales tienen roles globales participant, teacher, evaluator y administrator. La función leader corresponde a membresía local de Comunidad. Para la matriz completa, APIs del resto de servicios y pendientes, consultar Implementación MER v2.1.

Esta iteración agrega cuentas reales opcionales. El laboratorio y el CRUD didáctico siguen disponibles sin cuenta; usuarios ficticios y sus roles didácticos no se usan como identidades ni permisos del backend.

## Alcance implementado

- Registro con correo recortado, normalizado Unicode NFKC y minúsculas, clave única sobre email_normalized y respuesta 202 genérica. Las cuentas nuevas requieren verificación.
- Verificación y recuperación mediante tokens aleatorios de 256 bits. PostgreSQL guarda SHA-256, vencimiento y consumo atómico. Verificación vence en 24 horas; recuperación en 30 minutos; una solicitud nueva invalida tokens de recuperación anteriores.
- Contraseñas con scrypt N=2^17, r=8, p=1, sal aleatoria y 64 bytes de salida. Los accesos inexistentes también derivan una contraseña para reducir diferencias de tiempo.
- Sesión aleatoria opaca de 256 bits: se guarda su hash, vencimiento, última actividad y revocación. El navegador recibe cookie HttpOnly; no se persiste el token en localStorage ni sessionStorage. La cookie CSRF legible por JavaScript se compara con X-CSRF-Token y su hash persistido. Se valida Origin cuando está presente.
- Perfil propio con versión optimista. El cuerpo no acepta identificadores ni roles; la cuenta sale de la sesión.
- Administración global de cuentas y roles participant, teacher, evaluator y administrator. Solo administrator administra cuentas y asigna roles globales. No convierte un profesor/evaluador en administrador. leader es una función por grupo, no un rol global. La última cuenta administrator activa no puede desactivarse ni degradarse.
- Migraciones 002_accounts.sql, 003_identity_rbac.sql y 004_account_name_mer_alignment.sql. Las migraciones posteriores son aditivas: conserva cuentas, sesiones, hashes y tokens previos, convierte platform_role a account_roles y deriva pending/active/inactive.
- CORS por origen explícito, credenciales habilitadas, límite de solicitudes por proceso y límites menores para registro, inicio de sesión y recuperación. El contenedor local enlaza puertos a loopback.
- Frontend opcional en /cuenta con alta, inicio/cierre, verificación, recuperación, edición del nombre y gestión de cuentas para administrador. Textos en es-CO, en-US, pt-BR, fr-FR, it-IT y ca-ES. El acceso público no requiere inicio de sesión.

## Persistencia y permisos

identity.accounts, roles, permissions, account_roles y role_permissions son propiedad de Identidad. La relación cuenta-rol asigna permisos globales. teacher o evaluator no implican administrator. community.membership conserva la función leader/participant y aplica únicamente dentro de su grupo; un teacher global no obtiene acceso al grupo sin membresía activa.

Las sesiones y tokens tienen FK local a cuentas. Desactivar conserva la cuenta y revoca sesiones. No existen FKs a tablas de otros servicios. Las versiones evitan sobrescrituras de perfil y administración. Las fechas se generan en PostgreSQL.

## Contratos REST

| Operación | Permiso | Resultado |
|---|---|---|
| POST /v1/accounts | Público | 202 genérico; inicia verificación si se crea |
| POST /v1/email-verifications | Token de un uso | Verifica cuenta |
| POST /v1/sessions | Público | 200, sesión en cookie HttpOnly y cuenta mínima |
| GET /v1/accounts/me | Sesión | Perfil de sesión |
| PATCH /v1/accounts/me | Sesión + CSRF | Cambia nombre con version |
| DELETE /v1/sessions/current | Sesión + CSRF | Revoca sesión y borra cookies |
| POST /v1/password-resets | Público | 202 genérico para cuenta existente o inexistente |
| POST /v1/password-resets/complete | Token de un uso | Cambia clave e invalida sesiones anteriores |
| GET /v1/admin/accounts | Administrator global | Lista paginada |
| PATCH /v1/admin/accounts/{id} | Administrator global + CSRF | Cambia estado o rol con control de versión |

OpenAPI está en /openapi.json. Errores usan códigos estables con requestId. Registro y recuperación no revelan si existe una cuenta.

## Transiciones de estado

La verificaciÃ³n de un token pendiente es la Ãºnica operaciÃ³n que lleva `pending` a `active`. AdministraciÃ³n puede pasar `pending` a `inactive` o `locked`; `active` a `inactive` o `locked`; `inactive` a `locked` o volver a `active` si el correo ya fue verificado; y `locked` a `inactive` o a `active` si el correo ya fue verificado. Los cambios de rol conservan el estado cuando este no cambia. Todo otro salto devuelve `INVALID_STATUS_TRANSITION`; activar sin correo verificado devuelve `EMAIL_NOT_VERIFIED`. No se aplica bloqueo automÃ¡tico porque no existe una polÃ­tica institucional de intentos/bloqueo acordada.

## Correo

### Reenvio de verificaciÃ³n durante el registro

El endpoint de registro conserva la respuesta genÃ©rica y el lÃ­mite de intentos. Si el correo normalizado ya pertenece a una cuenta pendiente, solicita un enlace de verificaciÃ³n nuevo e invalida el anterior; si la cuenta ya estÃ¡ activa, no envÃ­a correo. En desarrollo, el mensaje SMTP local se consulta en Mailpit. Si no aparece un mensaje, el usuario puede reenviar el enlace desde Cuenta o usar recuperaciÃ³n de contraseÃ±a para una cuenta existente.

El adaptador de desarrollo escribe mensajes en una bandeja local protegida para pruebas. Producción puede configurarse mediante IDENTITY_SMTP_URL e IDENTITY_SMTP_FROM desde variables seguras. No se ha configurado ni probado entrega SMTP real; falta elegir proveedor, credenciales, dominio remitente, SPF/DKIM/DMARC y prueba de entrega. No guardar credenciales en Git.

## Verificación

Las pruebas cubren registro duplicado, tokens vencidos y reutilizados, recuperación, desactivación, cierre de sesión, escalamiento de privilegios y acceso a recursos ajenos. Las pruebas de producción de correo siguen pendientes. Para el estado de pruebas y ejecución del resto del backend, consultar docs/implementacion-mer-v2.1.md.
