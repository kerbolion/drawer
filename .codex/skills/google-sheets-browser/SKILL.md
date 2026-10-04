---
name: google-sheets-browser
description: Read, inspect, populate, edit, clear, create, rename, or delete Google Sheets tabs through the Sheets Row Drawer extension and the user's authenticated browser session. Use when a user provides a Google Sheets URL or asks Codex to work directly with an open spreadsheet without Google APIs, OAuth, or service-account credentials.
---

# Google Sheets Browser

Use `scripts/sheets.mjs` as the only transport. It starts a short-lived server on `127.0.0.1:17373`; the browser extension picks up one command, executes it in the matching open spreadsheet, returns the result, and the server exits.

The target spreadsheet must be open in a browser where Sheets Row Drawer is loaded and signed in with an active Sheets CRM account. Pass the user's exact Sheets URL so the bridge selects the correct document and `gid`.

## Commands

Run these from the skill directory, or use the absolute path to this skill's script:

```powershell
node scripts/sheets.mjs current
node scripts/sheets.mjs info --url "SHEETS_URL"
node scripts/sheets.mjs list --url "SHEETS_URL" --sheet "Servicios" --limit "100"
node scripts/sheets.mjs list --url "SHEETS_URL" --sheet "Servicios" --where "Estado=Activo"
node scripts/sheets.mjs read --url "SHEETS_URL" --range "A1:D20"
node scripts/sheets.mjs inspect --url "SHEETS_URL" --range "M2"
node scripts/sheets.mjs read --url "SHEETS_URL" --sheet "Servicios" --range "A1:F50"
node scripts/sheets.mjs write --url "SHEETS_URL" --sheet "Servicios" --start "B2" --values-file "VALUES_JSON"
node scripts/sheets.mjs append --url "SHEETS_URL" --sheet "Servicios" --set "ID=S-104" --set "Nombre=Instalación"
node scripts/sheets.mjs update --url "SHEETS_URL" --sheet "Servicios" --row "8" --set "Estado=Completado" --set "Notas="
node scripts/sheets.mjs update --url "SHEETS_URL" --sheet "Servicios" --where "ID=S-104" --set "Estado=Completado"
node scripts/sheets.mjs clear --url "SHEETS_URL" --sheet "Servicios" --range "B2:D10"
node scripts/sheets.mjs create-sheet --url "SHEETS_URL" --name "Clientes" --header "ID" --header "Nombre" --header "Estado"
node scripts/sheets.mjs rename-sheet --url "SHEETS_URL" --sheet "Clientes" --name "Contactos"
node scripts/sheets.mjs delete-sheet --url "SHEETS_URL" --sheet "Contactos" --confirm "ELIMINAR Contactos"
```

When the user refers to the spreadsheet currently open and does not provide its URL, use `current` while that Sheets tab is active. It performs a read-only discovery and returns the exact spreadsheet ID and `gid`. Build the exact Sheets URL from that result and use it for every subsequent read or mutation so commands remain isolated to the discovered document.

Prefer `list` for ordinary reads: it returns records as objects keyed by their column headers, accepts repeated `--where "Columna=valor"` filters, and avoids calculating an A1 range. It reads 100 records by default; use `--from-row` and `--limit` to page through up to 500 records at a time.

Prefer `append` for a new record: it finds the next available row, matches each `--set` to the header name, and rejects unknown columns. Prefer `update` for an existing record: it changes only the named columns and can locate one unique record through repeated `--where` conditions, so a row number is usually unnecessary. An empty value such as `--set "Notas="` clears that cell. These commands avoid temporary files for ordinary record work.

Use `create-sheet` to add a sheet and optionally establish its headers in the same operation. Repeat `--header` in the required column order; the command creates the tab, writes row 1, verifies the headers, and makes the new sheet immediately usable by `list`, `append`, and `update`. `rename-sheet` preserves the sheet's internal `gid`, configured property types, hidden columns, and relation preferences. `delete-sheet` removes the sheet and its saved configuration, refuses to remove the document's last sheet, and requires the exact confirmation `ELIMINAR <nombre>`.

For a batch with named fields, pass `--records-file` or `--records` containing an array of objects. The CLI automatically splits append batches above 100 rows, 5,000 cells, or roughly 250 KiB into sequential verified chunks. Request and response bodies have a hard 1 MiB limit.

Use `write` for an exact cell range or a multi-row batch. Small matrices can be passed through `--values`; for complex or multiline batches, create a temporary UTF-8 JSON file containing a rectangular array, for example:

```json
[["C-1", "Limpieza", 25], ["C-2", "Entrega", 40]]
```

Use `info` first when the active tab or available sheet names matter. Use bounded ranges for reads. When `--sheet` is present, reads and mutation verification are resolved by that sheet name even if Sheets changes the active tab during a write. Preserve strings exactly; do not replace URLs or reformat values.

Use `inspect` only for a small range in the active sheet when a displayed value cannot be explained by `read`. It reports the sanitized HTML cell representation and Google Visualization value metadata, and accepts at most 100 cells.

`write` uses one synthetic TSV paste and verifies the resulting range through the authenticated HTML view. `clear` removes cell contents while preserving the rows, columns, and formatting. Inspect the returned `verified` field and report a verification failure instead of assuming success.

## Limitations

- The spreadsheet must remain open and responsive in a Chromium browser with the unpacked extension loaded. The active Google session must already have access to the document and edit permission for mutations.
- Sheets Row Drawer must have an authenticated, active, unexpired service account. Signed-out, suspended, or expired accounts do not poll the local bridge.
- The bridge is local to the computer at `127.0.0.1:17373`. It accepts one command at a time; a second command fails while the port is occupied. The default command timeout is 30 seconds and can be changed with `--timeout`.
- `current` only discovers an active Google Sheets tab and never mutates it. If separate browser windows have different active Sheets tabs, use the user's exact URL to disambiguate.
- Supported operations are `current`, `info`, `list`, `read`, `inspect`, `write`, `append`, `update`, `clear`, `create-sheet`, `rename-sheet`, and `delete-sheet`. There are no dedicated operations for formatting, validation rules, comments, protected ranges, charts, filters, or moving sheets, rows, and columns.
- Ranges must use A1 notation with one or two column letters (`A` through `ZZ`) and positive row numbers. Whole-column ranges, named ranges, disjoint ranges, and R1C1 notation are not accepted.
- `write` requires a non-empty rectangular JSON matrix and a single starting cell. `clear` removes cell contents but preserves formatting and data validation.
- `list`, `append`, and `update --where` require existing column headers. Field names match headers after case and accent normalization. `update --where` rejects zero matches and multiple matches instead of guessing which row to edit.
- `create-sheet` accepts up to the limits enforced by Google Sheets, rejects empty or repeated headers, and cannot create a duplicate visible sheet name. Sheet creation, renaming, and deletion depend on the tab controls being rendered in the current Sheets UI language (Spanish and English are supported).
- `read` returns displayed values rather than guaranteed underlying formulas. A completely empty range can produce no rows, so do not infer that a blank result contains records.
- `inspect` works only on the active sheet and accepts at most 100 cells. It exposes sanitized cell HTML and available Visualization metadata, which may still omit internal Sheets state.
- Bridge request and result bodies are limited to 1 MiB. Prefer bounded reads and split large data operations into sequential ranges.
- Writes depend on Sheets UI events and are verified after the paste or clear. They are not transactional and have no automatic rollback; treat `verified: false`, a timeout, or a changed selection as an uncertain result and read the target range before retrying.
- `info` discovers the sheet tabs visible in the current document UI. Hidden sheets or tabs that Google has not rendered may not be listed.
- The bridge does not use Google APIs, service accounts, additional OAuth, or browser-cookie extraction. It cannot operate when the browser session is signed out, offline, blocked by a permission dialog, or unable to load the sheet.

An explicit request to edit or clear specified data authorizes that operation. If the target sheet, range, or replacement values are ambiguous, resolve the ambiguity before mutating the document. Do not treat a read request as authorization to write.

If the matching spreadsheet is not open, open the exact URL in the user's default browser and retry the command. If the bridge still times out, verify that the extension was loaded from the latest `dist-extension` build, that its account session is active, and that Google Sheets was refreshed; then retry once. Do not fall back to Google APIs or attempt to read browser cookies.
