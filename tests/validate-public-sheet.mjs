import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];
const chrome = chromeCandidates.find(existsSync);
if (!chrome) throw new Error("No se encontro Google Chrome");

const extensionDir = path.resolve(import.meta.dirname, "..");
const profileDir = path.join(os.tmpdir(), `sheets-probe-${process.pid}-${Date.now()}`);
const sheetUrl = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0&range=A2";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function waitForTarget(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const list = await targets(port);
      const page = list.find((item) => item.type === "page" && item.url.includes("docs.google.com/spreadsheets"));
      if (page) return page;
    } catch {}
    await delay(250);
  }
  throw new Error("Chrome no expuso la pestana de Sheets");
}

function connect(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let id = 0;
    socket.addEventListener("open", () => resolve({
      command(method, params = {}) {
        return new Promise((commandResolve, commandReject) => {
          const commandId = ++id;
          pending.set(commandId, { resolve: commandResolve, reject: commandReject, method });
          socket.send(JSON.stringify({ id: commandId, method, params }));
        });
      },
      async evaluate(expression, contextId) {
        const result = await this.command("Runtime.evaluate", {
          expression,
          contextId,
          returnByValue: true,
          awaitPromise: true
        });
        return result?.value;
      },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        const detail = message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text;
        callbacks.reject(new Error(detail));
      } else if (callbacks.method === "Runtime.evaluate") callbacks.resolve(message.result?.result);
      else callbacks.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("No se pudo conectar con Chrome")));
  });
}

const port = await freePort();
const browser = spawn(chrome, [
  "--headless=new",
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  `--remote-debugging-port=${port}`,
  "--remote-allow-origins=*",
  sheetUrl
], { stdio: "ignore", windowsHide: true });

let cdp;
try {
  const target = await waitForTarget(port);
  cdp = await connect(target.webSocketDebuggerUrl);
  const pageDeadline = Date.now() + 30_000;
  while (Date.now() < pageDeadline) {
    const ready = await cdp.evaluate(`Boolean(document.getElementById("t-name-box"))`);
    if (ready) break;
    await delay(250);
  }
  const frameTree = await cdp.command("Page.getFrameTree");
  const frameId = frameTree.frameTree.frame.id;
  const isolated = await cdp.command("Page.createIsolatedWorld", {
    frameId,
    worldName: "sheets-row-drawer-test",
    grantUniveralAccess: true
  });
  const writeScript = await readFile(path.join(extensionDir, "page-write.js"), "utf8");
  await cdp.evaluate(writeScript);
  const contentScript = await readFile(path.join(extensionDir, "content.js"), "utf8");
  await cdp.evaluate(contentScript, isolated.executionContextId);
  const deadline = Date.now() + 30_000;
  let result;
  while (Date.now() < deadline) {
    result = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
      return {
        exists: Boolean(host),
        status: host?.dataset.status || null,
        row: host?.dataset.row || null,
        fields: panel ? Array.from(panel.querySelectorAll(".field input"), input => input.value) : [] ,
        message: panel?.querySelector(".status")?.textContent || null,
        nameBox: document.getElementById("t-name-box")?.value || null
      };
    })()`);
    if (result?.status === "ok" || result?.status === "error") break;
    await delay(500);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result?.exists) throw new Error("La extension no se inyecto");
  if (result.status !== "ok") throw new Error(result.message || "La lectura no termino correctamente");
  if (result.row !== "2") throw new Error(`Se esperaba la fila 2 y se obtuvo ${result.row}`);
  if (!result.fields.includes("Alexandra")) throw new Error("La fila leida no contiene el valor esperado");

  const isolation = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const frame = host.shadowRoot.querySelector(".panel-frame");
    const input = frame.contentDocument.querySelector(".field input");
    let parentKeydowns = 0;
    let parentPastes = 0;
    const onKeydown = () => { parentKeydowns += 1; };
    const onPaste = () => { parentPastes += 1; };
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("paste", onPaste);
    input.focus();
    input.dispatchEvent(new frame.contentWindow.KeyboardEvent("keydown", {
      key: "v", code: "KeyV", ctrlKey: true, bubbles: true, composed: true
    }));
    const transfer = new frame.contentWindow.DataTransfer();
    transfer.setData("text/plain", "texto de prueba");
    input.dispatchEvent(new frame.contentWindow.ClipboardEvent("paste", {
      clipboardData: transfer, bubbles: true, composed: true
    }));
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("paste", onPaste);
    return { parentKeydowns, parentPastes, inputFocused: frame.contentDocument.activeElement === input };
  })()`);
  if (!isolation.inputFocused || isolation.parentKeydowns !== 0 || isolation.parentPastes !== 0) {
    throw new Error("El teclado del formulario no quedo aislado de Google Sheets");
  }

  await cdp.evaluate(`(() => {
    window.__probePaste = null;
    window.__probePasteCount = 0;
    document.addEventListener("paste", event => {
      window.__probePasteCount += 1;
      window.__probePaste = event.clipboardData?.getData("text/plain") || "";
    }, { capture: true, once: true });
  })()`);
  await cdp.evaluate(`window.postMessage({
    source: "sheets-row-drawer",
    type: "write-range",
    requestId: "automated-noop",
    reference: "A2",
    tsv: "Alexandra\\tFemale"
  }, location.origin)`, isolated.executionContextId);
  const pasteDeadline = Date.now() + 5_000;
  let pasted;
  while (Date.now() < pasteDeadline) {
    pasted = await cdp.evaluate("window.__probePaste");
    if (pasted !== null) break;
    await delay(100);
  }
  const pasteCount = await cdp.evaluate("window.__probePasteCount");
  if (pasted !== "Alexandra\tFemale" || pasteCount !== 1) {
    throw new Error("El puente no genero un unico pegado TSV horizontal");
  }

  await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    window.__probeFieldRoot = panel.querySelector(".fields");
    window.__probeFirstInput = panel.querySelector(".field input");
    window.__probeFieldMutations = 0;
    window.__probeFieldObserver = new MutationObserver(records => {
      window.__probeFieldMutations += records.filter(record => record.type === "childList").length;
    });
    window.__probeFieldObserver.observe(window.__probeFieldRoot, { childList: true });
  })()`);

  await cdp.evaluate(`(() => {
    const box = document.getElementById("t-name-box");
    box.focus();
    box.value = "A3";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
  })()`);
  const selectionDeadline = Date.now() + 10_000;
  while (Date.now() < selectionDeadline) {
    result = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
      return {
        status: host?.dataset.status || null,
        row: host?.dataset.row || null,
        fields: panel ? Array.from(panel.querySelectorAll(".field input"), input => input.value) : []
      };
    })()`);
    if (result?.status === "ok" && result?.row === "3") break;
    await delay(250);
  }
  if (result?.row !== "3" || !result.fields.includes("Andrew")) {
    throw new Error("El formulario no siguio automaticamente el cambio a la fila 3");
  }

  const stableRender = await cdp.evaluate(`(() => {
    const currentInput = window.__probeFieldRoot?.querySelector(".field input");
    window.__probeFieldObserver?.disconnect();
    return {
      sameInput: currentInput === window.__probeFirstInput,
      rootMutations: window.__probeFieldMutations
    };
  })()`);
  if (!stableRender.sameInput || stableRender.rootMutations !== 0) {
    throw new Error(`El cambio de fila reconstruyo el formulario: ${JSON.stringify(stableRender)}`);
  }

  console.log("VALIDACION_OK: lectura, cambio de fila sin rerender, foco aislado y pegado TSV unico confirmados.");
} finally {
  cdp?.close();
  if (browser.pid) spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  await delay(600);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.toLowerCase().startsWith(tempRoot)) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
