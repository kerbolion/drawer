import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const script = path.resolve(import.meta.dirname, "..", ".codex", "skills", "google-sheets-browser", "scripts", "sheets.mjs");
const url = "https://docs.google.com/spreadsheets/d/test-spreadsheet/edit#gid=7";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const backgroundSource = await readFile(path.resolve(import.meta.dirname, "..", "background.js"), "utf8");
let backgroundListener;
const stored = new Map([["srd:cloud:auth-token", "active-token"]]);
let accountStatus = "active";
let accountExpired = false;

async function backgroundFetch(url, options = {}) {
  const requestUrl = String(url);
  if (requestUrl.endsWith("/api/sheets-drawer/auth/me")) {
    if (options.headers?.Authorization !== "Bearer active-token") {
      return new Response(JSON.stringify({ message: "No autenticado." }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      user: { id: 2, accountId: 2, name: "Cliente", email: "client@example.com", role: "admin", active: true },
      account: { id: 2, name: "Cliente", status: accountStatus, expired: accountExpired }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return fetch(url, options);
}

const chrome = {
  runtime: {
    getManifest: () => ({ version: "test" }),
    onMessage: { addListener: (listener) => { backgroundListener = listener; } }
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
  clearTimeout,
  fetch: backgroundFetch,
  globalThis: { chrome },
  setTimeout,
  chrome
}, { filename: "background.js" });

function backgroundMessage(type, payload, tabActive = false) {
  return new Promise((resolve, reject) => {
    const handled = backgroundListener(
      { source: "sheets-row-drawer-codex", type, payload },
      { url, tab: { id: 9, active: tabActive, url } },
      resolve
    );
    if (!handled) reject(new Error(`El service worker no aceptó el mensaje ${type}`));
  });
}

async function runCurrentCase() {
  const child = spawn(process.execPath, [script, "current", "--timeout", "5"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve) => child.once("exit", resolve));

  let delivered;
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const inactive = await backgroundMessage("poll", { spreadsheetId: "inactive-sheet", gid: "9" }, false);
    if (inactive?.command !== null) throw new Error("current se entregó a una pestaña inactiva");
    delivered = await backgroundMessage("poll", { spreadsheetId: "test-spreadsheet", gid: "7" }, true);
    if (delivered?.command?.action === "info") break;
    await delay(50);
  }
  if (delivered?.command?.action !== "info") throw new Error(`current no encontró la pestaña activa: ${JSON.stringify(delivered)}`);
  await backgroundMessage("result", {
    id: delivered.command.id,
    ok: true,
    result: { spreadsheetId: "test-spreadsheet", gid: "7", sheet: "Servicios" }
  }, true);
  const exitCode = await exit;
  if (exitCode !== 0) throw new Error(stderr || `current terminó con código ${exitCode}`);
  const output = JSON.parse(stdout);
  if (output.result?.spreadsheetId !== "test-spreadsheet" || output.result?.sheet !== "Servicios") {
    throw new Error(`current devolvió otro documento: ${stdout}`);
  }
}

async function runChunkedAppendCase(recordsFile) {
  const child = spawn(process.execPath, [
    script, "append", "--url", url, "--sheet", "Servicios", "--records-file", recordsFile, "--timeout", "5"
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve) => child.once("exit", resolve));

  const sizes = [];
  for (let chunkIndex = 0; chunkIndex < 2; chunkIndex += 1) {
    let delivered;
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      delivered = await backgroundMessage("poll", { spreadsheetId: "test-spreadsheet", gid: "7" });
      if (delivered?.command?.action === "append") break;
      await delay(50);
    }
    if (delivered?.command?.action !== "append") throw new Error(`No se entregó el bloque ${chunkIndex + 1}`);
    sizes.push(delivered.command.params.records?.length || 0);
    await backgroundMessage("result", {
      id: delivered.command.id,
      ok: true,
      result: { chunk: chunkIndex + 1 }
    });
  }

  const exitCode = await exit;
  if (exitCode !== 0) throw new Error(stderr || `El lote terminó con código ${exitCode}`);
  const output = JSON.parse(stdout);
  if (sizes[0] !== 100 || sizes[1] !== 1 || output.result?.chunks !== 2 || output.result?.results?.length !== 2) {
    throw new Error(`El lote no se dividió en 100 + 1: ${JSON.stringify({ sizes, output })}`);
  }
}

async function runBridgeCase(argumentsList, expectedAction, inspectCommand) {
  const child = spawn(process.execPath, [script, ...argumentsList], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve) => child.once("exit", resolve));

  let wrongTarget;
  let delivered;
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    wrongTarget = await backgroundMessage("poll", { spreadsheetId: "another-spreadsheet", gid: "7" });
    delivered = await backgroundMessage("poll", { spreadsheetId: "test-spreadsheet", gid: "7" });
    if (delivered?.command?.action === expectedAction) break;
    await delay(50);
  }

  if (wrongTarget?.command !== null) throw new Error("El puente entregó un comando a otro documento");
  if (delivered?.command?.action !== expectedAction) {
    throw new Error(`El puente no entregó ${expectedAction}: ${JSON.stringify(delivered)}`);
  }
  inspectCommand?.(delivered.command);

  const resultResponse = await backgroundMessage("result", {
    id: delivered.command.id,
    ok: true,
    result: { action: expectedAction, accepted: true }
  });
  if (!resultResponse.ok) throw new Error("El puente rechazó el resultado");

  const exitCode = await exit;
  if (exitCode !== 0) throw new Error(stderr || `El comando terminó con código ${exitCode}`);
  const output = JSON.parse(stdout);
  if (!output.ok || output.result?.action !== expectedAction) {
    throw new Error(`El CLI no devolvió el resultado: ${stdout}`);
  }
}

async function runBlockedBridgeCase(name, prepare, expectedError) {
  prepare();
  const child = spawn(process.execPath, [script, "info", "--url", url, "--timeout", "5"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve) => child.once("exit", resolve));

  let blocked;
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    blocked = await backgroundMessage("poll", { spreadsheetId: "test-spreadsheet", gid: "7" });
    if (blocked?.accessBlocked) break;
    await delay(50);
  }

  if (!blocked?.accessBlocked || blocked.command !== null || !String(blocked.error || "").includes(expectedError)) {
    child.kill();
    throw new Error(`${name} no bloqueó el puente: ${JSON.stringify(blocked)}`);
  }
  const exitCode = await exit;
  if (exitCode === 0 || stdout) throw new Error(`${name} permitió completar el comando: ${stdout}`);
  const errorOutput = JSON.parse(stderr);
  if (errorOutput.ok !== false || !String(errorOutput.error || "").includes(expectedError)) {
    throw new Error(`${name} no devolvió el rechazo al skill: ${stderr}`);
  }
}

const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "sheets-bridge-test-"));
try {
  const valuesFile = path.join(tempDirectory, "values.json");
  const recordsFile = path.join(tempDirectory, "records.json");
  const largeRecordsFile = path.join(tempDirectory, "large-records.json");
  await writeFile(valuesFile, JSON.stringify([["C-1", "Limpieza"], ["C-2", "Entrega"]]), "utf8");
  await writeFile(recordsFile, JSON.stringify([
    { Código: "C-4", Nombre: "Auditoría" },
    { Código: "C-5", Nombre: "Soporte" }
  ]), "utf8");
  await writeFile(largeRecordsFile, JSON.stringify(Array.from({ length: 101 }, (_, index) => ({
    Código: `L-${index + 1}`,
    Nombre: `Registro ${index + 1}`
  }))), "utf8");

  await runCurrentCase();
  await runBridgeCase(["info", "--url", url, "--timeout", "5"], "info");
  await runBridgeCase([
    "list", "--url", url, "--sheet", "Servicios", "--where", "Estado=Activo",
    "--from-row", "3", "--limit", "25", "--timeout", "5"
  ], "list", (command) => {
    if (command.params.sheet !== "Servicios" || command.params.where?.Estado !== "Activo" || command.params.fromRow !== 3 || command.params.limit !== 25) {
      throw new Error(`El CLI alteró la consulta de registros: ${JSON.stringify(command)}`);
    }
  });
  await runBridgeCase([
    "inspect", "--url", url, "--range", "M2", "--timeout", "5"
  ], "inspect", (command) => {
    if (command.params.range !== "M2") throw new Error(`El CLI alteró la inspección: ${JSON.stringify(command)}`);
  });
  await runBridgeCase([
    "write", "--url", url, "--sheet", "Servicios", "--start", "B2", "--values-file", valuesFile, "--timeout", "5"
  ], "write", (command) => {
    if (command.params.start !== "B2" || command.params.sheet !== "Servicios" || command.params.values?.[1]?.[1] !== "Entrega") {
      throw new Error(`El CLI alteró la escritura: ${JSON.stringify(command)}`);
    }
  });
  await runBridgeCase([
    "append", "--url", url, "--sheet", "Servicios",
    "--set", "Código=C-3", "--set", "Nombre=Instalación", "--timeout", "5"
  ], "append", (command) => {
    if (command.params.sheet !== "Servicios" || command.params.record?.Código !== "C-3" || command.params.record?.Nombre !== "Instalación") {
      throw new Error(`El CLI alteró el registro para anexar: ${JSON.stringify(command)}`);
    }
  });
  await runBridgeCase([
    "append", "--url", url, "--sheet", "Servicios", "--records-file", recordsFile, "--timeout", "5"
  ], "append", (command) => {
    if (command.params.records?.length !== 2 || command.params.records?.[1]?.Código !== "C-5") {
      throw new Error(`El CLI alteró el lote de registros: ${JSON.stringify(command)}`);
    }
  });
  await runChunkedAppendCase(largeRecordsFile);
  await runBridgeCase([
    "update", "--url", url, "--sheet", "Servicios", "--row", "8",
    "--set", "Estado=", "--set", "Nombre=Seguimiento", "--timeout", "5"
  ], "update", (command) => {
    if (command.params.sheet !== "Servicios" || command.params.row !== 8 || command.params.changes?.Estado !== "" || command.params.changes?.Nombre !== "Seguimiento") {
      throw new Error(`El CLI alteró la actualización por columnas: ${JSON.stringify(command)}`);
    }
  });
  await runBridgeCase([
    "update", "--url", url, "--sheet", "Servicios", "--where", "Código=C-3",
    "--set", "Estado=Completado", "--timeout", "5"
  ], "update", (command) => {
    if (command.params.row !== undefined || command.params.where?.Código !== "C-3" || command.params.changes?.Estado !== "Completado") {
      throw new Error(`El CLI alteró la actualización por identificador: ${JSON.stringify(command)}`);
    }
  });
  await runBridgeCase([
    "clear", "--url", url, "--sheet", "Servicios", "--range", "B2:D10", "--timeout", "5"
  ], "clear", (command) => {
    if (command.params.range !== "B2:D10" || command.params.sheet !== "Servicios") {
      throw new Error(`El CLI alteró la limpieza: ${JSON.stringify(command)}`);
    }
  });

  await runBlockedBridgeCase("La sesión cerrada", () => {
    stored.delete("srd:cloud:auth-token");
  }, "Inicia sesión");

  await runBlockedBridgeCase("La suscripción vencida", () => {
    stored.set("srd:cloud:auth-token", "active-token");
    accountStatus = "active";
    accountExpired = true;
  }, "vencida");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log("BRIDGE_OK: descubrimiento activo, documento aislado, sesión obligatoria, consultas, lotes, actualización, escritura y limpieza confirmados.");
