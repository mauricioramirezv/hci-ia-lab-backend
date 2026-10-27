# Iteración 2 — infraestructura ejecutable

Esta página describe la base técnica inicial. Su estado vigente incluye las migraciones del MER v2.1 y las APIs centrales detalladas en Implementación MER v2.1. Las notas que marcaban el MER como pendiente son históricas y quedan reemplazadas por esa matriz.

## Herramientas y compatibilidad

Node.js 22–24 (el paquete declara >=22 y <25), TypeScript 5.8, Fastify 5, PostgreSQL 17, pg, Vitest 5 y Docker Compose. Las versiones se fijan en package-lock.json. npm workspaces compone los cuatro proyectos; las bases de datos se mantienen separadas.

## Instalación desde cero en PowerShell

Requisitos: Node.js compatible, npm y Docker Desktop con motor Linux iniciado.

1. Abrir PowerShell en C:\Users\gramirez\Downloads\HCI-IA-LAB-Backend.
2. Copiar .env.example a .env y reemplazar los valores local_only_change_me por secretos locales aleatorios. No guardar .env en Git.
3. Ejecutar npm ci.
4. Iniciar PostgreSQL para desarrollo con docker compose up -d postgres.
5. Crear roles y bases por propietario con npm run db:provision.
6. Aplicar migraciones con npm run db:migrate.
7. Revisar capas y código con npm run lint; compilar con npm run build; para pruebas de integración PostgreSQL, definir $env:TEST_POSTGRES = "1" y ejecutar npm test.
8. Iniciar los servicios con docker compose up --build -d y verificar docker compose ps.

Puertos locales: Identidad 3001, Aprendizaje 3002, Comunidad 3003 y Evidencias 3004, enlazados a loopback. Cada servicio expone /health/live, /health/ready y /openapi.json. Readiness comprueba su propia base; no reemplaza monitoreo de dependencias remotas.

Para detener contenedores manteniendo datos: docker compose down. docker compose down -v elimina el volumen PostgreSQL local y sus datos; usar solo si se desea reiniciar el entorno.

## Migraciones y validación

npm run db:migrate valida el checksum de migraciones aplicadas y no reemplaza cambios previos. En CI se inicia PostgreSQL temporal, se provisionan propietarios/runtime y se ejecutan migraciones, lint, compilación y pruebas. Las migraciones actuales de dominio se derivaron del MER por servicio. El DDL consolidado con referencias entre dominios no se ejecuta como una única base física.

## Pendientes de infraestructura

La configuración real de SMTP, secretos gestionados, TLS de base, observabilidad distribuida y credenciales internas distintas por servicio deben definirse por entorno. El correo SMTP real no está verificado. No se despliega desde esta iteración.