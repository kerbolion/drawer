import { spawn, spawnSync } from "node:child_process";
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

const extensionDir = path.resolve(import.meta.dirname, "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const sheets = {
  Contactos: {
    headers: ["ID Contacto", "Nombre", "Edad"],
    rows: [["C-1", "Ana", "30"], ["C-2", "Luis", "44"]]
  },
  Servicios: {
    headers: ["ID Servicio", "ID Contacto", "Nombre"],
    rows: [["S-1", "C-1", "Limpieza"], ["S-2", "C-1", "Entrega"], ["S-3", "C-2", "Reparación"]]
  }
};
let delayContactRow = false;
let delayServicesTable = false;

function cells(values) {
  return values.map((value) => `<td>${value}</td>`).join("");
}

function waffle(sheet, rowNumber) {
  const values = rowNumber === 1 ? sheet.headers : (sheet.rows[rowNumber - 2] || []);
  return `<!doctype html><table><tbody><tr><th class="row-headers-background">${rowNumber}</th>${cells(values)}</tr></tbody></table>`;
}

function gviz(sheet) {
  return `<!doctype html><table><tr>${cells(sheet.headers)}</tr>${sheet.rows.map((row) => `<tr>${cells(row)}</tr>`).join("")}</table>`;
}

const webPort = await freePort();
const webServer = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${webPort}`);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.pathname.endsWith("/edit")) {
    response.end(`<!doctype html><html><body>
      <input id="t-name-box" value="A2">
      <div class="docs-sheet-tab docs-sheet-active-tab"><span class="docs-sheet-tab-name">Contactos</span></div>
      <div class="docs-sheet-tab"><span class="docs-sheet-tab-name">Servicios</span></div>
    </body></html>`);
    return;
  }
  if (url.pathname.endsWith("/htmlembed/sheet")) {
    const sheet = url.searchParams.get("gid") === "1" ? sheets.Servicios : sheets.Contactos;
    const rowNumber = Number(url.searchParams.get("range")?.match(/A(\d+)/)?.[1] || 1);
    const send = () => response.end(waffle(sheet, rowNumber));
    if (delayContactRow && sheet === sheets.Contactos && rowNumber === 2) setTimeout(send, 900);
    else send();
    return;
  }
  if (url.pathname.endsWith("/gviz/tq")) {
    const sheet = sheets[url.searchParams.get("sheet")] || { headers: [], rows: [] };
    const send = () => response.end(gviz(sheet));
    if (delayServicesTable && sheet === sheets.Servicios) setTimeout(send, 900);
    else send();
    return;
  }
  response.statusCode = 404;
  response.end("Not found");
});
await new Promise((resolve, reject) => webServer.listen(webPort, "127.0.0.1", resolve).once("error", reject));

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
        const result = await this.command("Runtime.evaluate", { expression, contextId, returnByValue: true, awaitPromise: true });
        return result?.value;
      },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const pendingCommand = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) pendingCommand.reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        pendingCommand.reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
      } else if (pendingCommand.method === "Runtime.evaluate") pendingCommand.resolve(message.result?.result);
      else pendingCommand.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("No se pudo conectar con Chrome")));
  });
}

async function waitForTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = list.find((item) => item.type === "page" && item.url.includes("/spreadsheets/d/test/edit"));
      if (page) return page;
    } catch {}
    await delay(200);
  }
  throw new Error("Chrome no abrio la hoja simulada");
}

const debugPort = await freePort();
const profileDir = path.join(os.tmpdir(), `sheets-relations-${process.pid}-${Date.now()}`);
const browser = spawn(chrome, [
  "--headless=new",
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
  `http://127.0.0.1:${webPort}/spreadsheets/d/test/edit#gid=0&range=A2`
], { stdio: "ignore", windowsHide: true });

let cdp;
try {
  const target = await waitForTarget(debugPort);
  cdp = await connect(target.webSocketDebuggerUrl);
  const frameTree = await cdp.command("Page.getFrameTree");
  const isolated = await cdp.command("Page.createIsolatedWorld", {
    frameId: frameTree.frameTree.frame.id,
    worldName: "relations-test",
    grantUniveralAccess: true
  });
  await cdp.evaluate(await readFile(path.join(extensionDir, "page-write.js"), "utf8"));
  await cdp.evaluate(await readFile(path.join(extensionDir, "content.js"), "utf8"), isolated.executionContextId);

  const snapshot = `(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
    return {
      row: host?.dataset.row || null,
      formStatus: panel?.querySelector(".status")?.textContent || "",
      relatedStatus: panel?.querySelector(".related-status")?.textContent || "",
      fields: panel ? Array.from(panel.querySelectorAll(".field input"), input => input.value) : [],
      relations: panel ? Array.from(panel.querySelectorAll(".relation"), relation => ({
        title: relation.querySelector(".relation-title")?.textContent || "",
        count: relation.querySelector(".relation-count")?.textContent || "",
        description: relation.querySelector(".relation-kind")?.textContent || "",
        cells: Array.from(relation.querySelectorAll("tbody td"), cell => cell.textContent)
      })) : []
    };
  })()`;

  async function waitForRelation(title) {
    const deadline = Date.now() + 12_000;
    let result;
    while (Date.now() < deadline) {
      result = await cdp.evaluate(snapshot);
      if (result.relations.some((relation) => relation.title === title)) return result;
      await delay(200);
    }
    throw new Error(`No aparecio la relacion ${title}: ${JSON.stringify(result)}`);
  }

  const fromContact = await waitForRelation("Servicios");
  const services = fromContact.relations.find((relation) => relation.title === "Servicios");
  if (services.count !== "2" || !services.cells.includes("S-1") || !services.cells.includes("S-2") || services.cells.includes("S-3")) {
    throw new Error(`Relacion Contactos -> Servicios incorrecta: ${JSON.stringify(services)}`);
  }

  await cdp.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll(".docs-sheet-tab"));
    tabs.forEach(tab => tab.classList.remove("docs-sheet-active-tab"));
    tabs.find(tab => tab.textContent.includes("Servicios")).classList.add("docs-sheet-active-tab");
    location.hash = "gid=1&range=A2";
    const box = document.getElementById("t-name-box");
    box.value = "A2";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  const fromService = await waitForRelation("Contactos");
  const contact = fromService.relations.find((relation) => relation.title === "Contactos");
  if (contact.count !== "1" || !contact.cells.includes("C-1") || !contact.cells.includes("Ana") || contact.cells.includes("Luis")) {
    throw new Error(`Relacion Servicios -> Contactos incorrecta: ${JSON.stringify(contact)}`);
  }

  sheets.Contactos.rows[0][1] = "Ana actualizada";
  sheets.Servicios.rows.push(["S-4", "C-1", "Instalación"]);
  delayContactRow = true;
  delayServicesTable = true;
  await cdp.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll(".docs-sheet-tab"));
    tabs.forEach(tab => tab.classList.remove("docs-sheet-active-tab"));
    tabs.find(tab => tab.textContent.includes("Contactos")).classList.add("docs-sheet-active-tab");
    location.hash = "gid=0&range=A2";
    const box = document.getElementById("t-name-box");
    box.value = "A2";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  const cacheDeadline = Date.now() + 800;
  let cachedSnapshot;
  while (Date.now() < cacheDeadline) {
    cachedSnapshot = await cdp.evaluate(snapshot);
    const cachedServices = cachedSnapshot.relations.find((relation) => relation.title === "Servicios");
    if (cachedSnapshot.formStatus.includes("caché") && cachedSnapshot.fields.includes("Ana") && cachedServices?.count === "2") break;
    await delay(50);
  }
  const cachedServices = cachedSnapshot?.relations.find((relation) => relation.title === "Servicios");
  if (!cachedSnapshot?.formStatus.includes("caché") || !cachedSnapshot.fields.includes("Ana") || cachedServices?.count !== "2") {
    throw new Error(`La caché no apareció antes de la red: ${JSON.stringify(cachedSnapshot)}`);
  }
  await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const age = panel.querySelectorAll(".field input")[2];
    age.value = "31";
    age.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  const refreshDeadline = Date.now() + 8_000;
  let refreshedSnapshot;
  while (Date.now() < refreshDeadline) {
    refreshedSnapshot = await cdp.evaluate(snapshot);
    const refreshedServices = refreshedSnapshot.relations.find((relation) => relation.title === "Servicios");
    if (refreshedSnapshot.fields.includes("Ana actualizada") && refreshedSnapshot.fields.includes("31") && refreshedServices?.count === "3") break;
    await delay(100);
  }
  const refreshedServices = refreshedSnapshot?.relations.find((relation) => relation.title === "Servicios");
  if (!refreshedSnapshot?.fields.includes("Ana actualizada") || !refreshedSnapshot?.fields.includes("31") || refreshedServices?.count !== "3") {
    throw new Error(`La actualización en segundo plano no reemplazó la caché: ${JSON.stringify(refreshedSnapshot)}`);
  }

  console.log("RELACIONES_OK: detección automática, caché inmediata y actualización en segundo plano confirmadas.");
} finally {
  cdp?.close();
  if (browser.pid) spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve) => webServer.close(resolve));
  await delay(500);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.toLowerCase().startsWith(tempRoot)) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
