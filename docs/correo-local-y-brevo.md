# Correo de registro en desarrollo y Brevo

## Prueba local con Mailpit

El entorno de desarrollo entrega los mensajes a Mailpit, dentro de la red privada de Docker. No se envían correos a Internet. La aplicación abre Mailpit desde el enlace **Abrir Mailpit** que aparece después de solicitar registro, verificación o recuperación.

Desde PowerShell, en la carpeta del backend:

```powershell
Copy-Item .env.example .env
# Ajusta en .env las contraseñas locales si ya tienes una base inicializada.
docker compose up -d --build
docker compose ps
```

Abre `http://127.0.0.1:8025` para consultar los mensajes locales. El puerto SMTP 1025 solo se expone dentro de Docker; la interfaz web de Mailpit queda ligada a `127.0.0.1`. El almacenamiento de Mailpit usa el volumen local `hci_mailpit_data`.

Si ya existe un `.env`, conserva las claves de PostgreSQL y agrega o revisa solamente estos valores:

```dotenv
IDENTITY_MAIL_TRANSPORT=smtp
IDENTITY_SMTP_URL=smtp://mailpit:1025
IDENTITY_SMTP_FROM="HCI Lab IA <lab@hci.local>"
IDENTITY_WEB_BASE_URL=http://127.0.0.1:5173/hci-lab-ia/
```

El frontend detecta Mailpit mediante `GET /v1/auth-options`; no consulta el buzón temporal en memoria y muestra un enlace a la bandeja local. Usa una dirección de prueba bajo `example.invalid` para los flujos de integración. El mensaje de Mailpit contiene un enlace de verificación de un solo uso y vencimiento.

## Configurar Brevo cuando exista una cuenta

Esta configuración queda preparada, pero el envío externo no se puede comprobar hasta que exista una cuenta de Brevo con remitente verificado y una clave SMTP. En Brevo, verifica un remitente o dominio, genera una **SMTP key** (no una API key) y configura el host `smtp-relay.brevo.com` por el puerto 587. La guía oficial documenta la integración SMTP y los datos de conexión: [SMTP integration](https://developers.brevo.com/docs/smtp-integration).

Guarda los datos solo en `.env` local o en el gestor de secretos del entorno de despliegue; no los compartas en el chat ni los subas a Git:

```dotenv
IDENTIDAD_NODE_ENV=development
IDENTITY_MAIL_TRANSPORT=smtp
IDENTITY_SMTP_URL=smtp://SMTP_LOGIN:SMTP_KEY@smtp-relay.brevo.com:587
IDENTITY_SMTP_FROM="HCI Lab IA <remitente-verificado@tu-dominio.example>"
IDENTITY_WEB_BASE_URL=https://tu-frontend.example/hci-lab-ia/
```

`SMTP_LOGIN`, `SMTP_KEY` y el remitente son marcadores; reemplázalos localmente. Confirma que el remitente está verificado y después reinicia solo el servicio de Identidad con `docker compose up -d --build identidad`. La cuenta gratuita de Brevo publica un límite diario que puede cambiar; revisa el [plan vigente](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans) antes de usarlo. No se declara entrega real hasta probar un mensaje en una dirección controlada.

En producción, usa HTTPS, cookies Secure, un origen web HTTPS, remitente válido y secretos inyectados fuera del repositorio. La configuración rechaza Mailpit y los remitentes `.local` en producción.

## Comprobación rápida

```powershell
docker compose ps
Invoke-RestMethod http://127.0.0.1:3001/v1/auth-options
```

En desarrollo local la respuesta debe declarar `smtp_local` y mostrar la URL local de Mailpit. Si devuelve `smtp`, el servicio no está usando el host local de Mailpit; si devuelve `local`, el transporte SMTP no se configuró. Ninguna respuesta expone usuario ni clave SMTP.
