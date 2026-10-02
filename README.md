# Sheets Row Drawer — prueba de sesión

Prototipo mínimo para validar el flujo antes de construir la extensión completa.

La interfaz usa Ant Design `5.29.3`, la misma versión instalada en `workspace-antd`, y replica sus tokens claros: color primario, superficies, bordes, tipografía, radios y sombras. El bundle queda incluido localmente en la extensión y no descarga estilos ni scripts al abrir Google Sheets.

- Lee la fila seleccionada mediante la vista HTML autenticada de Google Sheets.
- Detecta automáticamente los cambios de celda o fila.
- Abre el formulario a la derecha.
- Detecta las demás hojas visibles y relaciona registros por columnas `ID ...` compartidas.
- Muestra relaciones padre-hijo en ambos sentidos, como `Contactos -> Servicios` y `Servicios -> Contactos`.
- Presenta los relacionados en vista **Deck** o **Tabla**, con paginación y una preferencia persistente por relación.
- Abre cada tarjeta Deck en un segundo drawer de Ant Design, igual que Workspace; en equipos de escritorio se abre con doble clic y en dispositivos táctiles con un toque.
- Permite editar los relacionados directamente en las celdas de la vista Tabla o desde su drawer usando los mismos controles tipados del formulario principal.
- Integra los cambios relacionados con **Guardar cambios** y **Cancelar**, escribe únicamente las celdas modificadas en la hoja de destino, restaura la hoja principal y confirma cada fila en segundo plano.
- Guarda filas y relacionados en caché local persistente, los muestra primero y comprueba cambios en segundo plano.
- Conserva una configuración independiente por documento y pestaña en `chrome.storage.local`.
- Permite configurar cada columna como texto, área de texto, número, monto, fecha, fecha y hora, hora, selección, selección múltiple, estado, casilla, URL, teléfono o correo.
- Usa los componentes reales de Ant Design para editar cada tipo y muestra el mismo icono de propiedad que Workspace.
- Permite agregar, eliminar y colorear las opciones de selección y Estado con la paleta de Workspace.
- Muestra calendarios y selectores de hora en español con el mismo comportamiento responsive de Workspace.
- Normaliza `true`/`false` y `VERDADERO`/`FALSO` a `TRUE`/`FALSE`, conserva la casilla visible mientras Sheets confirma el guardado y verifica en segundo plano sin volver a renderizar el formulario.
- Reconoce casillas visuales de Sheets aunque la celda no incluya `TRUE` o `FALSE` como texto visible.
- Activa **Guardar cambios** y **Cancelar** únicamente cuando el formulario contiene modificaciones pendientes.
- Muestra la actividad con el indicador del encabezado: spinner azul durante la lectura o el guardado y check verde al terminar, sin mensajes rutinarios dentro del formulario.
- Aísla el formulario para que `Ctrl+V` permanezca dentro del input.
- Guarda solamente el rango horizontal mínimo que contiene los campos modificados mediante un único pegado TSV de Sheets; la confirmación remota continúa en segundo plano.
- Mantiene el desplazamiento horizontal dentro de cada tabla relacionada para que el drawer conserve su ancho.
- Verifica el guardado volviendo a leer la fila.
- No usa Google Sheets API, claves, OAuth propio, Apps Script ni el portapapeles del sistema.

## Probar

1. Ejecuta `npm install` y `npm run build` en este directorio.
2. Abre `chrome://extensions`.
3. Activa **Modo de desarrollador**.
4. Pulsa **Cargar descomprimida** y elige este directorio.
5. Recarga una hoja de Google Sheets que puedas editar.
6. Selecciona cualquier celda debajo de la fila de encabezados.

El panel debe cargar la fila automáticamente. Cambia un campo y pulsa **Guardar cambios** para validar la escritura y la lectura de comprobación.

Esta versión supone que los encabezados están en la fila 1 y admite columnas hasta `ZZ`.

## Compartir la carpeta

El directorio ya incluye el skill de Codex en `.codex/skills/google-sheets-browser`. Para usarlo en otra computadora basta con compartir la carpeta completa:

1. Instala una versión actual de Node.js.
2. Abre `chrome://extensions`, activa **Modo de desarrollador** y carga esta carpeta con **Cargar descomprimida**.
3. Abre esta misma carpeta como proyecto en Codex e inicia una conversación nueva.
4. Abre en el navegador la hoja de Google Sheets y conserva iniciada la sesión de Google.
5. Escribe: `Usa $google-sheets-browser para inspeccionar esta hoja: URL_DE_LA_HOJA`.

Codex detecta el skill desde el proyecto; no es necesario copiarlo al perfil del usuario. La IA debe ejecutarse localmente en la misma computadora que el navegador, porque el puente solo escucha en `127.0.0.1:17373`.

Para otro agente local con acceso a terminal, indícale que lea `.codex/skills/google-sheets-browser/SKILL.md` y use únicamente el script allí documentado como transporte. Un agente remoto sin acceso al equipo y a `127.0.0.1` no puede comunicarse con la extensión.

## Conexión local con Codex

La extensión incluye el skill `google-sheets-browser`, basado en el mismo principio de `claude-cowork-google-sheets`: usa la sesión de Google ya abierta en el navegador, lee mediante `htmlembed` y escribe mediante un único pegado TSV. No necesita Google Sheets API, OAuth ni cuentas de servicio.

La comunicación usa un servidor efímero limitado a `127.0.0.1:17373`. Solo existe mientras Codex ejecuta un comando y la extensión únicamente acepta las operaciones `info`, `read`, `inspect`, `write` y `clear`.

El skill está incluido en `.codex/skills/google-sheets-browser`, por lo que Codex lo descubre al abrir este directorio como proyecto. Si se desea usarlo desde cualquier proyecto, se puede copiar esa carpeta a `%USERPROFILE%\.codex\skills\google-sheets-browser`.

Ejemplo directo desde este proyecto:

```powershell
npm run sheets -- read --url "https://docs.google.com/spreadsheets/d/.../edit#gid=0" --range "A1:D20"
```

## Relaciones automáticas

La clave principal se infiere usando el nombre de la hoja. Por ejemplo, `Contactos` busca `ID Contacto` y `Servicios` busca `ID Servicio`. Si `Servicios` también contiene `ID Contacto`, la extensión la considera una referencia a `Contactos` y muestra las filas coincidentes en la sección **Relacionados**.

También se reconocen variantes de escritura como `id_contacto`, `Id Contacto` o `IDContacto`. Si el nombre de la hoja no coincide con ninguna columna, se usa la primera columna cuyo nombre comienza por `ID`.

La caché conserva hasta 120 entradas recientes en `chrome.storage.local`. Al volver a una fila, el formulario aparece desde la caché y luego se compara con Sheets. Los cambios remotos reemplazan los datos almacenados, mientras que los valores que estés editando en ese momento se conservan.

## Tipos de campo

Cada archivo de Sheets se guarda como un workspace local. Las pestañas se identifican por su `gid` y cada columna mantiene su nombre visible, tipo y opciones. Esta configuración no caduca junto con la caché de filas.

Pulsa el icono de tipo junto al nombre de una propiedad para abrir **Editar propiedad**. Todas las columnas nuevas comienzan como **Texto** y la extensión no intenta adivinar el tipo. Los desplegables y estados tienen un editor de opciones con colores; las casillas permiten definir el valor activado y desactivado; montos, fechas y horas conservan sus ajustes de presentación.

El icono, el nombre y el identificador del tipo siguen el patrón visual de propiedades de Workspace. Tanto el icono como el nombre abren la configuración. Fechas y horas usan los selectores de Ant Design; números y montos usan `InputNumber`; opciones simples y múltiples usan `Select`; las casillas usan `Checkbox`.

El nombre configurado se usa únicamente en el formulario. El encabezado original continúa siendo la referencia de la columna en Sheets.

Al cambiar de fila, el formulario reutiliza los mismos campos y actualiza sus etiquetas y valores en el lugar. Esto evita el parpadeo causado por vaciar y reconstruir todo el formulario.

La lectura y el cambio automático de fila se pueden volver a comprobar con:

```powershell
node tests/validate-public-sheet.mjs
node tests/validate-relations.mjs
```
