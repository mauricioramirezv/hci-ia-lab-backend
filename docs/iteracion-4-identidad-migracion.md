# Iteración 4 — Identidad y migración compatible

## Inspección inicial

El frontend está en main, versión 2.5.0, con cambios locales en .env.example, App.tsx, i18n.ts, src/features/identity/, tests/unit/identityClient.test.ts y docs/backend-model/. Se conservaron sin modificación. El backend hermano no contiene metadatos Git, por lo que no tiene rama ni estado Git que informar.

La base local identidad estaba en identity_db con 001_service_metadata.sql, 002_accounts.sql y 003_identity_rbac.sql aplicadas. Antes del cambio registraba cero cuentas, sesiones, tokens y relaciones cuenta-rol. No se usó esa base vacía como sustituto de la prueba de actualización con datos; dicha prueba crea bases temporales únicas.

## Cambios

- Nueva migración aditiva 004_account_name_mer_alignment.sql: añade name, copia display_name sin inferir apellido, mantiene la columna previa por compatibilidad y sincroniza ambas columnas con trigger y CHECK.
- La aplicación lee name como atributo vigente del MER y escribe de forma compatible en name/display_name al registrar y editar perfil. La API conserva displayName para no romper clientes existentes.
- El migrador ahora comparte una función transaccional y verificadora de checksum, con opción de aplicar hasta una migración para construir el escenario legacy en pruebas. El comando habitual continúa aplicando todas en orden.
- Pruebas de integración crean bases efímeras aisladas: instalación limpia con 001–004 y actualización desde 001–002 con cuentas activas, inactivas y pendientes, hashes de contraseña, sesiones activas/revocadas y tokens sin consumir/consumidos. Comprueban roles, estados, nombre, conservación de filas y repetición idempotente de migraciones.
- Las migraciones 001–003 no se editaron. El DDL consolidado se usó como fuente lógica; no se ejecutó como una sola base porque incluye relaciones entre propietarios.

## Verificación y revisión manual

Ejecutar desde HCI-IA-LAB-Backend en PowerShell: npm run lint; npm run build; definir $env:TEST_POSTGRES = "1"; ejecutar npm test -- --reporter=dot; npm run db:migrate.

Las pruebas de migración requieren PostgreSQL temporal, POSTGRES_BOOTSTRAP_USER/PASSWORD y los roles de servicio aprovisionados. Revisar identity.accounts.name, comparar con display_name y comprobar que last_name permanezca NULL para cuentas legacy.

## Limitaciones

El DDL físico de Identidad sigue usando nombres en inglés por compatibilidad con 001/002; name representa CUENTA.nombre y display_name permanece como alias legacy. No se renombraron ni eliminaron campos aplicados. La base local previa no tenía cuentas/sesiones/tokens, por lo que la conservación con filas se valida con datos ficticios en bases temporales.