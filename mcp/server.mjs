#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const spreadsheetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,200}$/).describe("ID del documento de Google Sheets.");
const gidSchema = z.string().regex(/^\d{1,30}$/).optional().describe("gid de la pestaña incluido en la URL de Sheets.");
const sheetSchema = z.string().trim().min(1).max(100).regex(/^[^:\\/?*\[\]]+$/).describe("Nombre exacto de una hoja; no puede contener : \\ / ? * [ ].");
const rangeSchema = z.string().regex(/^[A-Za-z]{1,2}\d+(?::[A-Za-z]{1,2}\d+)?$/).describe("Rango A1 acotado entre A y ZZ.");
const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rowValues = z.array(cellValue).min(1).max(702);
const matrix = z.array(rowValues).min(1).max(500);
const record = z.record(z.string().min(1), cellValue);
const filters = z.record(z.string().min(1), cellValue);
const targetFields = {
  url: z.string().url().optional().describe("URL exacta del documento de Google Sheets; puede incluir gid."),
  spreadsheetId: spreadsheetIdSchema.optional().describe("Alternativa a url."),
  gid: gidSchema
};

const operationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("write"),
    sheet: sheetSchema,
    start: z.string().regex(/^[A-Za-z]{1,2}\d+$/),
    values: matrix
  }).strict(),
  z.object({
    action: z.literal("append"),
    sheet: sheetSchema,
    record: record.optional(),
    records: z.array(record).min(1).max(100).optional(),
    values: matrix.optional()
  }).strict(),
  z.object({
    action: z.literal("update"),
    sheet: sheetSchema,
    row: z.number().int().min(2).optional(),
    where: filters.optional(),
    changes: record
  }).strict(),
  z.object({
    action: z.literal("clear"),
    sheet: sheetSchema,
    range: rangeSchema
  }).strict(),
  z.object({
    action: z.literal("create_sheet"),
    name: sheetSchema
  }).strict(),
  z.object({
    action: z.literal("rename_sheet"),
    sheet: sheetSchema,
    name: sheetSchema
  }).strict(),
  z.object({
    action: z.literal("delete_sheet"),
    sheet: sheetSchema
  }).strict()
]);

const apiBase = String(process.env.ABRIR_CRM_API_URL || "https://abrircrm.com/api/sheets-drawer").replace(/\/$/, "");
const accessToken = String(process.env.ABRIR_CRM_API_TOKEN || "").trim();

if (!accessToken) {
  console.error("Falta ABRIR_CRM_API_TOKEN. Genera una credencial desde Mi cuenta > Conexiones y expórtala antes de iniciar el MCP.");
  process.exit(1);
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(Number(options.timeout || 30_000))
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Abrir CRM rechazó la solicitud (${response.status}).`);
    error.status = response.status;
    error.code = data.code || "";
    error.details = data;
    throw error;
  }
  return data;
}

function normalizeTarget(input) {
  let spreadsheetId = String(input.spreadsheetId || "").trim();
  let gid = String(input.gid || "").trim();
  if (input.url) {
    const url = new URL(input.url);
    if (url.hostname !== "docs.google.com") throw new Error("La URL debe pertenecer a docs.google.com.");
    spreadsheetId ||= url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] || "";
    gid ||= url.searchParams.get("gid") || url.hash.match(/(?:^#|[?&])gid=(\d+)/)?.[1] || "";
  }
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(spreadsheetId)) {
    throw new Error("Proporciona url o spreadsheetId para identificar el documento abierto.");
  }
  if (gid && !/^\d{1,30}$/.test(gid)) throw new Error("El gid es inválido.");
  return { spreadsheetId, gid, sheet: String(input.sheet || "").trim() };
}

async function execute(input, command) {
  const target = normalizeTarget(input);
  const idempotencyKey = randomUUID();
  let execution = await request("/executions", {
    method: "POST",
    timeout: 30_000,
    body: { target, command, idempotencyKey, waitMs: 25_000 }
  });
  const deadline = Date.now() + 110_000;
  while (["queued", "claimed"].includes(execution.status) && Date.now() < deadline) {
    execution = await request(`/executions/${encodeURIComponent(execution.id)}/wait?timeoutMs=25000`, { timeout: 30_000 });
  }
  if (execution.status === "succeeded") return execution.result;
  if (execution.status === "failed") {
    const error = new Error(execution.error || "La ejecución falló dentro de Google Sheets.");
    error.details = execution.result;
    throw error;
  }
  if (execution.status === "expired") throw new Error(execution.error || "La ejecución expiró. Abre el documento correcto y vuelve a intentarlo.");
  throw new Error("La pestaña de Google Sheets no respondió antes del límite de tiempo.");
}

function validateOperations(operations) {
  for (const [index, operation] of operations.entries()) {
    if (operation.action === "append") {
      const sources = [operation.record, operation.records, operation.values].filter(value => value !== undefined);
      if (sources.length !== 1) throw new Error(`La operación ${index + 1} de append debe incluir exactamente record, records o values.`);
    }
    if (operation.action === "update") {
      const selectors = [operation.row, operation.where].filter(value => value !== undefined);
      if (selectors.length !== 1) throw new Error(`La operación ${index + 1} de update debe incluir exactamente row o where.`);
      if (!Object.keys(operation.changes || {}).length) throw new Error(`La operación ${index + 1} no contiene cambios.`);
    }
  }
}

function toolResult(value, message = "Operación completada.") {
  return {
    structuredContent: value,
    content: [{ type: "text", text: `${message}\n${JSON.stringify(value, null, 2)}` }]
  };
}

const server = new McpServer(
  { name: "abrir-crm-sheets", version: "2.0.0" },
  {
    instructions: "Trabaja únicamente sobre un documento de Google Sheets ya abierto en una pestaña con Abrir CRM autenticado. Usa profile e info antes de mutar. Lee por nombres de hoja y encabezados existentes. Agrupa las escrituras de una solicitud en apply_operations; se ejecutan en orden, se verifican en Sheets y un fallo puede dejar aplicadas las operaciones anteriores."
  }
);

server.registerTool("profile", {
  title: "Cuenta activa de Abrir CRM",
  description: "Confirma el usuario y la cuenta asociados con esta conexión MCP.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, async () => toolResult(await request("/auth/me"), "Cuenta activa."));

server.registerTool("info", {
  title: "Documento de Google Sheets",
  description: "Obtiene la hoja activa, selección, pestañas visibles y capacidades del ejecutor abierto.",
  inputSchema: targetFields,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, async input => toolResult(await execute(input, { action: "info", params: { gid: input.gid || "" } }), "Documento disponible."));

server.registerTool("list_records", {
  title: "Listar registros de una hoja",
  description: "Lee filas como objetos indexados por los encabezados de la hoja y permite filtros exactos.",
  inputSchema: {
    ...targetFields,
    sheet: sheetSchema,
    where: filters.optional(),
    fromRow: z.number().int().min(2).optional(),
    limit: z.number().int().min(1).max(500).optional()
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, async input => toolResult(await execute(input, {
  action: "list",
  params: { sheet: input.sheet, where: input.where || {}, fromRow: input.fromRow, limit: input.limit }
}), "Registros cargados."));

server.registerTool("read_range", {
  title: "Leer un rango",
  description: "Lee los valores mostrados de un rango A1 acotado en una hoja existente.",
  inputSchema: { ...targetFields, sheet: sheetSchema.optional(), range: rangeSchema },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, async input => toolResult(await execute(input, {
  action: "read",
  params: { sheet: input.sheet || "", range: input.range, gid: input.gid || "" }
}), "Rango cargado."));

server.registerTool("inspect_range", {
  title: "Inspeccionar un rango visible",
  description: "Inspecciona como máximo 100 celdas de la hoja activa cuando el valor mostrado necesita diagnóstico visual.",
  inputSchema: { ...targetFields, sheet: sheetSchema.optional(), range: rangeSchema },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
}, async input => toolResult(await execute(input, {
  action: "inspect",
  params: { sheet: input.sheet || "", range: input.range, gid: input.gid || "" }
}), "Rango inspeccionado."));

server.registerTool("apply_operations", {
  title: "Aplicar cambios en Google Sheets",
  description: "Ejecuta en orden creación, cambio de nombre o eliminación de hojas, escrituras, altas, actualizaciones y limpiezas mediante Abrir CRM. Las operaciones se verifican, pero no tienen rollback automático.",
  inputSchema: {
    ...targetFields,
    operations: z.array(operationSchema).min(1).max(100)
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
}, async input => {
  validateOperations(input.operations);
  const result = await execute(input, { action: "apply_operations", operations: input.operations });
  return toolResult(result, `${input.operations.length} operación(es) ejecutada(s).`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Abrir CRM Sheets MCP conectado a ${apiBase}`);
