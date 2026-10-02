#!/usr/bin/env node

import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const HOST = "127.0.0.1";
const PORT = 17373;
const HEADER_VALUE = "sheets-row-drawer-v1";
const MAX_BODY_BYTES = 1_048_576;
const ACTIONS = new Set(["info", "read", "inspect", "write", "clear"]);

function fail(message, details = undefined) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function parseArguments(argv) {
  const [action, ...tokens] = argv;
  if (!ACTIONS.has(action)) {
    fail("Uso: sheets.mjs <info|read|inspect|write|clear> --url <URL de Sheets> [opciones]");
  }
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) fail(`Argumento no reconocido: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) fail(`Falta el valor de --${key}`);
    options[key] = value;
    index += 1;
  }
  return { action, options };
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

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail("--timeout debe ser un entero positivo");
  return parsed;
}

async function commandFromArguments(action, options) {
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
  if (action === "write") {
    if (!options.start) fail("write requiere --start, por ejemplo A2");
    const source = options["values-file"]
      ? await readFile(options["values-file"], "utf8")
      : options.values;
    if (!source) fail("write requiere --values-file o --values");
    try {
      params.values = JSON.parse(source);
    } catch (error) {
      fail("Los valores deben ser JSON válido", error.message);
    }
    params.start = options.start;
  }
  if (action === "clear") {
    if (!options.range) fail("clear requiere --range, por ejemplo A2:D10");
    params.range = options.range;
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
  if (context?.spreadsheetId !== command.target.spreadsheetId) return false;
  if (command.params.sheet) return true;
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

try {
  const { action, options } = parseArguments(process.argv.slice(2));
  const command = await commandFromArguments(action, options);
  const result = await run(command);
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, details: error.details }, null, 2)}\n`);
  process.exitCode = 1;
}
