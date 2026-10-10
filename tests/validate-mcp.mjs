import http from "node:http";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const token = "armcp_test-token";
const executions = [];
const api = http.createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.statusCode = 401;
    response.end(JSON.stringify({ message: "No autenticado" }));
    return;
  }
  if (request.url === "/api/sheets-drawer/auth/me" && request.method === "GET") {
    response.end(JSON.stringify({ user: { id: 1, name: "Kevin" }, account: { id: 2, name: "Ventas" } }));
    return;
  }
  if (request.url === "/api/sheets-drawer/executions" && request.method === "POST") {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    executions.push(body);
    const command = body.command;
    const result = command.action === "info"
      ? { spreadsheetId: body.target.spreadsheetId, gid: body.target.gid, sheets: [{ name: "Contactos", gid: "0" }] }
      : command.action === "list"
        ? { sheet: command.params.sheet, records: [{ row: 2, ID: "C-1", Nombre: "Ana" }] }
        : command.action === "apply_operations"
          ? { completed: command.operations.length, operations: command.operations.map((operation, index) => ({ index, action: operation.action, ok: true, result: { verified: true } })) }
          : { rows: [{ row: 1, values: ["ID", "Nombre"] }] };
    response.end(JSON.stringify({ id: `execution-${executions.length}`, status: "succeeded", result }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ message: "No encontrado" }));
});

await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
const address = api.address();
const script = path.resolve(import.meta.dirname, "..", "mcp", "server.mjs");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [script],
  env: {
    ...process.env,
    ABRIR_CRM_API_URL: `http://127.0.0.1:${address.port}/api/sheets-drawer`,
    ABRIR_CRM_API_TOKEN: token
  },
  stderr: "pipe"
});
const client = new Client({ name: "abrir-crm-mcp-test", version: "1.0.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map(tool => tool.name).sort();
  const expected = ["apply_operations", "info", "inspect_range", "list_records", "profile", "read_range"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`Herramientas MCP inesperadas: ${JSON.stringify(names)}`);

  const url = "https://docs.google.com/spreadsheets/d/1BSEjvvq7mJO-7VP2XhuF21r3enbQnsAhOg4nqZP2fBM/edit#gid=310842502";
  const profile = await client.callTool({ name: "profile", arguments: {} });
  if (profile.structuredContent?.account?.name !== "Ventas") throw new Error("profile no devolvió la cuenta conectada.");

  const info = await client.callTool({ name: "info", arguments: { url } });
  if (info.structuredContent?.gid !== "310842502" || info.structuredContent?.sheets?.[0]?.name !== "Contactos") {
    throw new Error(`info no conservó el destino: ${JSON.stringify(info.structuredContent)}`);
  }

  const records = await client.callTool({ name: "list_records", arguments: { url, sheet: "Contactos", where: { ID: "C-1" } } });
  if (records.structuredContent?.records?.[0]?.Nombre !== "Ana") throw new Error("list_records no devolvió registros estructurados.");

  const applied = await client.callTool({
    name: "apply_operations",
    arguments: {
      url,
      operations: [
        { action: "create_sheet", name: "Prospectos" },
        { action: "write", sheet: "Prospectos", start: "A1", values: [["ID", "Nombre"]] },
        { action: "rename_sheet", sheet: "Prospectos", name: "Leads" },
        { action: "append", sheet: "Contactos", record: { ID: "C-2", Nombre: "Luis" } },
        { action: "update", sheet: "Contactos", where: { ID: "C-1" }, changes: { Nombre: "Ana María" } },
        { action: "delete_sheet", sheet: "Leads" }
      ]
    }
  });
  if (applied.structuredContent?.completed !== 6 || applied.structuredContent?.operations?.some(operation => !operation.result?.verified)) {
    throw new Error(`apply_operations no conservó el lote: ${JSON.stringify(applied.structuredContent)}`);
  }
  const mutation = executions.at(-1);
  if (
    mutation.target.spreadsheetId !== "1BSEjvvq7mJO-7VP2XhuF21r3enbQnsAhOg4nqZP2fBM"
    || mutation.command.operations?.[0]?.name !== "Prospectos"
    || mutation.command.operations?.[4]?.changes?.Nombre !== "Ana María"
    || mutation.command.operations?.[5]?.sheet !== "Leads"
  ) {
    throw new Error(`El MCP alteró el destino o los datos: ${JSON.stringify(mutation)}`);
  }

  const invalid = await client.callTool({
    name: "apply_operations",
    arguments: { url, operations: [{ action: "append", sheet: "Contactos", record: { ID: "C-3" }, records: [{ ID: "C-4" }] }] }
  });
  if (!invalid.isError) throw new Error("El MCP aceptó dos fuentes simultáneas para append.");
} finally {
  await client.close().catch(() => {});
  await new Promise(resolve => api.close(resolve));
}

console.log("MCP_OK: herramientas, token, destino por URL y operaciones estructuradas confirmados.");
