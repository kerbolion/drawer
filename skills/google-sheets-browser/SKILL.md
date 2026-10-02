---
name: google-sheets-browser
description: Read, inspect, edit, or clear Google Sheets through the Sheets Row Drawer extension and the user's authenticated browser session. Use when a user provides a Google Sheets URL or asks Codex to work directly with an open spreadsheet without Google APIs, OAuth, or service-account credentials.
---

# Google Sheets Browser

Use `scripts/sheets.mjs` as the only transport. It starts a short-lived server on `127.0.0.1:17373`; the browser extension picks up one command, executes it in the matching open spreadsheet, returns the result, and the server exits.

The target spreadsheet must be open in a browser where Sheets Row Drawer is loaded. Pass the user's exact Sheets URL so the bridge selects the correct document and `gid`.

## Commands

Run these from the skill directory, or use the absolute path to this skill's script:

```powershell
node scripts/sheets.mjs info --url "SHEETS_URL"
node scripts/sheets.mjs read --url "SHEETS_URL" --range "A1:D20"
node scripts/sheets.mjs read --url "SHEETS_URL" --sheet "Servicios" --range "A1:F50"
node scripts/sheets.mjs write --url "SHEETS_URL" --sheet "Servicios" --start "B2" --values-file "VALUES_JSON"
node scripts/sheets.mjs clear --url "SHEETS_URL" --sheet "Servicios" --range "B2:D10"
```

For writes, create a temporary UTF-8 JSON file containing a rectangular array, for example:

```json
[["C-1", "Limpieza", 25], ["C-2", "Entrega", 40]]
```

Use `info` first when the active tab or available sheet names matter. Use bounded ranges for reads. Preserve strings exactly; do not replace URLs or reformat values.

`write` uses one synthetic TSV paste and verifies the resulting range through the authenticated HTML view. `clear` removes cell contents while preserving the rows, columns, and formatting. Inspect the returned `verified` field and report a verification failure instead of assuming success.

An explicit request to edit or clear specified data authorizes that operation. If the target sheet, range, or replacement values are ambiguous, resolve the ambiguity before mutating the document. Do not treat a read request as authorization to write.

If the matching spreadsheet is not open, open the exact URL in the user's default browser and retry the command. If the bridge still times out, verify that the unpacked extension was reloaded after its latest build, then retry once. Do not fall back to Google APIs or attempt to read browser cookies.
