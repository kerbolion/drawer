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

const extensionDir = path.resolve(import.meta.dirname, "..", "dist-extension");
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
    headers: ["ID Servicio", "ID Contacto", "Nombre", "Nota", "Dato 1", "Dato 2"],
    rows: [
      ["S-1", "C-1", "Limpieza", "Inicial", "A", "B"],
      ["S-2", "C-1", "Entrega", "", "C", "D"],
      ["S-3", "C-2", "Reparación", "", "E", "F"]
    ]
  }
};
let delayContactRow = false;
let delayServicesTable = false;
let visualServiceCheckbox = null;

function cells(values, checkboxIndex = -1) {
  return values.map((value, index) => index === checkboxIndex
    ? `<td><svg><use href="#${visualServiceCheckbox ? "checked" : "unchecked"}-checkbox-id"></use></svg></td>`
    : `<td>${value}</td>`
  ).join("");
}

function waffle(sheet, rowNumber) {
  const values = rowNumber === 1 ? sheet.headers : (sheet.rows[rowNumber - 2] || []);
  const checkboxIndex = sheet === sheets.Servicios && rowNumber === 2 && visualServiceCheckbox !== null ? 2 : -1;
  return `<!doctype html><table><tbody><tr><th class="row-headers-background">${rowNumber}</th>${cells(values, checkboxIndex)}</tr></tbody></table>`;
}

function gviz(sheet, rowNumber = null) {
  const rows = rowNumber === null
    ? [sheet.headers, ...sheet.rows]
    : [rowNumber === 1 ? sheet.headers : (sheet.rows[rowNumber - 2] || [])];
  return `<!doctype html><table>${rows.map((row) => `<tr>${cells(row)}</tr>`).join("")}</table>`;
}

function gvizJson(sheet, rowNumber) {
  const values = rowNumber === 1 ? sheet.headers : (sheet.rows[rowNumber - 2] || []);
  const checkboxIndex = sheet === sheets.Servicios && rowNumber === 2 && visualServiceCheckbox !== null ? 2 : -1;
  const table = {
    cols: sheet.headers.map((_, index) => ({
      id: String.fromCharCode(65 + index),
      label: "",
      type: index === checkboxIndex ? "boolean" : "string"
    })),
    rows: [{ c: sheet.headers.map((_, index) => {
      if (index === checkboxIndex) return { v: visualServiceCheckbox };
      const value = values[index];
      return value === "" || value === null || value === undefined ? null : { v: String(value) };
    }) }]
  };
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify({ version: "0.6", status: "ok", table })});`;
}

const webPort = await freePort();
const webServer = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${webPort}`);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.pathname.endsWith("/edit")) {
    response.end(`<!doctype html><html><body>
      <input id="t-name-box" value="A2">
      <div id="docs-save-indicator-badge" aria-label="Estado del documento: Guardado en Drive" data-tooltip="Ver estado del documento">
        <div class="docs-save-indicator">
          <div id="docs-save-indicator-id"><div class="docs-icon-img docs-save-20"></div></div>
          <div class="docs-save-indicator-caption">Guardado en Drive</div>
        </div>
      </div>
      <div class="docs-sheet-tab docs-sheet-active-tab" id="sheet-button-0"><span class="docs-sheet-tab-name">Contactos</span></div>
      <div class="docs-sheet-tab" id="sheet-button-1"><span class="docs-sheet-tab-name">Servicios</span></div>
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
    const output = url.searchParams.get("tqx") || "";
    const rowNumber = Number(url.searchParams.get("range")?.match(/A(\d+)/)?.[1] || 1);
    const send = () => {
      if (output.includes("out:json")) {
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.end(gvizJson(sheet, rowNumber));
      } else {
        const requestedRange = url.searchParams.get("range") || "";
        const singleRow = /^A(\d+):ZZ\1$/.test(requestedRange) ? rowNumber : null;
        response.end(gviz(sheet, singleRow));
      }
    };
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
  const pageDeadline = Date.now() + 12_000;
  let pageReady = false;
  while (Date.now() < pageDeadline) {
    pageReady = await cdp.evaluate(`document.readyState !== "loading" && Boolean(document.getElementById("t-name-box"))`);
    if (pageReady) break;
    await delay(100);
  }
  if (!pageReady) throw new Error("La hoja simulada no terminÃ³ de cargar");
  const frameTree = await cdp.command("Page.getFrameTree");
  const isolated = await cdp.command("Page.createIsolatedWorld", {
    frameId: frameTree.frameTree.frame.id,
    worldName: "relations-test",
    grantUniveralAccess: true
  });
  await cdp.evaluate(await readFile(path.join(extensionDir, "page-write.js"), "utf8"));
  await cdp.evaluate(`(() => {
    globalThis.__codexNamedBridgeTest = { delivered: false, result: null };
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          if (message?.source !== "sheets-row-drawer-codex") return callback(null);
          if (message.type === "poll") {
            if (globalThis.__codexNamedBridgeTest.delivered) return callback({ command: null });
            globalThis.__codexNamedBridgeTest.delivered = true;
            return callback({
              command: {
                id: "named-sheet-read-test",
                action: "read",
                params: { gid: "0", sheet: "Servicios", range: "A1:F4" }
              }
            });
          }
          if (message.type === "result") {
            globalThis.__codexNamedBridgeTest.result = message.payload;
            return callback({ ok: true });
          }
          callback(null);
        }
      }
    };
  })()`, isolated.executionContextId);
  await cdp.evaluate(await readFile(path.join(extensionDir, "dist", "content.js"), "utf8"), isolated.executionContextId);

  const drawerStartup = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const frame = host.shadowRoot.querySelector(".panel-frame");
    const initiallyHidden = frame.hidden;
    host.shadowRoot.querySelector(".reopen").click();
    return { initiallyHidden, opened: !frame.hidden };
  })()`);
  if (!drawerStartup.initiallyHidden || !drawerStartup.opened) {
    throw new Error(`El drawer no respetó el inicio cerrado: ${JSON.stringify(drawerStartup)}`);
  }

  const headerLayout = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const header = panel.querySelector(".drawer > header");
    return {
      alignItems: panel.defaultView.getComputedStyle(header).alignItems,
      title: header.querySelector(".drawer-title h1")?.textContent || "",
      byline: header.querySelector(".drawer-title p")?.textContent || "",
      href: header.querySelector(".drawer-title a")?.href || ""
    };
  })()`);
  if (headerLayout.alignItems !== "center" || headerLayout.title !== "Abrir CRM" || headerLayout.byline !== "By Kodelr" || headerLayout.href !== "https://kodelr.com/") {
    throw new Error(`El encabezado no siguió el patrón centrado de MinimalBuilder: ${JSON.stringify(headerLayout)}`);
  }

  const snapshot = `(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
    return {
      row: host?.dataset.row || null,
      formStatus: panel?.querySelector(".status")?.textContent || "",
      formStatusHidden: panel?.querySelector(".status")?.hidden ?? false,
      relatedStatus: panel?.querySelector(".related-status")?.textContent || "",
      relatedStatusHidden: panel?.querySelector(".related-status")?.hidden ?? false,
      saveState: host?.dataset.saveState || null,
      fields: panel ? Array.from(panel.querySelectorAll(".field [data-column]"), input => input.dataset.serializedValue || "") : [],
      relations: panel ? Array.from(panel.querySelectorAll(".relation"), relation => ({
        title: relation.querySelector(".relation-title")?.textContent || "",
        count: relation.querySelector(".relation-count")?.textContent || "",
        description: relation.querySelector(".relation-kind")?.textContent || "",
        view: relation.dataset.relationView || "",
        cells: Array.from(relation.querySelectorAll("[data-relation-cell]"), cell => cell.textContent)
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

  const namedBridgeDeadline = Date.now() + 8_000;
  let namedBridgeResult;
  while (Date.now() < namedBridgeDeadline) {
    namedBridgeResult = await cdp.evaluate("globalThis.__codexNamedBridgeTest.result", isolated.executionContextId);
    if (namedBridgeResult) break;
    await delay(100);
  }
  if (!namedBridgeResult?.ok
    || namedBridgeResult.result?.rows?.[0]?.values?.[0] !== "ID Servicio"
    || namedBridgeResult.result?.rows?.[0]?.values?.[1] !== "ID Contacto"
    || namedBridgeResult.result?.rows?.[1]?.values?.[2] !== "Limpieza") {
    throw new Error(`La lectura por nombre perdió encabezados o datos: ${JSON.stringify(namedBridgeResult)}`);
  }

  async function clickPanelNode(selector) {
    const point = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const frame = host.shadowRoot.querySelector(".panel-frame");
      const nodes = frame.contentDocument.querySelectorAll(${JSON.stringify(selector)});
      const node = nodes[nodes.length - 1];
      if (!node) return null;
      const frameRect = frame.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      return {
        x: frameRect.left + nodeRect.left + nodeRect.width / 2,
        y: frameRect.top + nodeRect.top + nodeRect.height / 2
      };
    })()`);
    if (!point) throw new Error(`No se encontrÃ³ el control ${selector}`);
    await cdp.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    return point;
  }

  async function waitForPanelPopup(selector, expectedText = "") {
    const deadline = Date.now() + 2_000;
    let popup;
    while (Date.now() < deadline) {
      popup = await cdp.evaluate(`(() => {
        const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
        const nodes = panel.querySelectorAll(${JSON.stringify(selector)});
        const node = nodes[nodes.length - 1];
        if (!node) return { visible: false, text: "" };
        const rect = node.getBoundingClientRect();
        const style = panel.defaultView.getComputedStyle(node);
        const visible = rect.width > 0 && rect.height > 0 && rect.left > -rect.width && rect.top > -rect.height && style.visibility !== "hidden";
        return { visible, text: node.textContent || "", rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      })()`);
      if (popup.visible && (!expectedText || popup.text.includes(expectedText))) {
        await delay(120);
        return popup;
      }
      await delay(50);
    }
    throw new Error(`No se abriÃ³ ${selector}: ${JSON.stringify(popup)}`);
  }

  async function closePanelPopup() {
    await cdp.command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await delay(80);
  }

  async function waitForWriteVerification(timeoutMs = 6_000) {
    const deadline = Date.now() + timeoutMs;
    let verification = "";
    let sawPending = false;
    while (Date.now() < deadline) {
      verification = await cdp.evaluate('document.getElementById("sheets-session-probe")?.dataset.writeVerification || ""');
      if (verification === "pending") sawPending = true;
      if (verification === "verified" && sawPending) return verification;
      if (verification === "failed") break;
      await delay(100);
    }
    throw new Error(`La escritura no se confirmó: ${verification}`);
  }

  async function configureColumn3(type, options = "") {
    await cdp.evaluate(`(() => {
      const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
      panel.querySelector('[data-configure-column="3"]').click();
      const typeSelect = panel.querySelector("#srd-property-type");
      typeSelect.value = ${JSON.stringify(type)};
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      const optionInput = panel.querySelector('[name="options"]');
      if (optionInput) optionInput.value = ${JSON.stringify(options)};
      panel.querySelector("#srd-property-form").requestSubmit();
    })()`);
  }

  const fromContact = await waitForRelation("Servicios");
  const services = fromContact.relations.find((relation) => relation.title === "Servicios");
  if (services.count !== "2" || !services.cells.includes("S-1") || !services.cells.includes("S-2") || services.cells.includes("S-3")) {
    throw new Error(`Relacion Contactos -> Servicios incorrecta: ${JSON.stringify(services)}`);
  }

  const setMockSaveState = async (saving) => {
    const label = saving ? "Estado temporal desconocido" : "Estado final desconocido";
    const iconClass = saving ? "docs-sync-20" : "docs-save-20";
    await cdp.evaluate(`(() => {
      const badge = document.getElementById("docs-save-indicator-badge");
      const icon = document.querySelector("#docs-save-indicator-id .docs-icon-img");
      const caption = badge.querySelector(".docs-save-indicator-caption");
      badge.setAttribute("aria-label", ${JSON.stringify(`Estado del documento: ${label}`)});
      icon.className = ${JSON.stringify(`docs-icon-img ${iconClass}`)};
      caption.textContent = ${JSON.stringify(label)};
    })()`);
    await delay(40);
  };

  sheets.Contactos.rows[0][1] = "Ana en vivo";
  await cdp.evaluate(`document.body.dispatchEvent(new Event("input", { bubbles: true }))`);
  await delay(350);
  const beforeSave = await cdp.evaluate(snapshot);
  if (beforeSave.fields.includes("Ana en vivo")) {
    throw new Error(`El drawer leyó el cambio antes de que Sheets iniciara el guardado: ${JSON.stringify(beforeSave)}`);
  }
  await setMockSaveState(true);
  const liveUpdateDeadline = Date.now() + 6_000;
  let liveUpdate;
  while (Date.now() < liveUpdateDeadline) {
    liveUpdate = await cdp.evaluate(snapshot);
    if (liveUpdate.fields.includes("Ana en vivo")) break;
    await delay(100);
  }
  if (!liveUpdate?.fields.includes("Ana en vivo")) {
    throw new Error(`El drawer no leyó el cambio al comenzar el guardado de Sheets: ${JSON.stringify(liveUpdate)}`);
  }
  await setMockSaveState(false);

  sheets.Contactos.rows[0][1] = "Ana";
  await cdp.evaluate(`document.body.dispatchEvent(new Event("input", { bubbles: true }))`);
  await setMockSaveState(true);
  const liveRestoreDeadline = Date.now() + 6_000;
  while (Date.now() < liveRestoreDeadline) {
    liveUpdate = await cdp.evaluate(snapshot);
    if (liveUpdate.fields.includes("Ana")) break;
    await delay(100);
  }
  if (!liveUpdate?.fields.includes("Ana")) {
    throw new Error(`El drawer no confirmó la segunda edición de la misma fila: ${JSON.stringify(liveUpdate)}`);
  }
  await setMockSaveState(false);

  const relationDeck = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const relation = Array.from(panel.querySelectorAll(".relation")).find(item => item.querySelector(".relation-title")?.textContent === "Servicios");
    const tableOption = Array.from(relation?.querySelectorAll(".ant-segmented-item") || []).find(item => item.textContent.includes("Tabla"));
    const result = {
      view: relation?.dataset.relationView,
      cards: relation?.querySelectorAll(".related-record-card").length || 0,
      hasDeckOption: Boolean(Array.from(relation?.querySelectorAll(".ant-segmented-item") || []).find(item => item.textContent.includes("Deck"))),
      hasTableOption: Boolean(tableOption)
    };
    tableOption?.click();
    return result;
  })()`);
  await delay(100);
  const relationTable = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const relation = Array.from(panel.querySelectorAll(".relation")).find(item => item.querySelector(".relation-title")?.textContent === "Servicios");
    const main = panel.querySelector(".drawer > main");
    const tableScroll = relation?.querySelector(".related-table-scroll");
    return {
      view: relation?.dataset.relationView,
      tableCells: Array.from(relation?.querySelectorAll("tbody td") || [], cell => {
        const input = cell.querySelector("input, textarea");
        return input ? input.value : cell.textContent;
      }),
      drawerHasHorizontalScroll: main ? main.scrollWidth > main.clientWidth + 1 : true,
      tableHasHorizontalScroll: tableScroll ? tableScroll.scrollWidth > tableScroll.clientWidth + 1 : false
    };
  })()`);
  if (relationDeck.view !== "deck" || relationDeck.cards !== 2 || !relationDeck.hasDeckOption || !relationDeck.hasTableOption || relationTable.view !== "table" || !relationTable.tableCells.includes("S-1") || relationTable.drawerHasHorizontalScroll || !relationTable.tableHasHorizontalScroll) {
    throw new Error(`Las vistas Deck/Tabla no funcionan: ${JSON.stringify({ relationDeck, relationTable })}`);
  }

  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const relation = Array.from(panel.querySelectorAll(".relation")).find(item => item.querySelector(".relation-title")?.textContent === "Servicios");
    Array.from(relation.querySelectorAll(".ant-segmented-item")).find(item => item.textContent.includes("Deck"))?.click();
  })()`);
  await delay(120);
  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const card = panel.querySelector('.relation[data-relation-view="deck"] .related-record-card');
    card?.dispatchEvent(new panel.defaultView.MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
  })()`);
  const relatedDrawerDeadline = Date.now() + 3_000;
  let relatedDrawer;
  while (Date.now() < relatedDrawerDeadline) {
    relatedDrawer = await cdp.evaluate(`(() => {
      const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
      const drawer = panel.querySelector(".related-record-drawer");
      return {
        open: Boolean(drawer),
        title: drawer?.querySelector(".ant-drawer-title")?.textContent || "",
        recordTitle: drawer?.querySelector(".related-drawer-title")?.textContent || "",
        values: Array.from(drawer?.querySelectorAll(".related-cell-editor input, .related-cell-editor textarea") || [], input => input.value),
        width: drawer ? Math.round(drawer.getBoundingClientRect().width) : 0
      };
    })()`);
    if (relatedDrawer.open && relatedDrawer.values.includes("S-1")) break;
    await delay(100);
  }
  if (!relatedDrawer?.open || !relatedDrawer.title.includes("Servicios") || relatedDrawer.recordTitle !== "S-1" || !relatedDrawer.values.includes("Limpieza") || relatedDrawer.width < 680) {
    throw new Error(`El registro Deck no abrió el drawer de Workspace: ${JSON.stringify(relatedDrawer)}`);
  }

  const relatedPropertyEditor = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const relatedDrawer = panel.querySelector(".related-record-drawer");
    const relatedRoot = panel.querySelector(".related-record-drawer-root");
    relatedDrawer.querySelector('[data-configure-related-column="5"]').click();
    const propertyDrawer = panel.querySelector(".property-drawer");
    return {
      open: !propertyDrawer.hidden,
      source: propertyDrawer.querySelector(".property-source")?.textContent || "",
      propertyZIndex: Number(getComputedStyle(propertyDrawer).zIndex),
      relatedZIndex: Number(getComputedStyle(relatedRoot).zIndex)
    };
  })()`);
  if (
    !relatedPropertyEditor.open
    || !relatedPropertyEditor.source.includes("Servicios")
    || !relatedPropertyEditor.source.includes("Columna E")
    || relatedPropertyEditor.propertyZIndex <= relatedPropertyEditor.relatedZIndex
  ) {
    throw new Error(`La propiedad relacionada no abrió en el editor correcto: ${JSON.stringify(relatedPropertyEditor)}`);
  }

  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const typeSelect = panel.querySelector("#srd-property-type");
    typeSelect.value = "longText";
    typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    panel.querySelector("#srd-property-form").requestSubmit();
  })()`);
  await delay(120);
  const relatedPropertyApplied = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const relatedDrawer = panel.querySelector(".related-record-drawer");
    const editor = relatedDrawer?.querySelector('[data-related-column="5"]');
    return {
      drawerOpen: Boolean(relatedDrawer),
      propertyHidden: panel.querySelector(".property-drawer")?.hidden,
      fieldType: editor?.dataset.fieldType || "",
      control: editor?.querySelector("textarea")?.tagName || "",
      value: editor?.querySelector("textarea")?.value || ""
    };
  })()`);
  if (
    !relatedPropertyApplied.drawerOpen
    || !relatedPropertyApplied.propertyHidden
    || relatedPropertyApplied.fieldType !== "longText"
    || relatedPropertyApplied.control !== "TEXTAREA"
    || relatedPropertyApplied.value !== "A"
  ) {
    throw new Error(`La configuración relacionada no se aplicó sin cerrar el registro: ${JSON.stringify(relatedPropertyApplied)}`);
  }

  const drawerCancel = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const drawer = panel.querySelector(".related-record-drawer");
    const input = drawer.querySelector('[data-related-column="4"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Cambio temporal del drawer");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    const pending = host.dataset.hasPendingChanges;
    const cancel = Array.from(drawer.querySelectorAll(".ant-drawer-footer button")).find(button => button.textContent.includes("Cancelar"));
    cancel.click();
    return { pending, cancelDisabled: cancel.disabled };
  })()`);
  await delay(350);
  const drawerClosed = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    return {
      open: Boolean(panel.querySelector(".related-record-drawer")),
      pending: host.dataset.hasPendingChanges
    };
  })()`);
  if (drawerCancel.pending !== "true" || drawerCancel.cancelDisabled || drawerClosed.open || drawerClosed.pending !== "false") {
    throw new Error(`Cancelar en el drawer relacionado no restauró el registro: ${JSON.stringify({ drawerCancel, drawerClosed })}`);
  }

  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const relation = Array.from(panel.querySelectorAll(".relation")).find(item => item.querySelector(".relation-title")?.textContent === "Servicios");
    Array.from(relation.querySelectorAll(".ant-segmented-item")).find(item => item.textContent.includes("Tabla"))?.click();
  })()`);
  await delay(120);
  const inlineDraft = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const input = panel.querySelector('[data-related-sheet="Servicios"][data-related-row="2"][data-related-column="3"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Cambio temporal de tabla");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    const edited = { value: input.value, pending: host.dataset.hasPendingChanges, saveDisabled: panel.querySelector(".save").disabled };
    panel.querySelector(".cancel").click();
    return edited;
  })()`);
  await delay(80);
  const inlineRestored = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    return {
      value: panel.querySelector('[data-related-sheet="Servicios"][data-related-row="2"][data-related-column="3"] input')?.value,
      pending: host.dataset.hasPendingChanges
    };
  })()`);
  if (inlineDraft.value !== "Cambio temporal de tabla" || inlineDraft.pending !== "true" || inlineDraft.saveDisabled || inlineRestored.value !== "Limpieza" || inlineRestored.pending !== "false") {
    throw new Error(`La edición en línea no comparte Guardar/Cancelar: ${JSON.stringify({ inlineDraft, inlineRestored })}`);
  }

  await cdp.evaluate(`(() => {
    window.__relatedPastes = [];
    document.addEventListener("paste", event => {
      window.__relatedPastes.push({
        reference: document.getElementById("t-name-box")?.value || "",
        value: event.clipboardData?.getData("text/plain") || ""
      });
    }, { capture: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const input = panel.querySelector('[data-related-sheet="Servicios"][data-related-row="2"][data-related-column="3"] input');
    const note = panel.querySelector('[data-related-sheet="Servicios"][data-related-row="2"][data-related-column="4"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Limpieza premium");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    setter.call(note, "Nota relacionada");
    note.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    panel.querySelector(".save").click();
  })()`);
  setTimeout(() => {
    sheets.Servicios.rows[0][2] = "Limpieza premium";
    sheets.Servicios.rows[0][3] = "Nota relacionada";
  }, 450);
  const relatedPasteDeadline = Date.now() + 4_000;
  let relatedPastes = [];
  while (Date.now() < relatedPasteDeadline) {
    relatedPastes = await cdp.evaluate("window.__relatedPastes || []");
    if (relatedPastes.length) break;
    await delay(50);
  }
  if (relatedPastes.length !== 1 || relatedPastes[0].reference !== "'Servicios'!C2" || relatedPastes[0].value !== "Limpieza premium\tNota relacionada") {
    throw new Error(`La tabla relacionada no escribió la celda exacta: ${JSON.stringify(relatedPastes)}`);
  }
  await waitForWriteVerification();
  const relatedSaved = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    return {
      row: host.dataset.row,
      pending: host.dataset.hasPendingChanges,
      selection: document.getElementById("t-name-box")?.value || "",
      value: panel.querySelector('[data-related-sheet="Servicios"][data-related-row="2"][data-related-column="3"] input')?.value,
      note: panel.querySelector('[data-related-sheet="Servicios"][data-related-row="2"][data-related-column="4"] input')?.value,
      saveDisabled: panel.querySelector(".save").disabled
    };
  })()`);
  if (relatedSaved.row !== "2" || relatedSaved.pending !== "false" || relatedSaved.selection !== "'Servicios'!C2" || relatedSaved.value !== "Limpieza premium" || relatedSaved.note !== "Nota relacionada" || !relatedSaved.saveDisabled) {
    throw new Error(`La actualización relacionada no quedó confirmada: ${JSON.stringify(relatedSaved)}`);
  }

  const pendingActions = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const input = panel.querySelector('[data-column="2"] input');
    const save = panel.querySelector(".save");
    const cancel = panel.querySelector(".cancel");
    const initial = { saveDisabled: save.disabled, cancelDisabled: cancel.disabled, value: input.value };
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Cambio temporal");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    const edited = { saveDisabled: save.disabled, cancelDisabled: cancel.disabled, pending: host.dataset.hasPendingChanges };
    cancel.click();
    const restoredInput = panel.querySelector('[data-column="2"] input');
    const cancelled = { saveDisabled: save.disabled, cancelDisabled: cancel.disabled, pending: host.dataset.hasPendingChanges, value: restoredInput.value };
    return { initial, edited, cancelled };
  })()`);
  if (!pendingActions.initial.saveDisabled || !pendingActions.initial.cancelDisabled || pendingActions.edited.saveDisabled || pendingActions.edited.cancelDisabled || pendingActions.edited.pending !== "true" || !pendingActions.cancelled.saveDisabled || !pendingActions.cancelled.cancelDisabled || pendingActions.cancelled.pending !== "false" || pendingActions.cancelled.value !== pendingActions.initial.value) {
    throw new Error(`Guardar/Cancelar no reflejan los cambios pendientes: ${JSON.stringify(pendingActions)}`);
  }

  const configuredTypes = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const configure = (column, type, protect = false) => {
      panel.querySelector('[data-configure-column="' + column + '"]').click();
      const typeSelect = panel.querySelector("#srd-property-type");
      typeSelect.value = type;
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      const protectedInput = panel.querySelector('[name="protected"]');
      if (protect && !protectedInput.checked) protectedInput.click();
      panel.querySelector("#srd-property-form").requestSubmit();
    };
    configure(2, "longText", true);
    configure(3, "number");
    const nameControl = panel.querySelector('[data-column="2"]');
    const ageControl = panel.querySelector('[data-column="3"]');
    return {
      nameTag: nameControl?.querySelector("textarea")?.tagName,
      nameType: nameControl?.dataset.fieldType,
      nameValue: nameControl?.dataset.serializedValue,
      nameDisabled: nameControl?.querySelector("textarea")?.disabled,
      nameProtected: nameControl?.dataset.protected,
      ageTag: ageControl?.querySelector("input")?.tagName,
      ageInputType: ageControl?.querySelector("input")?.getAttribute("role"),
      ageFieldType: ageControl?.dataset.fieldType,
      ageValue: ageControl?.dataset.serializedValue,
      nameUsesAntd: nameControl?.querySelector("textarea")?.classList.contains("ant-input"),
      ageUsesAntd: Boolean(ageControl?.querySelector(".ant-input-number")),
      typeIconCount: panel.querySelectorAll(".field-configure svg").length,
      fieldNames: Array.from(panel.querySelectorAll(".field-label-text"), node => node.textContent),
      fieldTypes: Array.from(panel.querySelectorAll(".field-type-name"), node => node.textContent),
      editorHidden: panel.querySelector(".property-drawer")?.hidden
    };
  })()`);
  if (
    configuredTypes.nameTag !== "TEXTAREA" ||
    configuredTypes.nameType !== "longText" ||
    configuredTypes.nameValue !== "Ana" ||
    configuredTypes.nameDisabled !== true ||
    configuredTypes.nameProtected !== "true" ||
    configuredTypes.ageTag !== "INPUT" ||
    configuredTypes.ageInputType !== "spinbutton" ||
    configuredTypes.ageFieldType !== "number" ||
    configuredTypes.ageValue !== "30" ||
    !configuredTypes.nameUsesAntd ||
    !configuredTypes.ageUsesAntd ||
    configuredTypes.typeIconCount !== 3 ||
    configuredTypes.fieldNames.join("|") !== "ID Contacto|Nombre|Edad" ||
    configuredTypes.fieldTypes.join("|") !== "text|longText|number" ||
    !configuredTypes.editorHidden
  ) {
    throw new Error(`La configuración de tipos no se aplicó: ${JSON.stringify(configuredTypes)}`);
  }

  await cdp.evaluate(`(() => {
    const frame = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame");
    globalThis.__copiedPropertyValues = [];
    const clipboard = { writeText: async (value) => globalThis.__copiedPropertyValues.push(String(value)) };
    Object.defineProperty(frame.contentWindow.navigator, "clipboard", { configurable: true, value: clipboard });
    Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: clipboard });
  })()`, isolated.executionContextId);
  await clickPanelNode('[data-column="2"] [data-copy-field-value]');
  await delay(30);
  const copiedPropertyValue = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const control = panel.querySelector('[data-column="2"]');
    const button = control.querySelector('[data-copy-field-value]');
    const compact = control.querySelector(".property-value-compact");
    return {
      state: button.dataset.copyState,
      usesCheckIcon: Boolean(button.querySelector('[data-icon="check"]')),
      disabled: button.disabled,
      protectedInputDisabled: control.querySelector("textarea")?.disabled,
      compact: compact?.classList.contains("ant-space-compact"),
      copyButtonHeight: button.getBoundingClientRect().height,
      compactHeight: compact?.getBoundingClientRect().height
    };
  })()`);
  copiedPropertyValue.values = await cdp.evaluate("globalThis.__copiedPropertyValues", isolated.executionContextId);
  if (
    copiedPropertyValue.values.join("|") !== "Ana" ||
    copiedPropertyValue.state !== "copied" ||
    !copiedPropertyValue.usesCheckIcon ||
    copiedPropertyValue.disabled ||
    !copiedPropertyValue.protectedInputDisabled ||
    !copiedPropertyValue.compact ||
    copiedPropertyValue.compactHeight <= 32 ||
    Math.abs(copiedPropertyValue.copyButtonHeight - copiedPropertyValue.compactHeight) > 1
  ) {
    throw new Error(`La copia de valores no siguió el estado esperado: ${JSON.stringify(copiedPropertyValue)}`);
  }

  await cdp.evaluate(`(() => {
    location.hash = "gid=1&range=A2";
    const box = document.getElementById("t-name-box");
    box.value = "A2";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await delay(350);
  await cdp.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll(".docs-sheet-tab"));
    tabs.forEach(tab => tab.classList.remove("docs-sheet-active-tab"));
    tabs.find(tab => tab.textContent.includes("Servicios")).classList.add("docs-sheet-active-tab");
  })()`);

  const fromService = await waitForRelation("Contactos");
  const contact = fromService.relations.find((relation) => relation.title === "Contactos");
  if (contact.count !== "1" || !contact.cells.includes("C-1") || !contact.cells.includes("Ana") || contact.cells.includes("Luis")) {
    throw new Error(`Relacion Servicios -> Contactos incorrecta: ${JSON.stringify(contact)}`);
  }

  const antdSpecializedControls = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const configure = (type, options = "") => {
      panel.querySelector('[data-configure-column="3"]').click();
      const typeSelect = panel.querySelector("#srd-property-type");
      typeSelect.value = type;
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      const optionInput = panel.querySelector('[name="options"]');
      if (optionInput) optionInput.value = options;
      panel.querySelector("#srd-property-form").requestSubmit();
      return panel.querySelector('[data-column="3"]');
    };
    const date = configure("date");
    const datePicker = Boolean(date.querySelector(".ant-picker"));
    const time = configure("time");
    const timePicker = Boolean(time.querySelector(".ant-picker"));
    const multiple = configure("multiSelect", "Limpieza\\nEntrega\\nReparación");
    const multiSelect = Boolean(multiple.querySelector(".ant-select-multiple"));
    const single = configure("select", "Limpieza\\nEntrega\\nReparación");
    const singleSelect = Boolean(single.querySelector(".ant-select-single"));
    const cssInIframe = Boolean(panel.head.querySelector("style[data-css-hash]"));
    return { datePicker, timePicker, multiSelect, singleSelect, cssInIframe };
  })()`);
  if (Object.values(antdSpecializedControls).some((value) => !value)) {
    throw new Error(`No se montaron todos los componentes Ant Design: ${JSON.stringify(antdSpecializedControls)}`);
  }

  await clickPanelNode('[data-column="3"] .ant-select-selector');
  await waitForPanelPopup(".ant-select-dropdown:not(.ant-select-dropdown-hidden)", "Entrega");
  const optionPoint = await clickPanelNode('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Entrega"]');
  const selectedValue = await cdp.evaluate(`document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument.querySelector('[data-column="3"]').dataset.serializedValue`);
  if (selectedValue !== "Entrega") throw new Error(`El Select no aplicÃ³ la opciÃ³n elegida: ${selectedValue}; punto ${JSON.stringify(optionPoint)}`);
  await closePanelPopup();

  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-configure-column="3"]').click();
  })()`);
  await clickPanelNode(".property-type-host .ant-select-selector");
  await waitForPanelPopup(".ant-select-dropdown:not(.ant-select-dropdown-hidden)", "Texto");
  await closePanelPopup();
  await clickPanelNode(".property-actions .secondary-button");

  await configureColumn3("multiSelect", "Limpieza\nEntrega\nReparaciÃ³n");
  await clickPanelNode('[data-column="3"] .ant-select-selector');
  await waitForPanelPopup(".ant-select-dropdown:not(.ant-select-dropdown-hidden)", "Limpieza");
  const multipleOptionPoint = await clickPanelNode('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Limpieza"]');
  const multipleValue = await cdp.evaluate(`document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument.querySelector('[data-column="3"]').dataset.serializedValue`);
  if (!multipleValue.includes("Entrega") || !multipleValue.includes("Limpieza")) throw new Error(`La selecciÃ³n mÃºltiple no aplicÃ³ la opciÃ³n elegida: ${multipleValue}; punto ${JSON.stringify(multipleOptionPoint)}`);
  await closePanelPopup();

  await configureColumn3("status", "Nuevo\nEn proceso\nCerrado");
  await clickPanelNode('[data-column="3"] .ant-select-selector');
  await waitForPanelPopup(".ant-select-dropdown:not(.ant-select-dropdown-hidden)", "En proceso");
  const statusTags = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const popup = Array.from(panel.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")).at(-1);
    return popup?.querySelectorAll(".option-tag.ant-tag").length || 0;
  })()`);
  if (statusTags < 3) throw new Error(`Las opciones de Estado no mostraron sus colores: ${statusTags}`);
  await closePanelPopup();
  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-configure-column="3"]').click();
  })()`);
  const statusEditor = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    return {
      colorSelectors: panel.querySelectorAll(".option-editor .color-select").length,
      colors: JSON.parse(panel.querySelector('[name="optionColors"]')?.value || "{}")
    };
  })()`);
  if (statusEditor.colorSelectors !== 3 || Object.keys(statusEditor.colors).length !== 3) {
    throw new Error(`El editor de Estado no conservÃ³ colores: ${JSON.stringify(statusEditor)}`);
  }
  await clickPanelNode(".option-row:last-of-type .color-select .ant-select-selector");
  await waitForPanelPopup(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
  await clickPanelNode(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option");
  await clickPanelNode(".property-actions .primary-button");
  await delay(100);
  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-configure-column="3"]').click();
  })()`);
  const persistedStatusColors = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    return JSON.parse(panel.querySelector('[name="optionColors"]')?.value || "{}");
  })()`);
  if (persistedStatusColors.Cerrado !== "#d9d9d9") {
    throw new Error(`El color de Estado no persistiÃ³: ${JSON.stringify(persistedStatusColors)}`);
  }
  await clickPanelNode(".property-actions .secondary-button");

  await configureColumn3("date");
  await clickPanelNode('[data-column="3"] .ant-picker');
  const datePopup = await waitForPanelPopup(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)");
  const localizedDatePicker = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const popup = Array.from(panel.querySelectorAll(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)")).at(-1);
    const calendarRows = Array.from(popup?.querySelectorAll(".ant-picker-content tbody tr") || []);
    const firstCell = popup?.querySelector(".ant-picker-content tbody td");
    return {
      workspaceClass: popup?.classList.contains("workspace-date-picker-popup") || false,
      text: popup?.textContent || "",
      rowBackgrounds: calendarRows.slice(0, 2).map(row => panel.defaultView.getComputedStyle(row).backgroundColor),
      cellBorderTopWidth: firstCell ? panel.defaultView.getComputedStyle(firstCell).borderTopWidth : ""
    };
  })()`);
  if (
    !localizedDatePicker.workspaceClass ||
    !localizedDatePicker.text.includes("Hoy") ||
    !localizedDatePicker.text.includes("LunMarMiéJueVieSábDom") ||
    localizedDatePicker.rowBackgrounds[0] !== localizedDatePicker.rowBackgrounds[1] ||
    localizedDatePicker.cellBorderTopWidth !== "0px"
  ) {
    throw new Error(`El calendario no usÃ³ el estilo y locale de Workspace: ${JSON.stringify({ datePopup, localizedDatePicker })}`);
  }
  await closePanelPopup();

  await configureColumn3("time");
  await clickPanelNode('[data-column="3"] .ant-picker');
  await waitForPanelPopup(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)");
  await closePanelPopup();

  await configureColumn3("text");
  const localizedFalse = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const input = panel.querySelector('[data-column="3"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "FALSO");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    return panel.querySelector('[data-column="3"]').dataset.serializedValue;
  })()`);
  if (localizedFalse !== "FALSO") throw new Error(`No se preparÃ³ el valor localizado de casilla: ${localizedFalse}`);
  await configureColumn3("checkbox");
  const checkboxState = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const control = panel.querySelector('[data-column="3"]');
    return { value: control.dataset.serializedValue, checked: control.querySelector('input[type="checkbox"]')?.checked };
  })()`);
  if (checkboxState.value !== "FALSE" || checkboxState.checked !== false) {
    throw new Error(`La casilla localizada no se normalizÃ³ para Sheets: ${JSON.stringify(checkboxState)}`);
  }

  const canonicalCheckboxSettings = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-configure-column="3"]').click();
    const checked = panel.querySelector('[name="checkedValue"]');
    const unchecked = panel.querySelector('[name="uncheckedValue"]');
    checked.value = "true";
    unchecked.value = "false";
    panel.querySelector("#srd-property-form").requestSubmit();
    panel.querySelector('[data-configure-column="3"]').click();
    const result = {
      checked: panel.querySelector('[name="checkedValue"]')?.value,
      unchecked: panel.querySelector('[name="uncheckedValue"]')?.value
    };
    panel.querySelector(".property-actions .secondary-button").click();
    return result;
  })()`);
  if (canonicalCheckboxSettings.checked !== "TRUE" || canonicalCheckboxSettings.unchecked !== "FALSE") {
    throw new Error(`Los valores booleanos no se normalizaron para Sheets: ${JSON.stringify(canonicalCheckboxSettings)}`);
  }

  sheets.Contactos.rows[0][1] = "Ana actualizada";
  sheets.Servicios.rows.push(["S-4", "C-1", "Instalación"]);
  delayContactRow = true;
  delayServicesTable = true;
  await cdp.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll(".docs-sheet-tab"));
    tabs.forEach(tab => tab.classList.remove("docs-sheet-active-tab"));
    tabs.find(tab => tab.textContent.includes("Contactos")).classList.add("docs-sheet-active-tab");
    tabs.find(tab => tab.textContent.includes("Servicios")).id = "sheet-servicios";
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
    if (cachedSnapshot.formStatus.includes("caché") && cachedSnapshot.formStatusHidden && cachedSnapshot.relatedStatusHidden && cachedSnapshot.saveState === "saving" && cachedSnapshot.fields.includes("Ana") && cachedServices?.count === "2" && cachedServices?.view === "table") break;
    await delay(50);
  }
  const cachedServices = cachedSnapshot?.relations.find((relation) => relation.title === "Servicios");
  if (!cachedSnapshot?.formStatus.includes("caché") || !cachedSnapshot.formStatusHidden || !cachedSnapshot.relatedStatusHidden || cachedSnapshot.saveState !== "saving" || !cachedSnapshot.fields.includes("Ana") || cachedServices?.count !== "2" || cachedServices?.view !== "table") {
    throw new Error(`La caché no apareció antes de la red: ${JSON.stringify(cachedSnapshot)}`);
  }
  await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const age = panel.querySelector('[data-column="3"] input');
    age.value = "31";
    age.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  const refreshDeadline = Date.now() + 8_000;
  let refreshedSnapshot;
  while (Date.now() < refreshDeadline) {
    refreshedSnapshot = await cdp.evaluate(snapshot);
    const refreshedServices = refreshedSnapshot.relations.find((relation) => relation.title === "Servicios");
    if (refreshedSnapshot.fields.includes("Ana actualizada") && refreshedSnapshot.fields.includes("31") && refreshedServices?.count === "3" && refreshedSnapshot.saveState === "saved") break;
    await delay(100);
  }
  const refreshedServices = refreshedSnapshot?.relations.find((relation) => relation.title === "Servicios");
  if (!refreshedSnapshot?.fields.includes("Ana actualizada") || !refreshedSnapshot?.fields.includes("31") || refreshedServices?.count !== "3" || refreshedSnapshot.saveState !== "saved") {
    throw new Error(`La actualización en segundo plano no reemplazó la caché: ${JSON.stringify(refreshedSnapshot)}`);
  }

  const persistentTypes = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    return {
      nameType: panel.querySelector('[data-column="2"]')?.dataset.fieldType,
      nameDisabled: panel.querySelector('[data-column="2"] textarea')?.disabled,
      nameProtected: panel.querySelector('[data-column="2"]')?.dataset.protected,
      ageType: panel.querySelector('[data-column="3"]')?.dataset.fieldType
    };
  })()`);
  if (persistentTypes.nameType !== "longText" || !persistentTypes.nameDisabled || persistentTypes.nameProtected !== "true" || persistentTypes.ageType !== "number") {
    throw new Error(`Los tipos no se conservaron al cambiar de hoja: ${JSON.stringify(persistentTypes)}`);
  }

  const relatedSheetTypes = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const serviceCheckbox = panel.querySelector('[data-related-sheet="Servicios"][data-related-column="3"] input[type="checkbox"]');
    return {
      hasCheckbox: Boolean(serviceCheckbox),
      fieldType: serviceCheckbox?.closest("[data-field-type]")?.dataset.fieldType || "",
      textInputs: panel.querySelectorAll('[data-related-sheet="Servicios"][data-related-column="3"] input[type="text"]').length
    };
  })()`);
  if (!relatedSheetTypes.hasCheckbox || relatedSheetTypes.fieldType !== "checkbox" || relatedSheetTypes.textInputs) {
    throw new Error(`Los relacionados no usaron los tipos configurados en su propia hoja: ${JSON.stringify(relatedSheetTypes)}`);
  }

  sheets.Servicios.rows[0][2] = "TRUE";
  visualServiceCheckbox = true;
  delayServicesTable = false;
  await cdp.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll(".docs-sheet-tab"));
    tabs.forEach(tab => tab.classList.remove("docs-sheet-active-tab"));
    tabs.find(tab => tab.textContent.includes("Servicios")).classList.add("docs-sheet-active-tab");
    location.hash = "gid=1&range=A2";
    const box = document.getElementById("t-name-box");
    box.value = "A2";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  const checkboxLoadDeadline = Date.now() + 8_000;
  let checkboxRow;
  while (Date.now() < checkboxLoadDeadline) {
    checkboxRow = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
      return {
        gid: host?.dataset.gid,
        saveState: host?.dataset.saveState,
        values: panel ? Array.from(panel.querySelectorAll("[data-column]"), control => control.dataset.serializedValue || "") : [],
        checked: panel?.querySelector('[data-column="3"] input[type="checkbox"]')?.checked
      };
    })()`);
    if (checkboxRow.gid === "1" && checkboxRow.saveState === "saved" && checkboxRow.values[2] === "TRUE" && checkboxRow.checked === true && checkboxRow.values[3] === "Inicial") break;
    await delay(100);
  }
  if (checkboxRow?.values?.[2] !== "TRUE" || checkboxRow.checked !== true) {
    throw new Error(`No se detectó la casilla marcada de Sheets: ${JSON.stringify(checkboxRow)}`);
  }

  await cdp.evaluate(`(() => {
    location.hash = "gid=1&range=A3";
    const box = document.getElementById("t-name-box");
    box.value = "A3";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  const otherRowDeadline = Date.now() + 5_000;
  while (Date.now() < otherRowDeadline) {
    if (await cdp.evaluate('document.getElementById("sheets-session-probe")?.dataset.row === "3"')) break;
    await delay(100);
  }
  sheets.Servicios.rows[0][2] = "FALSO";
  visualServiceCheckbox = false;
  await cdp.evaluate(`(() => {
    location.hash = "gid=1&range=A2";
    const box = document.getElementById("t-name-box");
    box.value = "A2";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  const uncheckedDeadline = Date.now() + 8_000;
  let uncheckedRow;
  while (Date.now() < uncheckedDeadline) {
    uncheckedRow = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
      const control = panel?.querySelector('[data-column="3"]');
      return {
        row: host?.dataset.row,
        value: control?.dataset.serializedValue,
        checked: control?.querySelector('input[type="checkbox"]')?.checked
      };
    })()`);
    if (uncheckedRow.row === "2" && uncheckedRow.value === "FALSE" && uncheckedRow.checked === false) break;
    await delay(100);
  }
  visualServiceCheckbox = null;
  if (uncheckedRow?.value !== "FALSE" || uncheckedRow.checked !== false) {
    throw new Error(`No se detectó la casilla desmarcada de Sheets: ${JSON.stringify(uncheckedRow)}`);
  }

  await cdp.evaluate(`(() => {
    window.__minimalPaste = null;
    document.addEventListener("paste", event => {
      window.__minimalPaste = event.clipboardData?.getData("text/plain") || "";
    }, { capture: true, once: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const input = panel.querySelector('[data-column="4"] input');
    window.__primaryClearInput = input;
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Solo cambio");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    panel.querySelector(".save").click();
  })()`);
  setTimeout(() => {
    sheets.Servicios.rows[0][3] = "Solo cambio";
  }, 650);
  const minimalPasteDeadline = Date.now() + 3_000;
  let minimalPaste = null;
  while (Date.now() < minimalPasteDeadline) {
    minimalPaste = await cdp.evaluate("window.__minimalPaste");
    if (minimalPaste !== null) break;
    await delay(50);
  }
  if (minimalPaste !== "Solo cambio") {
    throw new Error(`El guardado incluyó columnas que no cambiaron: ${JSON.stringify(minimalPaste)}`);
  }
  await waitForWriteVerification(4_000);

  await cdp.evaluate(`(() => {
    window.__primaryClears = [];
    document.addEventListener("keydown", event => {
      if (event.key === "Delete") {
        window.__primaryClears.push(document.getElementById("t-name-box")?.value || "");
      }
    }, { capture: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const input = panel.querySelector('[data-column="4"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    panel.querySelector(".save").click();
  })()`);
  setTimeout(() => {
    sheets.Servicios.rows[0][3] = "";
  }, 650);
  const primaryClearDeadline = Date.now() + 3_000;
  let primaryClears = [];
  while (Date.now() < primaryClearDeadline) {
    primaryClears = await cdp.evaluate("window.__primaryClears || []");
    if (primaryClears.length) break;
    await delay(50);
  }
  if (JSON.stringify(primaryClears) !== JSON.stringify(["'Servicios'!D2"])) {
    throw new Error(`Vaciar un campo no genero una limpieza real en Sheets: ${JSON.stringify(primaryClears)}`);
  }
  await waitForWriteVerification(4_000);
  const clearedPrimary = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    return {
      value: panel.querySelector('[data-column="4"]').dataset.serializedValue,
      pending: host.dataset.hasPendingChanges,
      selection: document.getElementById("t-name-box")?.value || "",
      sameInput: panel.querySelector('[data-column="4"] input') === window.__primaryClearInput,
      saveDisabled: panel.querySelector(".save").disabled
    };
  })()`);
  if (clearedPrimary.value !== "" || clearedPrimary.pending !== "false" || clearedPrimary.selection !== "'Servicios'!D2" || !clearedPrimary.sameInput || !clearedPrimary.saveDisabled) {
    throw new Error(`El campo vacio no quedo sincronizado: ${JSON.stringify(clearedPrimary)}`);
  }

  await cdp.evaluate(`(() => {
    window.__checkboxBlockPaste = null;
    document.addEventListener("paste", event => {
      window.__checkboxBlockPaste = event.clipboardData?.getData("text/plain") || "";
    }, { capture: true, once: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    const update = (column, value) => {
      const input = panel.querySelector('[data-column="' + column + '"] input');
      setter.call(input, value);
      input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    };
    update(2, "C-9");
    update(4, "Actualizada");
    panel.querySelector(".save").click();
  })()`);
  setTimeout(() => {
    sheets.Servicios.rows[0][1] = "C-9";
    sheets.Servicios.rows[0][3] = "Actualizada";
  }, 650);
  const checkboxPasteDeadline = Date.now() + 3_000;
  let checkboxBlockPaste = null;
  while (Date.now() < checkboxPasteDeadline) {
    checkboxBlockPaste = await cdp.evaluate("window.__checkboxBlockPaste");
    if (checkboxBlockPaste !== null) break;
    await delay(50);
  }
  if (checkboxBlockPaste !== "C-9\tFALSE\tActualizada") {
    throw new Error(`El bloque reinsertó el texto localizado de la casilla: ${JSON.stringify(checkboxBlockPaste)}`);
  }
  await waitForWriteVerification(4_000);

  sheets.Servicios.rows[0][2] = "";
  setTimeout(() => {
    sheets.Servicios.rows[0][2] = "TRUE";
  }, 1_800);
  await cdp.evaluate(`(() => {
    window.__optimisticCheckboxPastes = [];
    document.addEventListener("paste", event => {
      window.__optimisticCheckboxPastes.push(event.clipboardData?.getData("text/plain") || "");
    }, { capture: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-column="3"] input[type="checkbox"]').click();
    panel.querySelector(".save").click();
  })()`);
  await delay(900);
  const optimisticCheckbox = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const control = panel.querySelector('[data-column="3"]');
    return {
      checked: control.querySelector('input[type="checkbox"]')?.checked,
      value: control.dataset.serializedValue,
      saveState: host.dataset.saveState,
      verification: host.dataset.writeVerification,
      pastes: window.__optimisticCheckboxPastes,
      hiddenReaders: document.querySelectorAll('iframe[aria-hidden="true"]').length
    };
  })()`);
  if (!optimisticCheckbox.checked || optimisticCheckbox.value !== "TRUE" || optimisticCheckbox.saveState !== "saved" || optimisticCheckbox.verification !== "pending" || optimisticCheckbox.pastes.length !== 1 || optimisticCheckbox.hiddenReaders !== 0) {
    throw new Error(`La verificación intermitente sobrescribió la casilla: ${JSON.stringify(optimisticCheckbox)}`);
  }
  await waitForWriteVerification();
  const optimisticResult = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const control = panel.querySelector('[data-column="3"]');
    return {
      checked: control.querySelector('input[type="checkbox"]')?.checked,
      value: control.dataset.serializedValue,
      saveState: host.dataset.saveState,
      verification: host.dataset.writeVerification,
      pastes: window.__optimisticCheckboxPastes
    };
  })()`);
  if (!optimisticResult?.checked || optimisticResult.value !== "TRUE" || optimisticResult.saveState !== "saved" || optimisticResult.verification !== "verified" || optimisticResult.pastes.length !== 1) {
    throw new Error(`La casilla no quedó estable después de verificar: ${JSON.stringify(optimisticResult)}`);
  }

  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-configure-column="1"]').click();
    const randomId = panel.querySelector('[name="randomId"]');
    if (!randomId.checked) randomId.click();
    const lengthInput = panel.querySelector(".property-random-id .ant-input-number-input");
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(lengthInput, "9");
    lengthInput.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    lengthInput.dispatchEvent(new panel.defaultView.Event("change", { bubbles: true }));
  })()`);
  await delay(100);
  const randomIdConfiguration = await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const hiddenLength = panel.querySelector('[name="randomIdLength"]');
    const configuredLength = hiddenLength?.value || "";
    panel.querySelector("#srd-property-form").requestSubmit();
    panel.querySelector('[data-configure-column="1"]').click();
    const result = {
      enabled: panel.querySelector('[name="randomId"]')?.checked,
      length: panel.querySelector('[name="randomIdLength"]')?.value,
      inputRole: panel.querySelector(".property-random-id .ant-input-number-input")?.getAttribute("role")
    };
    panel.querySelector(".property-actions .secondary-button").click();
    return { configuredLength, ...result };
  })()`);
  if (!randomIdConfiguration.enabled || randomIdConfiguration.length !== "9" || randomIdConfiguration.inputRole !== "spinbutton") {
    throw new Error(`La configuración del ID aleatorio no persistió: ${JSON.stringify(randomIdConfiguration)}`);
  }

  await cdp.evaluate(`(() => {
    window.__createRecordPastes = [];
    document.addEventListener("paste", event => {
      window.__createRecordPastes.push({
        reference: document.getElementById("t-name-box")?.value || "",
        value: event.clipboardData?.getData("text/plain") || ""
      });
    }, { capture: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-add-record="current"]').click();
  })()`);
  const createRecordDeadline = Date.now() + 5_000;
  let newService;
  while (Date.now() < createRecordDeadline) {
    newService = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
      return {
        creating: host.dataset.creatingRecord,
        row: host.dataset.row,
        id: panel.querySelector('[data-column="1"]')?.dataset.serializedValue || "",
        cancelDisabled: panel.querySelector(".cancel")?.disabled
      };
    })()`);
    if (newService.creating === "true" && newService.row === "6" && newService.id) break;
    await delay(100);
  }
  if (newService?.creating !== "true" || newService.row !== "6" || !/^[A-Za-z0-9]{9}$/.test(newService.id) || newService.cancelDisabled) {
    throw new Error(`El alta principal no preparó la fila ni el ID: ${JSON.stringify(newService)}`);
  }
  const createdServiceId = newService.id;
  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const input = panel.querySelector('[data-column="4"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Creado desde la hoja actual");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    panel.querySelector(".save").click();
  })()`);
  setTimeout(() => {
    sheets.Servicios.rows.push([createdServiceId, "", "FALSE", "Creado desde la hoja actual", "", ""]);
  }, 450);
  await waitForWriteVerification();
  const createdService = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    return {
      creating: host.dataset.creatingRecord || "",
      row: host.dataset.row,
      id: panel.querySelector('[data-column="1"]')?.dataset.serializedValue || "",
      note: panel.querySelector('[data-column="4"]')?.dataset.serializedValue || "",
      pastes: window.__createRecordPastes
    };
  })()`);
  if (
    createdService.creating ||
    createdService.row !== "6" ||
    createdService.id !== createdServiceId ||
    createdService.note !== "Creado desde la hoja actual" ||
    createdService.pastes.length !== 1 ||
    createdService.pastes[0].reference !== "'Servicios'!A6" ||
    createdService.pastes[0].value !== `${createdServiceId}\t\tFALSE\tCreado desde la hoja actual`
  ) {
    throw new Error(`El alta principal no escribió solo las celdas nuevas: ${JSON.stringify(createdService)}`);
  }

  await cdp.evaluate(`(() => {
    const tabs = Array.from(document.querySelectorAll(".docs-sheet-tab"));
    tabs.forEach(tab => tab.classList.remove("docs-sheet-active-tab"));
    tabs.find(tab => tab.textContent.includes("Contactos")).classList.add("docs-sheet-active-tab");
    location.hash = "gid=0&range=A2";
    const box = document.getElementById("t-name-box");
    box.value = "A2";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await waitForRelation("Servicios");
  const relatedFormReadyDeadline = Date.now() + 12_000;
  let relatedFormReady;
  while (Date.now() < relatedFormReadyDeadline) {
    relatedFormReady = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      return {
        row: host?.dataset.row || "",
        pending: host?.dataset.hasPendingChanges || ""
      };
    })()`);
    if (relatedFormReady.row === "2" && relatedFormReady.pending !== "true") break;
    await delay(100);
  }
  if (relatedFormReady?.row !== "2" || relatedFormReady.pending === "true") {
    throw new Error(`El formulario principal no terminó de cargar Contactos antes del alta relacionada: ${JSON.stringify(relatedFormReady)}`);
  }
  await cdp.evaluate(`(() => {
    window.__createRelatedPastes = [];
    document.addEventListener("paste", event => {
      window.__createRelatedPastes.push({
        reference: document.getElementById("t-name-box")?.value || "",
        value: event.clipboardData?.getData("text/plain") || ""
      });
    }, { capture: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-add-related-record="Servicios"]').click();
  })()`);
  const relatedCreateDeadline = Date.now() + 5_000;
  let newRelatedService;
  while (Date.now() < relatedCreateDeadline) {
    newRelatedService = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
      const drawer = panel.querySelector(".related-record-drawer");
      const button = panel.querySelector('[data-add-related-record="Servicios"]');
      return {
        open: Boolean(drawer),
        title: drawer?.querySelector(".ant-drawer-title")?.textContent || "",
        id: drawer?.querySelector('[data-related-column="1"] input')?.value || "",
        relationId: drawer?.querySelector('[data-related-column="2"] input')?.value || "",
        relationDisabled: drawer?.querySelector('[data-related-column="2"] input')?.disabled || false,
        button: Boolean(button),
        buttonLoading: button?.classList.contains("ant-btn-loading") || false,
        status: panel.querySelector(".status")?.textContent || "",
        statusKind: host.dataset.status || "",
        saveState: host.dataset.saveState || "",
        pending: host.dataset.hasPendingChanges || ""
      };
    })()`);
    if (newRelatedService.open && newRelatedService.id && newRelatedService.relationId) break;
    await delay(100);
  }
  if (!newRelatedService?.open || !newRelatedService.title.includes("Nuevo registro") || !/^[A-Za-z0-9]{9}$/.test(newRelatedService.id) || newRelatedService.relationId !== "C-1" || !newRelatedService.relationDisabled || newRelatedService.buttonLoading) {
    throw new Error(`El alta relacionada no heredó el ID de Contactos: ${JSON.stringify(newRelatedService)}`);
  }
  const relatedServiceId = newRelatedService.id;
  await cdp.evaluate(`(() => {
    const nameBox = document.getElementById("t-name-box");
    nameBox.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      const match = String(nameBox.value || "").match(/^'([^']+)'!([A-Z]+\\d+)$/);
      if (!match) return;
      const tabs = Array.from(document.querySelectorAll(".docs-sheet-tab"));
      const target = tabs.find(tab => tab.textContent.includes(match[1]));
      if (!target) return;
      tabs.forEach(tab => tab.classList.remove("docs-sheet-active-tab"));
      target.classList.add("docs-sheet-active-tab");
      const gid = match[1] === "Servicios" ? "1" : "0";
      location.hash = "gid=" + gid + "&range=" + match[2];
    }, { capture: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const drawer = panel.querySelector(".related-record-drawer");
    const input = drawer.querySelector('[data-related-column="4"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Creado desde relacionados");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    Array.from(drawer.querySelectorAll(".ant-drawer-footer button")).find(button => button.textContent.includes("Guardar"))?.click();
  })()`);
  const relatedCloseDeadline = Date.now() + 400;
  let relatedDrawerClosing = false;
  while (Date.now() < relatedCloseDeadline) {
    relatedDrawerClosing = await cdp.evaluate(`(() => {
      const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
      return !panel.querySelector(".related-record-drawer-root")?.classList.contains("ant-drawer-open");
    })()`);
    if (relatedDrawerClosing) break;
    await delay(25);
  }
  if (!relatedDrawerClosing) throw new Error("El drawer relacionado esperó la confirmación de Sheets para comenzar a cerrarse.");
  setTimeout(() => {
    sheets.Servicios.rows.push([relatedServiceId, "C-1", "", "Creado desde relacionados", "", ""]);
  }, 450);
  await waitForWriteVerification();
  const relatedCreatedDeadline = Date.now() + 5_000;
  let relatedCreated;
  while (Date.now() < relatedCreatedDeadline) {
    relatedCreated = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
      const relation = Array.from(panel.querySelectorAll(".relation")).find(item => item.querySelector(".relation-title")?.textContent === "Servicios");
      return {
        gid: new URLSearchParams(location.hash.slice(1)).get("gid") || "",
        row: host.dataset.row || "",
        sheet: document.querySelector(".docs-sheet-active-tab .docs-sheet-tab-name")?.textContent || "",
        selection: document.getElementById("t-name-box")?.value || "",
        id: panel.querySelector('[data-column="1"]')?.dataset.serializedValue || "",
        meta: panel.querySelector(".meta")?.textContent || "",
        count: relation?.querySelector(".relation-count")?.textContent || "",
        drawerOpen: Boolean(panel.querySelector(".related-record-drawer")),
        pastes: window.__createRelatedPastes
      };
    })()`);
    if (relatedCreated.gid === "1" && relatedCreated.row === "2" && relatedCreated.id === "C-1" && relatedCreated.count === "3" && !relatedCreated.drawerOpen) break;
    await delay(100);
  }
  if (
    relatedCreated?.gid !== "1" ||
    relatedCreated.row !== "2" ||
    relatedCreated.sheet !== "Servicios" ||
    relatedCreated.selection !== "'Servicios'!D7" ||
    relatedCreated.id !== "C-1" ||
    !relatedCreated.meta.includes("Contactos") ||
    relatedCreated.count !== "3" ||
    relatedCreated.drawerOpen ||
    relatedCreated.pastes.length !== 2 ||
    relatedCreated.pastes[0].reference !== "'Servicios'!A7" ||
    relatedCreated.pastes[0].value !== `${relatedServiceId}\tC-1` ||
    relatedCreated.pastes[1].reference !== "'Servicios'!D7" ||
    relatedCreated.pastes[1].value !== "Creado desde relacionados"
  ) {
    throw new Error(`El alta relacionada reemplazó el formulario principal: ${JSON.stringify(relatedCreated)}`);
  }

  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-add-related-record="Servicios"]').click();
  })()`);
  const secondRelatedDeadline = Date.now() + 5_000;
  let secondRelated;
  while (Date.now() < secondRelatedDeadline) {
    secondRelated = await cdp.evaluate(`(() => {
      const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
      const drawer = panel.querySelector(".related-record-drawer");
      return {
        open: Boolean(drawer),
        id: drawer?.querySelector('[data-related-column="1"] input')?.value || "",
        relationId: drawer?.querySelector('[data-related-column="2"] input')?.value || ""
      };
    })()`);
    if (secondRelated.open && secondRelated.id && secondRelated.relationId) break;
    await delay(100);
  }
  if (
    !secondRelated?.open
    || !/^[A-Za-z0-9]{9}$/.test(secondRelated.id)
    || secondRelated.id === relatedServiceId
    || secondRelated.relationId !== "C-1"
  ) {
    throw new Error(`El segundo registro relacionado no generó su ID: ${JSON.stringify(secondRelated)}`);
  }
  const secondRelatedServiceId = secondRelated.id;
  await cdp.evaluate(`(() => {
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const drawer = panel.querySelector(".related-record-drawer");
    const input = drawer.querySelector('[data-related-column="4"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Segundo relacionado");
    input.dispatchEvent(new panel.defaultView.Event("input", { bubbles: true }));
    Array.from(drawer.querySelectorAll(".ant-drawer-footer button")).find(button => button.textContent.includes("Guardar"))?.click();
  })()`);
  setTimeout(() => {
    sheets.Servicios.rows.push([secondRelatedServiceId, "C-1", "", "Segundo relacionado", "", ""]);
  }, 450);
  await waitForWriteVerification();
  const secondRelatedSavedDeadline = Date.now() + 5_000;
  let secondRelatedSaved;
  while (Date.now() < secondRelatedSavedDeadline) {
    secondRelatedSaved = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
      const relation = Array.from(panel.querySelectorAll(".relation")).find(item => item.querySelector(".relation-title")?.textContent === "Servicios");
      return {
        row: host.dataset.row || "",
        selection: document.getElementById("t-name-box")?.value || "",
        id: panel.querySelector('[data-column="1"]')?.dataset.serializedValue || "",
        count: relation?.querySelector(".relation-count")?.textContent || "",
        drawerOpen: Boolean(panel.querySelector(".related-record-drawer")),
        pastes: window.__createRelatedPastes
      };
    })()`);
    if (secondRelatedSaved.row === "2" && secondRelatedSaved.id === "C-1" && secondRelatedSaved.count === "4" && !secondRelatedSaved.drawerOpen) break;
    await delay(100);
  }
  if (
    secondRelatedSaved?.row !== "2"
    || secondRelatedSaved.selection !== "'Servicios'!D8"
    || secondRelatedSaved.id !== "C-1"
    || secondRelatedSaved.count !== "4"
    || secondRelatedSaved.drawerOpen
    || secondRelatedSaved.pastes.length !== 4
    || secondRelatedSaved.pastes[2].reference !== "'Servicios'!A8"
    || secondRelatedSaved.pastes[2].value !== `${secondRelatedServiceId}\tC-1`
    || secondRelatedSaved.pastes[3].reference !== "'Servicios'!D8"
    || secondRelatedSaved.pastes[3].value !== "Segundo relacionado"
  ) {
    throw new Error(`El segundo registro relacionado no conservó el contexto: ${JSON.stringify(secondRelatedSaved)}`);
  }
  console.log("RELACIONES_OK: altas principal y relacionada, ID aleatorio, Deck/Tabla, guardado, tipos y caché confirmados.");
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
