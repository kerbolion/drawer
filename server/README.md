# Sheets Row Drawer server

Servicio de cuentas y persistencia para la extensión. Conserva el patrón de MinimalBuilder, pero usa un recurso `workspace` por documento de Google Sheets.

## Desarrollo

1. Copia `.env.example` como `.env` y reemplaza todas las credenciales.
2. Ejecuta `docker compose --env-file .env up --build` desde esta carpeta.
3. Configura el proxy público para enviar `/api/sheets-drawer/*` a este servicio.
4. En Stripe, registra el webhook `POST /api/sheets-drawer/stripe/webhook`.

El mismo dominio debe aceptar la actualización WebSocket de `/socket.io/`; el servidor restringe este canal al transporte `websocket`.

## EasyPanel

La instalación de producción sigue el mismo esquema de MinimalBuilder: una MariaDB privada y una App independiente dentro del mismo proyecto de EasyPanel. Consulta la guía completa en [`../EASYPANEL.md`](../EASYPANEL.md). El dominio público configurado para la extensión es `https://abrircrm.com`.

La cuenta `superadmin` se crea una sola vez a partir de `ADMIN_EMAIL` y `ADMIN_PASSWORD`. El servidor valida usuario activo, estado y expiración de la cuenta en cada lectura o escritura de un workspace.

## Datos

- `accounts`: estado, expiración, plan, límites y referencia de Stripe.
- `users`: credenciales y roles `superadmin`, `admin` y `user`.
- `workspaces`: un JSON por cuenta y `spreadsheet_id`.
- `integration_tokens`: hashes de credenciales MCP revocables creadas desde Mi cuenta.
- `sheet_executions`: órdenes breves reclamadas por una pestaña autenticada y eliminadas automáticamente después de completarse o expirar.
- `billing_plans`: planes administrables usados para Stripe Checkout.
- `impersonation_logs`: auditoría de accesos del superadministrador.

Los secretos solo viven en el servidor. Nunca deben agregarse al manifiesto ni al paquete de la extensión.
