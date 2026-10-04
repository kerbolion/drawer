#!/usr/bin/env node

import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const HOST = "127.0.0.1";
const PORT = 17373;
const HEADER_VALUE = "sheets-row-drawer-v1";
const MAX_BODY_BYTES = 1_048_576;
const ACTIONS = new Set(["current", "info", "list", "read", "inspect", "write", "append", "update", "clear", "create-sheet", "rename-sheet", "delete-sheet"]);
const REPEATABLE_OPTIONS = new Set(["set", "where", "header"]);

function fail(message, details = undefined) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function parseArguments(argv) {
  const [action, ...tokens] = argv;
  if (!ACTIONS.has(action)) {
    fail("Uso: sheets.mjs <current|info|list|read|inspect|write|append|update|clear|create-sheet|rename-sheet|delete-sheet> [--url <URL de Sheets>] [opciones]");
  }
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) fail(`Argumento no reconocido: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`Falta el valor de --${key}`);
    if (REPEATABLE_OPTIONS.has(key)) {
      if (!options[key]) options[key] = [];
      options[key].push(value);
    } else {
      options[key] = value;
    }
    index += 1;
  }
  return { action, options };
}

function assignments(values, label) {
  if (!Array.isArray(values) || !values.length) fail(`${label} requiere al menos un --set "Columna=valor"`);
  const result = {};
  for (const assignment of values) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) fail(`Asignación no válida: ${assignment}. Usa --set "Columna=valor"`);
    const column = assignment.slice(0, separator).trim();
    if (!column) fail(`Asignación sin nombre de columna: ${assignment}`);
    result[column] = assignment.slice(separator + 1);
  }
  return result;
}

function parseSheetUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("--url debe ser una URL válida de Google Sheets");
  }
  const spreadsheetId = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] || "";
  if (url.hostname !== "docs.google.com" || !spreadsheetId) {
    fail("--url debe apuntar a docs.google.com/spreadsheets/d/...");
  }
  const hash = new URLSearchParams(url.hash.slice(1));
  return {
    spreadsheetId,
    gid: hash.get("gid") || url.searchParams.get("gid") || "0"
  };
}

function positiveInteger(value, fallback, label = "--timeout") {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`${label} debe ser un entero positivo`);
  return parsed;
}

async function jsonOption(options, fileOption, inlineOption, label) {
  const source = options[fileOption]
    ? await readFile(options[fileOption], "utf8")
    : options[inlineOption];
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${label} debe contener JSON válido`, error.message);
  }
}

async function commandFromArguments(action, options) {
  if (action === "current") {
    return {
      id: randomUUID(),
      action: "info",
      target: { activeTab: true },
      params: { gid: "", sheet: "" },
      timeoutMs: positiveInteger(options.timeout, 30) * 1_000
    };
  }
  if (!options.url) fail("Falta --url");
  const target = parseSheetUrl(options.url);
  const params = {
    gid: String(options.gid || target.gid),
    sheet: String(options.sheet || "").trim()
  };

  if (action === "read" || action === "inspect") {
    if (!options.range) fail(`${action} requiere --range, por ejemplo A1:D20`);
    params.range = options.range;
  }
  if (action === "list") {
    params.fromRow = positiveInteger(options["from-row"], 2, "--from-row");
    if (params.fromRow < 2) fail("--from-row debe ser igual o mayor que 2");
    params.limit = positiveInteger(options.limit, 100, "--limit");
    if (params.limit > 500) fail("--limit admite como máximo 500 registros por lectura");
    params.where = options.where ? assignments(options.where, "list") : {};
  }
  if (action === "write") {
    if (!options.start) fail("write requiere --start, por ejemplo A2");
    params.values = await jsonOption(options, "values-file", "values", "write");
    if (!params.values) fail("write requiere --values-file o --values");
    params.start = options.start;
  }
  if (action === "append") {
    const records = await jsonOption(options, "records-file", "records", "append");
    const values = await jsonOption(options, "values-file", "values", "append");
    const inputCount = Number(Boolean(options.set)) + Number(Boolean(records)) + Number(Boolean(values));
    if (inputCount > 1) fail("append acepta solo uno de --set, --records-file/--records o --values-file/--values");
    if (inputCount === 0) fail("append requiere --set, --records-file/--records o --values-file/--values");
    if (options.set) params.record = assignments(options.set, "append");
    if (records) {
      if (!Array.isArray(records) || !records.length || records.some((record) => !record || typeof record !== "object" || Array.isArray(record))) {
        fail("append requiere una lista no vacía de objetos en --records-file o --records");
      }
      params.records = records;
    }
    if (values) params.values = values;
  }
  if (action === "update") {
    const hasRow = options.row !== undefined;
    const hasWhere = Array.isArray(options.where) && options.where.length > 0;
    if (hasRow === hasWhere) fail("update requiere exactamente uno de --row o --where");
    if (hasRow) {
      const row = Number(options.row);
      if (!Number.isInteger(row) || row < 2) fail("update requiere --row con un número de fila igual o mayor que 2");
      params.row = row;
    } else {
      params.where = assignments(options.where, "update");
    }
    params.changes = assignments(options.set, "update");
  }
  if (action === "clear") {
    if (!options.range) fail("clear requiere --range, por ejemplo A2:D10");
    params.range = options.range;
  }
  if (action === "create-sheet") {
    const name = String(options.name || "").trim();
    if (!name) fail("create-sheet requiere --name");
    params.name = name;
    params.headers = Array.isArray(options.header) ? options.header.map((header) => String(header).trim()) : [];
    if (params.headers.some((header) => !header)) fail("--header no puede estar vacío");
  }
  if (action === "rename-sheet") {
    const sheet = String(options.sheet || "").trim();
    const name = String(options.name || "").trim();
    if (!sheet || !name) fail("rename-sheet requiere --sheet y --name");
    params.sheet = sheet;
    params.name = name;
  }
  if (action === "delete-sheet") {
    const sheet = String(options.sheet || "").trim();
    if (!sheet) fail("delete-sheet requiere --sheet");
    const requiredConfirmation = `ELIMINAR ${sheet}`;
    if (options.confirm !== requiredConfirmation) fail(`delete-sheet requiere --confirm "${requiredConfirmation}"`);
    params.sheet = sheet;
    params.confirmation = options.confirm;
  }

  return {
    id: randomUUID(),
    action,
    target,
    params,
    timeoutMs: positiveInteger(options.timeout, 30) * 1_000
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Solicitud demasiado grande"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("JSON no válido"));
      }
    });
    request.on("error", reject);
  });
}

function respond(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function contextMatches(command, context) {
  if (command.target.activeTab) return context?.tabActive === true;
  if (context?.spreadsheetId !== command.target.spreadsheetId) return false;
  if (command.params.sheet || ["create-sheet", "rename-sheet", "delete-sheet"].includes(command.action)) return true;
  return String(context?.gid || "0") === String(command.params.gid || "0");
}

async function run(command) {
  let delivered = false;
  let settled = false;
  let settleResult;
  let settleError;
  const completed = new Promise((resolve, reject) => {
    settleResult = resolve;
    settleError = reject;
  });

  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.headers["x-sheets-row-drawer-bridge"] !== HEADER_VALUE) {
      respond(response, 404, { error: "Not found" });
      return;
    }
    try {
      const body = await readJson(request);
      if (request.url === "/v1/poll") {
        if (!delivered && contextMatches(command, body)) {
          delivered = true;
          respond(response, 200, {
            command: { id: command.id, action: command.action, params: command.params }
          });
        } else {
          respond(response, 200, { command: null });
        }
        return;
      }
      if (request.url === "/v1/result") {
        if (body.id !== command.id) {
          respond(response, 409, { error: "El resultado no corresponde al comando activo" });
          return;
        }
        respond(response, 200, { ok: true });
        if (!settled) {
          settled = true;
          if (body.ok) settleResult(body.result);
          else settleError(Object.assign(new Error(body.error || "La extensión no pudo ejecutar el comando"), { details: body.details }));
        }
        return;
      }
      respond(response, 404, { error: "Not found" });
    } catch (error) {
      respond(response, 400, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  }).catch((error) => {
    if (error.code === "EADDRINUSE") fail(`El puerto local ${PORT} está ocupado; espera a que termine el otro comando`);
    throw error;
  });

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    settleError(new Error(delivered
      ? "La extensión recibió el comando pero no devolvió un resultado"
      : "La extensión no se conectó. Abre la hoja indicada, recarga la extensión y vuelve a intentarlo."));
  }, command.timeoutMs);

  try {
    return await completed;
  } finally {
    clearTimeout(timeout);
    await new Promise((resolve) => server.close(resolve));
  }
}

function appendCommandChunks(command) {
  if (command.action !== "append") return [command];
  const key = Array.isArray(command.params.records)
    ? "records"
    : Array.isArray(command.params.values) && Array.isArray(command.params.values[0])
      ? "values"
      : "";
  if (!key) return [command];
  const chunks = [];
  let items = [];
  let cellCount = 0;
  let byteCount = 0;
  for (const item of command.params[key]) {
    const itemCells = key === "records" ? Object.keys(item).length : item.length;
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    if (items.length && (items.length >= 100 || cellCount + itemCells > 5_000 || byteCount + itemBytes > 250_000)) {
      chunks.push(items);
      items = [];
      cellCount = 0;
      byteCount = 0;
    }
    items.push(item);
    cellCount += itemCells;
    byteCount += itemBytes;
  }
  if (items.length) chunks.push(items);
  if (chunks.length <= 1) return [command];
  return chunks.map((itemsForChunk) => ({
    ...command,
    id: randomUUID(),
    params: { ...command.params, [key]: itemsForChunk }
  }));
}

try {
  const { action, options } = parseArguments(process.argv.slice(2));
  const command = await commandFromArguments(action, options);
  const commands = appendCommandChunks(command);
  const results = [];
  for (const chunk of commands) {
    try {
      results.push(await run(chunk));
    } catch (error) {
      error.details = {
        ...(error.details && typeof error.details === "object" ? error.details : {}),
        completedChunks: results.length,
        totalChunks: commands.length,
        completedResults: results
      };
      throw error;
    }
  }
  const result = results.length === 1
    ? results[0]
    : { chunks: results.length, results };
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, details: error.details }, null, 2)}\n`);
  process.exitCode = 1;
}
