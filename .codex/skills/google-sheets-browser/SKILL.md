---
name: google-sheets-browser
description: Read, inspect, populate, edit, or clear existing Google Sheets tabs through the configured Abrir CRM MCP tools and the user's authenticated browser session. Use when a user provides a Google Sheets URL or asks Codex to work directly with an open spreadsheet without Google APIs, OAuth, or service-account credentials.
---

# Google Sheets Browser

Use only the direct Abrir CRM Sheets MCP tools. They submit short-lived executions to the cloud account configured by `ABRIR_CRM_API_TOKEN`; the matching open Google Sheets tab claims and runs them through Abrir CRM's shared mutation engine.

## Connection guard

The expected tools are `profile`, `info`, `list_records`, `read_range`, `inspect_range`, and `apply_operations`. If they are unavailable in the current session, stop and ask the user to restart Codex so the configured MCP can load. Do not extract the token, launch a manual MCP client, create a localhost bridge, write temporary command files, or send operation payloads through a shell.

The target document must already be open in a Chromium browser with the current Abrir CRM extension loaded and signed in to an active, unexpired account. “Continuar sin cuenta” cannot claim executions.

## Read workflow

1. Call `profile` before the first document operation to confirm the connected account.
2. Call `info` with the exact Sheets URL to confirm that the intended document is open and discover visible sheet names.
3. Prefer `list_records` for ordinary data because it returns objects keyed by existing headers and supports exact filters.
4. Use `read_range` for bounded cell ranges. Use `inspect_range` only for up to 100 cells in the active sheet when the displayed value needs visual diagnostics.

Preserve strings exactly, including URLs, multiline text, leading zeroes, and empty values. Page `list_records` with `fromRow` and `limit` when more than 500 records are needed.

## Mutation workflow

Read [references/operations.md](references/operations.md) before constructing mutations.

- Use the exact Sheets URL supplied by the user. Names in `sheet`, `where`, `changes`, and records must match existing sheet names and headers.
- Combine the changes for one request in one ordered `apply_operations` call when practical.
- Use `create_sheet`, `rename_sheet`, and `delete_sheet` for tab lifecycle changes. A newly created sheet can be populated by a following `write` or `append` operation in the same ordered call.
- Prefer `append` with named records for new rows and `update` with a unique `where` selector for existing rows. An empty string clears a named cell.
- Use `write` only for an exact rectangular matrix and `clear` for an explicit bounded range.
- Inspect every returned operation result and its `verified` value. After mutation, read the affected records or ranges and verify the requested values.

Operations run sequentially and are verified through Google Sheets. They are not transactional: if one operation fails, earlier operations in the same execution may already be applied. Read the reported partial result before deciding whether a retry is safe.

An explicit request to edit or clear specified data authorizes that operation. A read request does not authorize mutation. Resolve ambiguous targets or replacement values before writing.

## Boundaries

- The tools can create, rename, and delete visible sheet tabs. They do not format, protect, filter, reorder, hide, or move sheets, rows, or columns.
- Ranges use A1 notation from `A` through `ZZ`; whole-column, named, disjoint, and R1C1 ranges are unsupported.
- `list_records`, named `append`, and `update` require existing headers. `update` rejects missing or non-unique matches.
- The extension reads displayed values and cannot guarantee access to underlying formulas or hidden Sheets internals.
- Executions expire quickly. If one expires, have the user activate or refresh the existing document, verify the current extension build and authenticated account, then retry once.
- Do not open a duplicate tab, use Google APIs, extract cookies, or fall back to browser automation outside the MCP tools.
