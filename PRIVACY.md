# Privacidad de Sheets Row Drawer

Sheets Row Drawer usa la sesión que el usuario ya tiene abierta en Google Sheets. No solicita credenciales de Google, OAuth propio, claves de Google Sheets API ni cuentas de servicio.

## Datos tratados

El servicio almacena:

- nombre, correo, hash de contraseña, rol, estado y fecha de expiración de la cuenta;
- identificadores de cliente y suscripción de Stripe, estado de facturación y plan contratado;
- identificador y nombre del documento de Google Sheets;
- configuración del workspace: nombres de hojas y columnas, tipos de campo, opciones, colores y preferencias de vista;
- registros de impersonación administrativa para auditoría.

Los valores de las filas y celdas no se envían al servidor de Sheets Row Drawer. Se leen desde Google Sheets dentro del navegador, se conservan temporalmente en el almacenamiento local de la extensión y se escriben de vuelta en la hoja por acción del usuario.

## Pagos

Stripe procesa los pagos. Sheets Row Drawer no recibe ni almacena números completos de tarjeta. Conserva únicamente los identificadores y estados necesarios para gestionar la suscripción.

## Uso y acceso

Los datos se usan para autenticar al usuario, aplicar el plan contratado, sincronizar la configuración de sus documentos, prestar soporte y proteger el servicio contra acceso no autorizado. Cada workspace queda separado por cuenta. Los administradores autorizados pueden impersonar usuarios para soporte; cada acceso queda registrado.

## Conservación y eliminación

Los datos se conservan mientras la cuenta exista o mientras sean necesarios para obligaciones de facturación y seguridad. El titular puede solicitar acceso, corrección o eliminación mediante el canal de soporte publicado junto con la extensión.

## Seguridad

Las comunicaciones con el servicio usan HTTPS. Las contraseñas se almacenan con hash bcrypt y el servidor valida el estado y vencimiento de la cuenta en cada operación protegida. Ningún secreto del servidor se incluye en la extensión.
