# Sheets Row Drawer server

Servicio de cuentas y persistencia para la extensión. Conserva el patrón de MinimalBuilder, pero usa un recurso `workspace` por documento de Google Sheets.

## Desarrollo

1. Copia `.env.example` como `.env` y reemplaza todas las credenciales.
2. Ejecuta `docker compose --env-file .env up --build` desde esta carpeta.
3. Configura el proxy público para enviar `/api/sheets-drawer/*` a este servicio.
4. En Stripe, registra el webhook `POST /api/sheets-drawer/stripe/webhook`.

La cuenta `superadmin` se crea una sola vez a partir de `ADMIN_EMAIL` y `ADMIN_PASSWORD`. El servidor valida usuario activo, estado y expiración de la cuenta en cada lectura o escritura de un workspace.

## Datos

- `accounts`: estado, expiración, plan, límites y referencia de Stripe.
- `users`: credenciales y roles `superadmin`, `admin` y `user`.
- `workspaces`: un JSON por cuenta y `spreadsheet_id`.
- `billing_plans`: planes administrables usados para Stripe Checkout.
- `impersonation_logs`: auditoría de accesos del superadministrador.

Los secretos solo viven en el servidor. Nunca deben agregarse al manifiesto ni al paquete de la extensión.
