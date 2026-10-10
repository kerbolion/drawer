# Sheet operations

`apply_operations` accepts 1–100 ordered operations. Data operations name an existing sheet. Keep ordinary append batches at 100 records or fewer and split larger requests into verified calls.

## Create, rename, or delete a sheet

```json
[
  { "action": "create_sheet", "name": "Tareas" },
  { "action": "write", "sheet": "Tareas", "start": "A1", "values": [["ID", "Título", "Estado"]] },
  { "action": "rename_sheet", "sheet": "Tareas", "name": "Tareas 2026" }
]
```

To remove a sheet use `{ "action": "delete_sheet", "sheet": "Tareas 2026" }`. Sheet names are matched case-insensitively, must be unique, and cannot contain `: \\ / ? * [ ]`. The only remaining sheet cannot be deleted.

## Write a rectangular matrix

```json
{
  "action": "write",
  "sheet": "Contactos",
  "start": "B2",
  "values": [["Ana", "Activo"], ["Luis", "Pendiente"]]
}
```

Every row must have the same number of values. The starting cell determines the written range.

## Append named records

```json
{
  "action": "append",
  "sheet": "Contactos",
  "records": [
    { "ID": "C-104", "Nombre": "Ana", "Estado": "Activo" },
    { "ID": "C-105", "Nombre": "Luis", "Estado": "Pendiente" }
  ]
}
```

Use exactly one of `record`, `records`, or `values`. Named fields are matched to row-one headers after case and accent normalization; unknown fields are rejected.

## Update one record

Prefer a unique condition:

```json
{
  "action": "update",
  "sheet": "Contactos",
  "where": { "ID": "C-104" },
  "changes": { "Estado": "Completado", "Notas": "" }
}
```

Use exactly one of `where` or `row`. A `where` condition must match one record; zero or multiple matches fail instead of guessing. An empty string clears that cell.

## Clear a bounded range

```json
{
  "action": "clear",
  "sheet": "Contactos",
  "range": "B2:D10"
}
```

This clears values while preserving formatting and data validation.

## Verification

Successful mutation results include the affected sheet, row or range, resulting values, and `verified`. A failed batch reports `completed`, `failedAt`, and the successful operation results that preceded the failure. Never repeat the entire batch blindly after a partial failure.
