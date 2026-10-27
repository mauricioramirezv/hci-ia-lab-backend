# HCI Lab + IA — Backend

Backend independiente del frontend, organizado en cuatro servicios propietarios de sus datos: Identidad, Aprendizaje, Comunidad y Evidencias. El MER lógico v2.1 está incorporado en docs/modelo-backend; las migraciones físicas separan las entidades por servicio y no copian sus claves foráneas entre bases.

- [Estado de implementación y matriz MER ↔ servicios](docs/implementacion-mer-v2.1.md)
- [Arquitectura actual](docs/arquitectura.md)
- [Diseño inicial de iteración 1 (histórico)](docs/diseno-iteracion-1.md)
- [Infraestructura e instalación local](docs/iteracion-2.md)
- [Identidad y acceso](docs/iteracion-3-identidad.md)
- [Iteración 4: migración compatible de identidad](docs/iteracion-4-identidad-migracion.md)
- [MER v2.1 revisado](docs/modelo-backend/01-modelo-er.md)
- [DDL lógico consolidado de referencia](docs/modelo-backend/02-ddl-postgresql.sql)
- [Prompt recibido para el backend](docs/modelo-backend/03-prompt-codex-backend.txt)

La implementación materializa el esquema lógico en migraciones por servicio y cubre el flujo central de cuentas, trabajo, grupos, entregas, revisión y definiciones de informe. El catálogo de actividades y varios dominios del MER todavía requieren datos y casos de uso; el estado detallado está en la matriz. No se despliega desde este repositorio sin instrucción explícita.
La iteración 9 conecta el frontend mediante sincronización explícita. El contrato de sesión devuelve el valor anti-CSRF en JSON, conserva la cookie HttpOnly y genera enlaces compatibles con HashRouter/Pages. Véase la [guía de integración en el frontend hermano](../hci-lab-ia-repositorio/docs/integracion-backend.md) para configuración local, pruebas y límites. No se han actualizado los contenedores en ejecución ni configurado un proveedor SMTP real.
