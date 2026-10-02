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
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sheet = {
  headers: ["ID Contacto", "Nombre", "Estado", "Fecha"],
  rows: [
    ["1", "Ana", "Nuevo", "02/10/2026"],
    ["2", "Luis", "En proceso", "15/10/2026"],
    ["3", "Mia", "", "02/11/2026"]
  ]
};

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function cells(values) {
  return values.map((value) => `<td>${value}</td>`).join("");
}

const webPort = await freePort();
const webServer = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${webPort}`);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.pathname.endsWith("/edit")) {
    response.end(`<!doctype html><html><body>
      <input id="t-name-box" value="A2">
      <div class="docs-sheet-tab docs-sheet-active-tab"><span class="docs-sheet-tab-name">Contactos</span></div>
      <script>
        globalThis.__lastPaste = null;
        document.addEventListener("paste", event => {
          globalThis.__lastPaste = {
            reference: document.getElementById("t-name-box").value,
            value: event.clipboardData?.getData("text/plain") || ""
          };
        }, true);
      </script>
    </body></html>`);
    return;
  }
  if (url.pathname.endsWith("/htmlembed/sheet")) {
    const rowNumber = Number(url.searchParams.get("range")?.match(/A(\d+)/)?.[1] || 1);
    const values = rowNumber === 1 ? sheet.headers : (sheet.rows[rowNumber - 2] || []);
    response.end(`<!doctype html><table><tbody><tr><th class="row-headers-background">${rowNumber}</th>${cells(values)}</tr></tbody></table>`);
    return;
  }
  if (url.pathname.endsWith("/gviz/tq")) {
    const range = url.searchParams.get("range") || "";
    const rowNumber = Number(range.match(/A(\d+)/)?.[1] || 1);
    const rows = /^A(\d+):ZZ\1$/.test(range)
      ? [rowNumber === 1 ? sheet.headers : (sheet.rows[rowNumber - 2] || [])]
      : [sheet.headers, ...sheet.rows];
    response.end(`<!doctype html><table>${rows.map((row) => `<tr>${cells(row)}</tr>`).join("")}</table>`);
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
      const current = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) current.reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) {
        current.reject(new Error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text));
      } else if (current.method === "Runtime.evaluate") current.resolve(message.result?.result);
      else current.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("No se pudo conectar con Chrome")));
  });
}

async function waitForTarget(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = list.find((item) => item.type === "page" && item.url.includes("/spreadsheets/d/views/edit"));
      if (page) return page;
    } catch {}
    await delay(200);
  }
  throw new Error("Chrome no abrio la hoja simulada");
}

const debugPort = await freePort();
const profileDir = path.join(os.tmpdir(), `sheets-views-${process.pid}-${Date.now()}`);
const browser = spawn(chrome, [
  "--headless=new",
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  "--remote-allow-origins=*",
  `http://127.0.0.1:${webPort}/spreadsheets/d/views/edit#gid=0&range=A2`
], { stdio: "ignore", windowsHide: true });

let cdp;
try {
  const target = await waitForTarget(debugPort);
  cdp = await connect(target.webSocketDebuggerUrl);
  const pageDeadline = Date.now() + 10_000;
  while (Date.now() < pageDeadline) {
    if (await cdp.evaluate('document.readyState !== "loading" && Boolean(document.getElementById("t-name-box"))')) break;
    await delay(100);
  }
  const frameTree = await cdp.command("Page.getFrameTree");
  const isolated = await cdp.command("Page.createIsolatedWorld", {
    frameId: frameTree.frameTree.frame.id,
    worldName: "views-test",
    grantUniveralAccess: true
  });
  await cdp.evaluate(await readFile(path.join(extensionDir, "page-write.js"), "utf8"));
  await cdp.evaluate(await readFile(path.join(extensionDir, "dist", "content.js"), "utf8"), isolated.executionContextId);
  const hostDeadline = Date.now() + 5_000;
  while (Date.now() < hostDeadline) {
    if (await cdp.evaluate('Boolean(document.getElementById("sheets-session-probe")?.shadowRoot?.querySelector(".reopen"))')) break;
    await delay(50);
  }
  if (!await cdp.evaluate('Boolean(document.getElementById("sheets-session-probe"))')) {
    throw new Error("El drawer no inicio en la prueba de vistas");
  }
  await cdp.evaluate(`document.getElementById("sheets-session-probe").shadowRoot.querySelector(".reopen").click()`);

  const panelExpression = (body) => `(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    ${body}
  })()`;
  const deadline = Date.now() + 10_000;
  let fieldCount = 0;
  while (Date.now() < deadline) {
    fieldCount = await cdp.evaluate(panelExpression('return panel.querySelectorAll(".field").length;'));
    if (fieldCount === 4) break;
    await delay(100);
  }
  if (fieldCount !== 4) {
    const diagnostics = await cdp.evaluate(panelExpression('return { status: panel.querySelector(".status")?.textContent, body: panel.body.textContent };'));
    throw new Error(`No cargaron los campos para probar vistas: ${JSON.stringify(diagnostics)}`);
  }

  const initialButtons = await cdp.evaluate(panelExpression('return panel.querySelectorAll("[data-sheet-view]").length;'));
  if (initialButtons !== 0) throw new Error(`Las vistas aparecieron sin tipos compatibles: ${initialButtons}`);

  async function configureColumn(column, type, options = "") {
    await cdp.evaluate(panelExpression(`
      panel.querySelector('[data-configure-column="${column}"]').click();
      const typeInput = panel.querySelector("#srd-property-type");
      typeInput.value = ${JSON.stringify(type)};
      typeInput.dispatchEvent(new Event("change", { bubbles: true }));
      const optionInput = panel.querySelector('[name="options"]');
      if (optionInput) optionInput.value = ${JSON.stringify(options)};
      panel.querySelector("#srd-property-form").requestSubmit();
    `));
    await delay(150);
  }

  await configureColumn(3, "status", "Nuevo\nEn proceso\nCerrado");
  const statusButtons = await cdp.evaluate(panelExpression(`return Array.from(panel.querySelectorAll("[data-sheet-view]"), button => button.dataset.sheetView);`));
  if (JSON.stringify(statusButtons) !== JSON.stringify(["kanban"])) {
    throw new Error(`La condicion de Kanban no se aplico: ${JSON.stringify(statusButtons)}`);
  }

  await configureColumn(4, "date");
  const viewButtons = await cdp.evaluate(panelExpression(`
    return {
      views: Array.from(panel.querySelectorAll("[data-sheet-view]"), button => button.dataset.sheetView),
      beforeCheck: panel.querySelector(".sheet-view-actions")?.nextElementSibling?.classList.contains("save-state") || false
    };
  `));
  if (JSON.stringify(viewButtons.views) !== JSON.stringify(["kanban", "calendar"]) || !viewButtons.beforeCheck) {
    throw new Error(`Los botones no quedaron antes de la validacion: ${JSON.stringify(viewButtons)}`);
  }

  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=kanban]").click();'));
  const kanbanDeadline = Date.now() + 5_000;
  let kanban;
  while (Date.now() < kanbanDeadline) {
    kanban = await cdp.evaluate(panelExpression(`
      const drawer = panel.querySelector(".sheet-view-drawer");
      return {
        title: drawer?.querySelector(".ant-drawer-title")?.textContent || "",
        groups: Array.from(drawer?.querySelectorAll("[data-kanban-group]") || [], group => ({
          id: group.dataset.kanbanGroup,
          count: Number(group.querySelector(".kanban-count")?.textContent || 0)
        })),
        rows: Array.from(drawer?.querySelectorAll(".kanban-card-shell") || [], card => card.dataset.sheetRow)
      };
    `));
    if (kanban.rows?.length === 3) break;
    await delay(100);
  }
  if (!kanban.title.includes("Kanban") || kanban.rows.length !== 3 || kanban.groups[0]?.id !== "__empty__" || !kanban.groups.some((group) => group.id === "Nuevo" && group.count === 1) || !kanban.groups.some((group) => group.id === "__empty__" && group.count === 1)) {
    throw new Error(`Kanban no represento toda la hoja: ${JSON.stringify(kanban)}`);
  }

  await cdp.evaluate(panelExpression('panel.querySelector("[data-kanban-expand]").click();'));
  await delay(250);
  let expanded = await cdp.evaluate(`(() => {
    const root = document.getElementById("sheets-session-probe").shadowRoot;
    const panel = root.querySelector(".panel-frame").contentDocument;
    return {
      frame: root.querySelector(".panel-frame").classList.contains("is-sheet-view-expanded"),
      drawer: panel.querySelector(".sheet-view-drawer-root")?.classList.contains("is-expanded") || false,
      action: panel.querySelector("[data-kanban-expand]")?.getAttribute("aria-label") || ""
    };
  })()`);
  if (!expanded.frame || !expanded.drawer || expanded.action !== "Restaurar") {
    throw new Error(`Kanban no se amplio a todo el sitio: ${JSON.stringify(expanded)}`);
  }

  await cdp.evaluate(panelExpression('panel.querySelector(".sheet-view-drawer .ant-drawer-close").click();'));
  await delay(250);
  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=kanban]").click();'));
  const reopenedDeadline = Date.now() + 5_000;
  while (Date.now() < reopenedDeadline) {
    expanded = await cdp.evaluate(`(() => {
      const root = document.getElementById("sheets-session-probe").shadowRoot;
      const panel = root.querySelector(".panel-frame").contentDocument;
      return {
        frame: root.querySelector(".panel-frame").classList.contains("is-sheet-view-expanded"),
        action: panel.querySelector("[data-kanban-expand]")?.getAttribute("aria-label") || "",
        rows: panel.querySelectorAll(".sheet-view-drawer .kanban-card-shell:not(.kanban-card-overlay)").length
      };
    })()`);
    if (expanded.frame && expanded.action === "Restaurar" && expanded.rows === 3) break;
    await delay(100);
  }
  if (!expanded.frame || expanded.action !== "Restaurar" || expanded.rows !== 3) {
    throw new Error(`El modo ampliado de Kanban no persistio al reabrir: ${JSON.stringify(expanded)}`);
  }
  await delay(250);

  const dragPoint = await cdp.evaluate(`(() => {
    const frame = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame");
    const frameRect = frame.getBoundingClientRect();
    const panel = frame.contentDocument;
    const card = panel.querySelector('.kanban-card-shell[data-sheet-row="2"]');
    const target = Array.from(panel.querySelectorAll("[data-kanban-group]")).find(group => group.dataset.kanbanGroup === "En proceso");
    const start = card.getBoundingClientRect();
    const end = target.getBoundingClientRect();
    return {
      startX: frameRect.left + start.left + start.width / 2,
      startY: frameRect.top + start.top + start.height / 2,
      endX: frameRect.left + end.left + end.width / 2,
      endY: frameRect.top + end.top + Math.min(120, end.height / 2),
      frameLeft: frameRect.left,
      frameWidth: frameRect.width,
      viewportWidth: innerWidth,
      cardLeft: start.left,
      targetLeft: end.left
    };
  })()`);
  await cdp.command("Input.dispatchMouseEvent", {
    type: "mousePressed", x: dragPoint.startX, y: dragPoint.startY, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.command("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: dragPoint.startX + 12, y: dragPoint.startY + 4, button: "left", buttons: 1
  });
  await delay(120);
  const dragVisual = await cdp.evaluate(panelExpression(`return {
    overlay: Boolean(panel.querySelector("[data-drag-overlay]")),
    source: Array.from(panel.querySelectorAll('.kanban-card-shell[data-sheet-row="2"]')).some(card => card.classList.contains("is-dragging")),
    classes: Array.from(panel.querySelectorAll('.kanban-card-shell[data-sheet-row="2"]'), card => card.className),
    drawers: panel.querySelectorAll(".sheet-view-drawer").length
  };`));
  if (!dragVisual.overlay) {
    throw new Error(`Kanban no mostro la animacion de arrastre: ${JSON.stringify(dragVisual)}`);
  }
  await cdp.command("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: dragPoint.endX, y: dragPoint.endY, button: "left", buttons: 1
  });
  await delay(100);
  const dragTarget = await cdp.evaluate(panelExpression(`return Array.from(panel.querySelectorAll("[data-kanban-group]"), group => ({
    id: group.dataset.kanbanGroup,
    active: group.classList.contains("is-drag-over")
  }));`));
  if (!dragTarget.some((group) => group.id === "En proceso" && group.active)) {
    throw new Error(`Kanban no detecto la columna de destino: ${JSON.stringify({ dragPoint, dragTarget })}`);
  }
  await cdp.command("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: dragPoint.endX, y: dragPoint.endY, button: "left", buttons: 0, clickCount: 1
  });
  const pasteDeadline = Date.now() + 4_000;
  let paste;
  while (Date.now() < pasteDeadline) {
    paste = await cdp.evaluate("globalThis.__lastPaste");
    if (paste) break;
    await delay(50);
  }
  if (!paste?.reference.endsWith("!C2") || paste.value !== "En proceso") {
    throw new Error(`Kanban no escribio solo el Estado: ${JSON.stringify(paste)}`);
  }
  sheet.rows[0][2] = "En proceso";
  const verificationDeadline = Date.now() + 6_000;
  while (Date.now() < verificationDeadline) {
    const verification = await cdp.evaluate('document.getElementById("sheets-session-probe").dataset.writeVerification');
    if (verification === "verified") break;
    if (verification === "failed") throw new Error("La escritura de Kanban no se verifico");
    await delay(100);
  }

  await cdp.evaluate(panelExpression('panel.querySelector(\'.kanban-card-shell[data-sheet-row="3"]\').click();'));
  const rowDeadline = Date.now() + 5_000;
  let selected;
  while (Date.now() < rowDeadline) {
    selected = await cdp.evaluate(`({ box: document.getElementById("t-name-box").value, row: document.getElementById("sheets-session-probe").dataset.row })`);
    if (selected.box === "A3" && selected.row === "3") break;
    await delay(100);
  }
  if (selected?.box !== "A3" || selected.row !== "3") {
    throw new Error(`La tarjeta no abrio su fila: ${JSON.stringify(selected)}`);
  }

  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=calendar]").click();'));
  const calendarDeadline = Date.now() + 5_000;
  let calendar;
  while (Date.now() < calendarDeadline) {
    calendar = await cdp.evaluate(panelExpression(`
      const drawer = panel.querySelector(".sheet-view-drawer");
      return {
        title: drawer?.querySelector(".ant-drawer-title")?.textContent || "",
        month: drawer?.querySelector(".month-controls strong")?.textContent || "",
        weekdays: Array.from(drawer?.querySelectorAll(".calendar-weekday") || [], day => day.textContent),
        rows: Array.from(drawer?.querySelectorAll(".calendar-item") || [], item => item.dataset.sheetRow)
      };
    `));
    if (calendar.rows?.length === 3) break;
    await delay(100);
  }
  if (!calendar.title.includes("Calendario") || calendar.month !== "octubre 2026" || calendar.weekdays.join("") !== "LunMarMiéJueVieSábDom" || JSON.stringify(calendar.rows) !== JSON.stringify(["2", "3", "4"])) {
    throw new Error(`Calendario no siguio el patron de Workspace: ${JSON.stringify(calendar)}`);
  }

  await cdp.evaluate(panelExpression('panel.querySelector(\'.calendar-item[data-sheet-row="2"]\').click();'));
  const calendarRowDeadline = Date.now() + 5_000;
  while (Date.now() < calendarRowDeadline) {
    selected = await cdp.evaluate(`({ box: document.getElementById("t-name-box").value, row: document.getElementById("sheets-session-probe").dataset.row })`);
    if (selected.box === "A2" && selected.row === "2") break;
    await delay(100);
  }
  if (selected?.box !== "A2" || selected.row !== "2") {
    throw new Error(`El evento no abrio su fila: ${JSON.stringify(selected)}`);
  }

  console.log("VISTAS_OK: condiciones, Kanban, arrastre, Calendario y apertura de filas confirmados.");
} finally {
  cdp?.close();
  if (browser.pid) spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve) => webServer.close(resolve));
  await delay(300);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
  const resolvedProfile = path.resolve(profileDir);
  if (resolvedProfile.toLowerCase().startsWith(tempRoot)) {
    await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
