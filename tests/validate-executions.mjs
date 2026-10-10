import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const [backgroundSource, contentSource, pageWriteSource, serverSource, mcpSource, manifest] = await Promise.all([
  readFile(path.join(root, "background.js"), "utf8"),
  readFile(path.join(root, "content.js"), "utf8"),
  readFile(path.join(root, "page-write.js"), "utf8"),
  readFile(path.join(root, "server", "src", "server.js"), "utf8"),
  readFile(path.join(root, "mcp", "server.mjs"), "utf8"),
  readFile(path.join(root, "manifest.json"), "utf8").then(JSON.parse)
]);

const stored = new Map([["srd:cloud:auth-token", "interactive-token"]]);
const requests = [];
let listener;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fetchMock(url, options = {}) {
  const pathname = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  requests.push({ pathname, method: options.method || "GET", body, authorization: options.headers?.Authorization || "" });
  if (pathname.endsWith("/auth/me")) return response({
    user: { id: 4, accountId: 7, name: "Cliente", email: "cliente@example.com", role: "admin", active: true },
    account: { id: 7, name: "Cliente", status: "active", expired: false }
  });
  if (pathname.endsWith("/auth/integration-tokens") && options.method === "POST") {
    return response({ token: "armcp_secret", connection: { id: 9, name: body.name } }, 201);
  }
  if (pathname.endsWith("/auth/integration-tokens") && (!options.method || options.method === "GET")) {
    return response({ tokens: [{ id: 9, name: "Codex" }] });
  }
  if (pathname.endsWith("/auth/integration-tokens/9") && options.method === "DELETE") return response({ ok: true, id: 9 });
  if (pathname.endsWith("/executions/ex-1/claim")) {
    return response({ claimed: true, id: "ex-1", claimToken: "claim-secret", command: { action: "info", params: {} } });
  }
  if (pathname.endsWith("/executions/ex-1/result")) return response({ ok: true, id: "ex-1", status: body.ok ? "succeeded" : "failed" });
  return response({ message: `Ruta no simulada: ${pathname}` }, 404);
}

const chrome = {
  runtime: {
    getManifest: () => ({ version: "test" }),
    onMessage: { addListener(callback) { listener = callback; } }
  },
  storage: {
    local: {
      async get(keys) {
        if (keys === null) return Object.fromEntries(stored);
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = stored.get(key);
        return result;
      },
      async set(values) { for (const [key, value] of Object.entries(values)) stored.set(key, value); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) stored.delete(key); }
    }
  }
};

vm.runInNewContext(backgroundSource, {
  AbortController,
  URL,
  clearTimeout,
  fetch: fetchMock,
  globalThis: { chrome },
  setTimeout,
  chrome
}, { filename: "background.js" });

function message(type, payload = {}, sender = { url: "https://docs.google.com/spreadsheets/d/sheet-123456/edit" }) {
  return new Promise((resolve, reject) => {
    const accepted = listener({ source: "sheets-row-drawer-cloud", type, payload }, sender, resolve);
    if (!accepted && !String(type).startsWith("execution.")) reject(new Error(`Mensaje rechazado: ${type}`));
  });
}

const connection = await message("execution.connection");
if (!connection.ok || connection.token !== "interactive-token" || connection.endpoint !== "https://abrircrm.com" || connection.accountId !== 7) {
  throw new Error(`La conexión WebSocket no se preparó correctamente: ${JSON.stringify(connection)}`);
}

const created = await message("integration.create", { name: "Codex principal" });
const listed = await message("integration.tokens");
const revoked = await message("integration.revoke", { id: 9 });
if (created.token !== "armcp_secret" || listed.tokens?.[0]?.id !== 9 || revoked.id !== 9) {
  throw new Error("La administración de credenciales no atravesó el service worker.");
}

const claim = await message("execution.claim", { id: "ex-1", spreadsheetId: "sheet-123456", gid: "0", sheet: "Contactos" });
if (!claim.ok || !claim.claimed || claim.claimToken !== "claim-secret") throw new Error("La pestaña no pudo reclamar la ejecución.");
const completed = await message("execution.result", { id: "ex-1", claimToken: claim.claimToken, ok: true, result: { sheet: "Contactos" } });
if (!completed.ok || completed.status !== "succeeded") throw new Error("La pestaña no pudo devolver el resultado.");

const rejected = await message("execution.claim", { id: "ex-1", spreadsheetId: "sheet-123456" }, { url: "https://example.com/" });
if (rejected?.code !== "INVALID_ORIGIN") throw new Error("El service worker aceptó una ejecución desde un origen ajeno a Sheets.");

const claimRequest = requests.find(item => item.pathname.endsWith("/executions/ex-1/claim"));
const resultRequest = requests.find(item => item.pathname.endsWith("/executions/ex-1/result"));
if (
  claimRequest?.authorization !== "Bearer interactive-token"
  || claimRequest?.body?.extensionVersion !== "test"
  || resultRequest?.body?.claimToken !== "claim-secret"
) throw new Error("La ejecución perdió autenticación, versión o credencial de reclamo.");

for (const required of [
  'transports: ["websocket"]',
  'executionSocket.on("sheets:execution-ready"',
  'async function executeSheetsExecution',
  'await executeSheetsCommand({ action, params })',
  '"create_sheet", "rename_sheet", "delete_sheet"',
  'error?.partialResult || null'
]) {
  if (!contentSource.includes(required)) throw new Error(`Falta el comportamiento de ejecución en content.js: ${required}`);
}
for (const forbidden of ["pollCodexBridge", "CODEX_BRIDGE_POLL_MS", "127.0.0.1:17373", "sheets-row-drawer-codex"]) {
  if (contentSource.includes(forbidden) || backgroundSource.includes(forbidden) || JSON.stringify(manifest).includes(forbidden)) {
    throw new Error(`La migración conservó el puente anterior: ${forbidden}`);
  }
}
for (const required of ["async function createSheet", "async function renameSheet", "async function deleteSheet", 'message?.type === "sheet-operation"']) {
  if (!pageWriteSource.includes(required)) throw new Error(`Falta la operación de pestaña en page-write.js: ${required}`);
}
for (const required of [
  "CREATE TABLE IF NOT EXISTS integration_tokens",
  "CREATE TABLE IF NOT EXISTS sheet_executions",
  'io.to(executionRoom(row.account_id)).emit("sheets:execution-ready"',
  'app.post(`${apiPrefix}/executions`',
  'app.post(`${apiPrefix}/executions/:id/claim`',
  'app.post(`${apiPrefix}/executions/:id/result`'
]) {
  if (!serverSource.includes(required)) throw new Error(`Falta el contrato del servidor: ${required}`);
}
for (const tool of ["profile", "info", "list_records", "read_range", "inspect_range", "apply_operations"]) {
  if (!mcpSource.includes(`server.registerTool("${tool}"`)) throw new Error(`Falta la herramienta MCP ${tool}.`);
}
for (const action of ["create_sheet", "rename_sheet", "delete_sheet"]) {
  if (!mcpSource.includes(`z.literal("${action}")`) || !serverSource.includes(`"${action}"`)) {
    throw new Error(`La operación ${action} no atraviesa MCP y servidor.`);
  }
}
if (mcpSource.includes("sheets.mjs") || mcpSource.includes("values-file") || mcpSource.includes("records-file")) {
  throw new Error("El MCP todavía depende de archivos temporales o del CLI anterior.");
}

console.log("EXECUTIONS_OK: credenciales, WebSocket exclusivo, reclamo único, resultados autenticados y MCP estructurado confirmados.");
