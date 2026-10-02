import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const script = path.resolve(import.meta.dirname, "..", "skills", "google-sheets-browser", "scripts", "sheets.mjs");
const url = "https://docs.google.com/spreadsheets/d/test-spreadsheet/edit#gid=7";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const backgroundSource = await readFile(path.resolve(import.meta.dirname, "..", "background.js"), "utf8");
let backgroundListener;
vm.runInNewContext(backgroundSource, {
  AbortController,
  clearTimeout,
  fetch,
  setTimeout,
  chrome: {
    runtime: {
      getManifest: () => ({ version: "test" }),
      onMessage: { addListener: (listener) => { backgroundListener = listener; } }
    }
  }
}, { filename: "background.js" });

function backgroundMessage(type, payload) {
  return new Promise((resolve, reject) => {
    const handled = backgroundListener(
      { source: "sheets-row-drawer-codex", type, payload },
      { tab: { id: 9, active: true } },
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

const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "sheets-bridge-test-"));
try {
  const valuesFile = path.join(tempDirectory, "values.json");
  await writeFile(valuesFile, JSON.stringify([["C-1", "Limpieza"], ["C-2", "Entrega"]]), "utf8");

  await runBridgeCase(["info", "--url", url, "--timeout", "5"], "info");
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
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log("BRIDGE_OK: documento aislado, service worker, lectura de valores, escritura y limpieza confirmados.");
