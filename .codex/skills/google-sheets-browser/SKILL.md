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
node scripts/sheets.mjs inspect --url "SHEETS_URL" --range "M2"
node scripts/sheets.mjs read --url "SHEETS_URL" --sheet "Servicios" --range "A1:F50"
node scripts/sheets.mjs write --url "SHEETS_URL" --sheet "Servicios" --start "B2" --values-file "VALUES_JSON"
node scripts/sheets.mjs clear --url "SHEETS_URL" --sheet "Servicios" --range "B2:D10"
```

For writes, create a temporary UTF-8 JSON file containing a rectangular array, for example:

```json
[["C-1", "Limpieza", 25], ["C-2", "Entrega", 40]]
```

Use `info` first when the active tab or available sheet names matter. Use bounded ranges for reads. Preserve strings exactly; do not replace URLs or reformat values.

Use `inspect` only for a small range in the active sheet when a displayed value cannot be explained by `read`. It reports the sanitized HTML cell representation and Google Visualization value metadata, and accepts at most 100 cells.

`write` uses one synthetic TSV paste and verifies the resulting range through the authenticated HTML view. `clear` removes cell contents while preserving the rows, columns, and formatting. Inspect the returned `verified` field and report a verification failure instead of assuming success.

## Limitations

- The spreadsheet must remain open and responsive in a Chromium browser with the unpacked extension loaded. The active Google session must already have access to the document and edit permission for mutations.
- The bridge is local to the computer at `127.0.0.1:17373`. It accepts one command at a time; a second command fails while the port is occupied. The default command timeout is 30 seconds and can be changed with `--timeout`.
- Supported operations are `info`, `read`, `inspect`, `write`, and `clear`. There are no dedicated operations for formatting, validation rules, comments, protected ranges, charts, filters, or creating, deleting, renaming, or moving sheets, rows, and columns.
- Ranges must use A1 notation with one or two column letters (`A` through `ZZ`) and positive row numbers. Whole-column ranges, named ranges, disjoint ranges, and R1C1 notation are not accepted.
- `write` requires a non-empty rectangular JSON matrix and a single starting cell. `clear` removes cell contents but preserves formatting and data validation.
- `read` returns displayed values rather than guaranteed underlying formulas. A completely empty range can produce no rows, so do not infer that a blank result contains records.
- `inspect` works only on the active sheet and accepts at most 100 cells. It exposes sanitized cell HTML and available Visualization metadata, which may still omit internal Sheets state.
- Bridge request and result bodies are limited to 1 MiB. Prefer bounded reads and split large data operations into sequential ranges.
- Writes depend on Sheets UI events and are verified after the paste or clear. They are not transactional and have no automatic rollback; treat `verified: false`, a timeout, or a changed selection as an uncertain result and read the target range before retrying.
- `info` discovers the sheet tabs visible in the current document UI. Hidden sheets or tabs that Google has not rendered may not be listed.
- The bridge does not use Google APIs, service accounts, additional OAuth, or browser-cookie extraction. It cannot operate when the browser session is signed out, offline, blocked by a permission dialog, or unable to load the sheet.

An explicit request to edit or clear specified data authorizes that operation. If the target sheet, range, or replacement values are ambiguous, resolve the ambiguity before mutating the document. Do not treat a read request as authorization to write.

If the matching spreadsheet is not open, open the exact URL in the user's default browser and retry the command. If the bridge still times out, verify that the unpacked extension was reloaded after its latest build, then retry once. Do not fall back to Google APIs or attempt to read browser cookies.
