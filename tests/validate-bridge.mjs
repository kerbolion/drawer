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

function backgroundMessage(type, payload) {
  return new Promise((resolve, reject) => {
    const handled = backgroundListener(
      { source: "sheets-row-drawer-codex", type, payload },
      { url, tab: { id: 9, active: false, url } },
      resolve
    );
    if (!handled) reject(new Error(`El service worker no aceptó el mensaje ${type}`));
  });
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
  await writeFile(valuesFile, JSON.stringify([["C-1", "Limpieza"], ["C-2", "Entrega"]]), "utf8");

  await runBridgeCase(["info", "--url", url, "--timeout", "5"], "info");
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

console.log("BRIDGE_OK: documento aislado, sesión activa obligatoria, vencimiento, lectura, escritura y limpieza confirmados.");
