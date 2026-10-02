# Sheets Row Drawer — prueba de sesión

Prototipo mínimo para validar el flujo antes de construir la extensión completa.

- Lee la fila seleccionada mediante la vista HTML autenticada de Google Sheets.
- Detecta automáticamente los cambios de celda o fila.
- Abre el formulario a la derecha.
- Detecta las demás hojas visibles y relaciona registros por columnas `ID ...` compartidas.
- Muestra relaciones padre-hijo en ambos sentidos, como `Contactos -> Servicios` y `Servicios -> Contactos`.
- Aísla el formulario para que `Ctrl+V` permanezca dentro del input.
- Guarda el rango editado mediante un único pegado TSV horizontal de Sheets.
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

## Relaciones automáticas

La clave principal se infiere usando el nombre de la hoja. Por ejemplo, `Contactos` busca `ID Contacto` y `Servicios` busca `ID Servicio`. Si `Servicios` también contiene `ID Contacto`, la extensión la considera una referencia a `Contactos` y muestra las filas coincidentes en la sección **Relacionados**.

También se reconocen variantes de escritura como `id_contacto`, `Id Contacto` o `IDContacto`. Si el nombre de la hoja no coincide con ninguna columna, se usa la primera columna cuyo nombre comienza por `ID`.

La lectura y el cambio automático de fila se pueden volver a comprobar con:

```powershell
node tests/validate-public-sheet.mjs
node tests/validate-relations.mjs
```
