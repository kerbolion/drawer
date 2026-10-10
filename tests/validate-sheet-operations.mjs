import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const chrome = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].find(existsSync);
if (!chrome) throw new Error("No se encontro Google Chrome");

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const pageWrite = await readFile(path.resolve(import.meta.dirname, "..", "page-write.js"), "utf8");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function page() {
  return `<!doctype html><html><body>
    <button id="docs-sheet-add-button" type="button">+</button>
    <div id="tabs"></div>
    <script>
      let nextGid = 1;
      const tabs = document.getElementById("tabs");
      function activate(tab) {
        document.querySelectorAll(".docs-sheet-tab").forEach(item => item.classList.remove("docs-sheet-active-tab"));
        tab.classList.add("docs-sheet-active-tab");
      }
      function addTab(name, gid = nextGid++) {
        const tab = document.createElement("div");
        tab.className = "docs-sheet-tab";
        tab.id = "sheet-button-" + gid;
        tab.dataset.gid = String(gid);
        const label = document.createElement("span");
        label.className = "docs-sheet-tab-name";
        label.textContent = name;
        label.addEventListener("click", () => activate(tab));
        const dropdown = document.createElement("button");
        dropdown.className = "docs-sheet-tab-dropdown";
        dropdown.type = "button";
        dropdown.addEventListener("click", () => openMenu(tab));
        tab.append(label, dropdown);
        tabs.appendChild(tab);
        activate(tab);
        return tab;
      }
      function closeOverlays() {
        document.querySelectorAll(".goog-menu, [role='dialog']").forEach(element => element.remove());
      }
      function dialog(title, confirmText, onConfirm, withInput = false) {
        const root = document.createElement("div");
        root.setAttribute("role", "dialog");
        root.appendChild(Object.assign(document.createElement("span"), { textContent: title }));
        const input = withInput ? document.createElement("input") : null;
        if (input) root.appendChild(input);
        const confirm = document.createElement("button");
        confirm.textContent = confirmText;
        confirm.addEventListener("click", () => { onConfirm(input?.value || ""); root.remove(); });
        root.appendChild(confirm);
        document.body.appendChild(root);
        input?.addEventListener("keydown", event => { if (event.key === "Enter") confirm.click(); });
        input?.focus();
      }
      function openMenu(tab) {
        closeOverlays();
        activate(tab);
        const menu = document.createElement("div");
        menu.className = "goog-menu";
        const rename = document.createElement("div");
        rename.className = "goog-menuitem";
        rename.textContent = "Cambiar nombre";
        rename.addEventListener("click", () => {
          menu.remove();
          dialog("Cambiar nombre", "Aceptar", value => { tab.querySelector(".docs-sheet-tab-name").textContent = value; }, true);
        });
        const remove = document.createElement("div");
        remove.className = "goog-menuitem";
        remove.textContent = "Eliminar hoja";
        remove.addEventListener("click", () => {
          menu.remove();
          dialog("Eliminar hoja", "Eliminar", () => tab.remove());
        });
        menu.append(rename, remove);
        document.body.appendChild(menu);
      }
      document.getElementById("docs-sheet-add-button").addEventListener("click", () => addTab("Hoja " + (nextGid + 1)));
      addTab("Contactos", 0);
    </script>
    <script src="/page-write.js"></script>
  </body></html>`;
}

const webPort = await freePort();
const server = http.createServer((request, response) => {
  if (request.url === "/page-write.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(pageWrite);
    return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(page());
});
await new Promise(resolve => server.listen(webPort, "127.0.0.1", resolve));

const debugPort = await freePort();
const profile = path.join(os.tmpdir(), `abrir-crm-sheet-operations-${process.pid}-${Date.now()}`);
const browser = spawn(chrome, [
  "--headless=new",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
  `http://127.0.0.1:${webPort}/spreadsheets/d/test-sheet/edit`
], { windowsHide: true, stdio: "ignore" });

async function target() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const found = (await response.json()).find(item => item.type === "page" && item.url.includes("test-sheet/edit"));
      if (found) return found;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome no abrió la prueba de operaciones de hojas");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    socket.addEventListener("open", () => resolve({
      evaluate(expression) {
        return new Promise((commandResolve, commandReject) => {
          const commandId = ++id;
          pending.set(commandId, { resolve: commandResolve, reject: commandReject });
          socket.send(JSON.stringify({ id: commandId, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
        });
      },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      const callbacks = pending.get(message.id);
      if (!callbacks) return;
      pending.delete(message.id);
      if (message.error || message.result?.exceptionDetails) {
        callbacks.reject(new Error(message.error?.message || message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
      } else callbacks.resolve(message.result?.result?.value);
    });
    socket.addEventListener("error", () => reject(new Error("No se pudo conectar con Chrome")));
  });
}

let cdp;
try {
  cdp = await connect((await target()).webSocketDebuggerUrl);
  await delay(500);
  const result = await cdp.evaluate(`(async () => {
    const readyDeadline = Date.now() + 5000;
    while (!window.__sheetsRowDrawerWriteBridge && Date.now() < readyDeadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (!window.__sheetsRowDrawerWriteBridge) return { setupError: "page-write.js no inició" };
    function operation(value) {
      return new Promise((resolve) => {
        const requestId = Math.random().toString(36);
        const timeout = setTimeout(() => {
          window.removeEventListener("message", receive);
          resolve({ ok: false, timeout: true, operation: value, html: document.body.innerHTML.slice(0, 4000) });
        }, 16000);
        function receive(event) {
          if (event.data?.type !== "sheet-operation-result" || event.data.requestId !== requestId) return;
          window.removeEventListener("message", receive);
          clearTimeout(timeout);
          resolve(event.data);
        }
        window.addEventListener("message", receive);
        window.postMessage({ source: "sheets-row-drawer", type: "sheet-operation", requestId, operation: value }, location.origin);
      });
    }
    const created = await operation({ action: "create_sheet", name: "Tareas" });
    const renamed = await operation({ action: "rename_sheet", sheet: "Tareas", name: "Pendientes" });
    const removed = await operation({ action: "delete_sheet", sheet: "Pendientes" });
    const rejected = await operation({ action: "delete_sheet", sheet: "Contactos" });
    return {
      created,
      renamed,
      removed,
      rejected,
      sheets: Array.from(document.querySelectorAll(".docs-sheet-tab-name"), node => node.textContent)
    };
  })()`);
  if (!result?.created?.ok || result.created.result?.name !== "Tareas") throw new Error(`No se creó la hoja: ${JSON.stringify(result)}`);
  if (!result?.renamed?.ok || result.renamed.result?.name !== "Pendientes") throw new Error(`No se renombró la hoja: ${JSON.stringify(result)}`);
  if (!result?.removed?.ok || result.rejected?.ok || JSON.stringify(result.sheets) !== JSON.stringify(["Contactos"])) {
    throw new Error(`La eliminación de hojas no respetó sus límites: ${JSON.stringify(result)}`);
  }
} finally {
  cdp?.close();
  browser.kill();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log("HOJAS_OK: creación, cambio de nombre, eliminación y protección de la última hoja confirmados.");
