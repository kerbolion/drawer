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
if (!chrome) throw new Error("No se encontró Google Chrome");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
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
      async evaluate(expression) {
        const result = await this.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        return result?.value;
      },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const command = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) command.reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        command.reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
      } else if (command.method === "Runtime.evaluate") command.resolve(message.result?.result);
      else command.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("No se pudo conectar con Chrome")));
  });
}

async function waitForTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page" && target.url.includes("/spreadsheets/d/test/edit"));
      if (page) return page;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome no abrió la hoja simulada");
}

const webPort = await freePort();
const page = `<!doctype html><html><body>
  <button id="docs-sheet-add" type="button">Añadir hoja</button>
  <div id="tabs"></div>
  <script>
    const tabsHost = document.getElementById("tabs");
    let nextGid = 1;
    let generatedNumber = 2;

    function activate(tab) {
      for (const candidate of document.querySelectorAll(".docs-sheet-tab")) candidate.classList.remove("docs-sheet-active-tab");
      tab.classList.add("docs-sheet-active-tab");
    }

    function closeOverlays() {
      document.querySelectorAll(".goog-menu, [role='dialog']").forEach((node) => node.remove());
    }

    function dialog(action, tab) {
      closeOverlays();
      const overlay = document.createElement("div");
      overlay.setAttribute("role", "dialog");
      if (action === "rename") {
        const input = document.createElement("input");
        input.type = "text";
        input.value = tab.querySelector(".docs-sheet-tab-name").textContent;
        overlay.append(input);
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.textContent = "Aceptar";
        confirm.addEventListener("click", () => {
          tab.querySelector(".docs-sheet-tab-name").textContent = input.value;
          overlay.remove();
        });
        overlay.append(confirm);
      } else {
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.textContent = "Eliminar";
        confirm.addEventListener("click", () => {
          const active = tab.classList.contains("docs-sheet-active-tab");
          tab.remove();
          if (active) document.querySelector(".docs-sheet-tab")?.classList.add("docs-sheet-active-tab");
          overlay.remove();
        });
        overlay.append(confirm);
      }
      document.body.append(overlay);
    }

    function menu(tab) {
      closeOverlays();
      const menu = document.createElement("div");
      menu.className = "goog-menu";
      const rename = document.createElement("div");
      rename.className = "goog-menuitem";
      rename.setAttribute("role", "menuitem");
      rename.textContent = "Cambiar nombre";
      rename.addEventListener("click", () => dialog("rename", tab));
      const remove = document.createElement("div");
      remove.className = "goog-menuitem";
      remove.setAttribute("role", "menuitem");
      remove.textContent = "Eliminar";
      remove.addEventListener("click", () => dialog("delete", tab));
      menu.append(rename, remove);
      document.body.append(menu);
    }

    function addTab(name, active = false) {
      const tab = document.createElement("div");
      tab.className = "docs-sheet-tab";
      tab.id = "sheet-button-" + nextGid++;
      const label = document.createElement("span");
      label.className = "docs-sheet-tab-name";
      label.textContent = name;
      const dropdown = document.createElement("button");
      dropdown.type = "button";
      dropdown.className = "docs-sheet-tab-dropdown";
      dropdown.setAttribute("aria-haspopup", "menu");
      dropdown.textContent = "Menú";
      dropdown.addEventListener("click", (event) => {
        event.stopPropagation();
        menu(tab);
      });
      tab.addEventListener("click", () => activate(tab));
      tab.append(label, dropdown);
      tabsHost.append(tab);
      if (active) activate(tab);
      return tab;
    }

    addTab("Contactos", true);
    document.getElementById("docs-sheet-add").addEventListener("click", () => addTab("Hoja " + generatedNumber++, true));
  </script>
</body></html>`;

const webServer = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(page);
});
await new Promise((resolve, reject) => webServer.listen(webPort, "127.0.0.1", resolve).once("error", reject));

const debugPort = await freePort();
const profileDir = path.join(os.tmpdir(), `sheets-sheet-ops-${process.pid}-${Date.now()}`);
const browser = spawn(chrome, [
  "--headless=new",
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
  `http://127.0.0.1:${webPort}/spreadsheets/d/test/edit#gid=0`
], { stdio: "ignore", windowsHide: true });

let cdp;
try {
  const target = await waitForTarget(debugPort);
  cdp = await connect(target.webSocketDebuggerUrl);
  const readyDeadline = Date.now() + 10_000;
  while (Date.now() < readyDeadline) {
    if (await cdp.evaluate(`document.readyState !== "loading" && Boolean(document.getElementById("docs-sheet-add"))`)) break;
    await delay(50);
  }
  await cdp.evaluate(await readFile(path.resolve(import.meta.dirname, "..", "page-write.js"), "utf8"));

  const runOperation = (message) => cdp.evaluate(`new Promise((resolve) => {
    const requestId = ${JSON.stringify(message.requestId)};
    const receive = (event) => {
      if (event.data?.source !== "sheets-row-drawer" || event.data?.type !== "sheet-operation-result" || event.data?.requestId !== requestId) return;
      window.removeEventListener("message", receive);
      resolve(event.data);
    };
    window.addEventListener("message", receive);
    window.postMessage(${JSON.stringify({ source: "sheets-row-drawer", type: "sheet-operation", ...message })}, location.origin);
  })`);

  const created = await runOperation({ requestId: "create", operation: "create", name: "Proyectos" });
  if (!created.ok || created.result?.activeSheet !== "Proyectos" || created.result?.sheets?.join("|") !== "Contactos|Proyectos") {
    throw new Error(`La creación no quedó confirmada: ${JSON.stringify(created)}`);
  }

  const renamed = await runOperation({ requestId: "rename", operation: "rename", sheet: "Proyectos", name: "Oportunidades" });
  if (!renamed.ok || renamed.result?.activeSheet !== "Oportunidades" || renamed.result?.sheets?.join("|") !== "Contactos|Oportunidades") {
    throw new Error(`El cambio de nombre no quedó confirmado: ${JSON.stringify(renamed)}`);
  }

  const deleted = await runOperation({ requestId: "delete", operation: "delete", sheet: "Oportunidades" });
  if (!deleted.ok || deleted.result?.activeSheet !== "Contactos" || deleted.result?.sheets?.join("|") !== "Contactos") {
    throw new Error(`La eliminación no quedó confirmada: ${JSON.stringify(deleted)}`);
  }

  const protectedLastSheet = await runOperation({ requestId: "delete-last", operation: "delete", sheet: "Contactos" });
  if (protectedLastSheet.ok || !String(protectedLastSheet.error || "").includes("al menos una hoja")) {
    throw new Error(`Se permitió eliminar la última hoja: ${JSON.stringify(protectedLastSheet)}`);
  }
} finally {
  cdp?.close();
  browser.kill();
  await new Promise((resolve) => webServer.close(resolve));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profileDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await delay(250);
    }
  }
}

console.log("SHEET_OPERATIONS_OK: creación, cambio de nombre, eliminación y protección de la última hoja confirmados.");
