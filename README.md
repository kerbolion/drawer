# Sheets Row Drawer — prueba de sesión

Prototipo mínimo para validar el flujo antes de construir la extensión completa.

- Lee la fila seleccionada mediante la vista HTML autenticada de Google Sheets.
- Detecta automáticamente los cambios de celda o fila.
- Abre el formulario a la derecha.
- Guarda sólo los campos modificados mediante eventos de pegado internos de Sheets.
- Verifica el guardado volviendo a leer la fila.
- No usa Google Sheets API, claves, OAuth propio, Apps Script ni el portapapeles del sistema.

## Probar

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige este directorio.
4. Recarga una hoja de Google Sheets que puedas editar.
5. Selecciona cualquier celda debajo de la fila de encabezados.

El panel debe cargar la fila automáticamente. Cambia un campo y pulsa **Guardar cambios** para validar la escritura y la lectura de comprobación.

Esta versión supone que los encabezados están en la fila 1 y admite columnas hasta `ZZ`.

La lectura y el cambio automático de fila se pueden volver a comprobar con:

```powershell
node tests/validate-public-sheet.mjs
```
