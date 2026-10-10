# Instalar Sheets Row Drawer en EasyPanel

Esta instalación repite el patrón usado por MinimalBuilder: dos servicios dentro del mismo proyecto de EasyPanel.

- Una instancia privada de MariaDB conserva cuentas, planes, pagos y workspaces.
- Una App de Node.js ejecuta la API y se publica en `https://abrircrm.com`.

La base de datos no necesita un puerto público. La App se conecta usando el **Internal Host** que muestra EasyPanel en las credenciales de MariaDB.

## 1. Preparar el dominio

En el proveedor DNS de `abrircrm.com`, crea o comprueba un registro `A` que apunte a la IP pública del servidor donde está EasyPanel. Si también usarás `www`, decide si tendrá otro registro o una redirección; la extensión se conecta directamente a `abrircrm.com`.

Espera a que el registro resuelva antes de solicitar el certificado HTTPS en EasyPanel.

## 2. Crear MariaDB

Dentro del mismo proyecto donde estará la App:

1. Pulsa **+ Service**.
2. Selecciona **MariaDB**.
3. Usa un nombre reconocible, por ejemplo `mariadbsheetsdrawer`.
4. Configura:
   - **User:** `sheetsdrawer`
   - **Database Name:** `sheetsdrawer`
   - **Password:** una contraseña larga y exclusiva.
   - **Root Password:** otra contraseña larga y exclusiva.
5. Crea el servicio y espera a que aparezca en verde.
6. Abre **Credentials** y conserva estos cuatro valores:
   - User
   - Password
   - Database Name
   - Internal Host

No habilites **Expose**. La conexión entre servicios usa la red interna de EasyPanel y el puerto `3306`.

Configura además una copia de seguridad programada de MariaDB desde **Backups** y realiza al menos una restauración de prueba antes de depender de ella en producción.

## 3. Crear la App

1. Pulsa **+ Service** y selecciona **App**.
2. Usa un nombre como `sheetsdrawer` o `abrircrm`.
3. En **Source**, selecciona **GitHub**.
4. Configura los mismos campos de tu captura:
   - **Owner:** `kerbolion`
   - **Repository:** `drawer`
   - **Branch:** `main`
   - **Build Path:** `/`
5. Guarda la sección **Source**.
6. En **Build**, elige **Dockerfile**.
7. Usa `/Dockerfile` en **File** y guarda la sección **Build**.

Esta configuración replica la de MinimalBuilder: repositorio completo como contexto y Dockerfile en la raíz. El Dockerfile instala solo las dependencias de producción de `server/` y ejecuta el backend como el usuario sin privilegios `node`.

## 4. Variables de entorno

En **Environment Variables** pega lo siguiente y sustituye todos los valores marcados:

```dotenv
NODE_ENV=production
PORT=3000

DB_HOST=INTERNAL_HOST_COPIADO_DE_EASYPANEL
DB_PORT=3306
DB_USER=sheetsdrawer
DB_PASSWORD=CONTRASENA_DEL_USUARIO_MARIADB
DB_NAME=sheetsdrawer

JWT_SECRET=SECRETO_ALEATORIO_DE_64_CARACTERES_O_MAS
ADMIN_NAME=Administrador
ADMIN_EMAIL=TU_CORREO_ADMINISTRATIVO
ADMIN_PASSWORD=CONTRASENA_ADMINISTRATIVA_INICIAL

PUBLIC_URL=https://abrircrm.com
API_PREFIX=/api/sheets-drawer

STRIPE_SECRET_KEY=CLAVE_SECRETA_DE_STRIPE
STRIPE_WEBHOOK_SECRET=SECRETO_DEL_WEBHOOK_DE_STRIPE
```

Puntos que deben coincidir exactamente:

- `DB_HOST` es el **Internal Host** mostrado por el servicio MariaDB. No uses `localhost`, una IP pública ni el nombre visible si EasyPanel presenta otro host interno.
- `DB_USER`, `DB_PASSWORD` y `DB_NAME` deben ser los valores de **Credentials**.
- `JWT_SECRET` debe ser único para este servicio. Puedes generarlo localmente con `openssl rand -hex 32` o con un generador criptográfico equivalente.
- `ADMIN_PASSWORD` debe tener al menos 8 caracteres. Se utiliza únicamente para crear el primer superadministrador cuando la base todavía no contiene ese correo.
- `STRIPE_SECRET_KEY` comienza normalmente con `sk_live_` en producción.
- `STRIPE_WEBHOOK_SECRET` comienza normalmente con `whsec_` y se obtiene después de crear el webhook.

No agregues `DB_ROOT_PASSWORD` a la App; solo pertenece al servicio de base de datos. Tampoco agregues `EASYPANEL_URL`, `EASYPANEL_TOKEN`, `EASYPANEL_PROJECT`, `EASYPANEL_SERVICE`, `PUBLISHED_DIR` o `DOMAIN_TARGET`. MinimalBuilder los usa para publicar sitios y administrar su propio servicio; Sheets Row Drawer no realiza esas operaciones.

## 5. Dominio y HTTPS

En la sección **Domains** de la App:

1. Agrega `abrircrm.com`.
2. Selecciona protocolo interno `HTTP`.
3. Usa el puerto interno `3000`.
4. Activa HTTPS y el resolvedor de certificados disponible en tu instalación, normalmente Let's Encrypt.
5. Márcalo como dominio principal.

Mantén habilitada la actualización de conexiones WebSocket para `/socket.io/`. Las ejecuciones del MCP usan ese canal para avisar a la pestaña abierta de Google Sheets y están configuradas sin transporte HTTP de sondeo.

No publiques el puerto `3000` desde **Ports**. Para una API HTTP pública, EasyPanel debe recibir el tráfico mediante **Domains**.

## 6. Primer despliegue

Pulsa **Deploy** y revisa primero la acción de compilación y luego **Logs**. El inicio correcto muestra una línea similar a:

```text
Sheets Row Drawer API en http://localhost:3000/api/sheets-drawer
```

Durante el primer inicio el servidor crea las tablas, los planes predeterminados y el usuario `superadmin` definido por `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Al desplegar esta migración también crea `integration_tokens` y `sheet_executions`; no se necesita ejecutar SQL manualmente.

Comprueba desde el navegador:

```text
https://abrircrm.com/api/sheets-drawer/health
```

La respuesta esperada es:

```json
{"ok":true,"service":"sheets-row-drawer"}
```

Después prueba también:

```text
https://abrircrm.com/api/sheets-drawer/billing/plans
```

Debe devolver los planes públicos creados por la migración inicial.

## 7. Configurar Stripe

En Stripe, crea un endpoint de webhook con esta URL:

```text
https://abrircrm.com/api/sheets-drawer/stripe/webhook
```

Selecciona estos eventos:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copia el **Signing secret** del endpoint a `STRIPE_WEBHOOK_SECRET` en EasyPanel y vuelve a desplegar la App. Los planes se administran desde la cuenta superadministradora; Checkout crea el precio recurrente a partir del monto, moneda e intervalo guardados en cada plan.

Usa las claves de prueba de Stripe para validar primero un alta, una renovación, la apertura del portal y una cancelación. Cambia a las claves de producción después de confirmar el flujo completo.

## 8. Preparar la extensión

En el equipo de desarrollo ejecuta:

```powershell
npm install
npm run build:extension
```

Carga o distribuye únicamente la carpeta `dist-extension`. El manifiesto autoriza `https://abrircrm.com/*` y el service worker usa por defecto:

```text
https://abrircrm.com/api/sheets-drawer
```

Después de reemplazar una versión instalada manualmente, pulsa **Actualizar** en `chrome://extensions` y recarga Google Sheets.

## 9. Comprobación funcional

Realiza esta secuencia antes de entregar el servicio:

1. Inicia sesión con el superadministrador.
2. Crea una cuenta de prueba con vencimiento.
3. Impersona su usuario y vuelve a la sesión administrativa.
4. Abre una hoja y configura al menos dos tipos de columna.
5. Recarga Sheets y comprueba que el workspace reaparece.
6. Verifica en MariaDB que existe una fila en `workspaces` para esa cuenta y `spreadsheet_id`.
7. Suspende la cuenta y confirma que la extensión deja de leer y escribir.
8. Reactívala y confirma que recupera el acceso.
9. Completa una suscripción de prueba de Stripe y revisa el estado y vencimiento de la cuenta.

## 10. Actualizaciones

Cuando publiques cambios:

1. Haz el commit y push desde tu equipo.
2. Pulsa **Deploy** en EasyPanel o habilita **Auto Deploy** para la rama elegida.
3. Si cambió la extensión, vuelve a ejecutar `npm run build:extension` y distribuye la nueva `dist-extension`.
4. Comprueba `/health`, los logs y un inicio de sesión antes de considerar terminada la actualización.

No elimines el servicio MariaDB al reemplazar o volver a desplegar la App. Los datos viven en el almacenamiento persistente de MariaDB y deben conservarse entre versiones.
