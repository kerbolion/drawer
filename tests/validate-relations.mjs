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
    headers: ["ID Servicio", "ID Contacto", "Nombre", "Nota"],
    rows: [["S-1", "C-1", "Limpieza", "Inicial"], ["S-2", "C-1", "Entrega", ""], ["S-3", "C-2", "Reparación", ""]]
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
  await cdp.evaluate(await readFile(path.join(extensionDir, "dist", "content.js"), "utf8"), isolated.executionContextId);

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
    return {
      view: relation?.dataset.relationView,
      tableCells: Array.from(relation?.querySelectorAll("tbody td") || [], cell => cell.textContent)
    };
  })()`);
  if (relationDeck.view !== "deck" || relationDeck.cards !== 2 || !relationDeck.hasDeckOption || !relationDeck.hasTableOption || relationTable.view !== "table" || !relationTable.tableCells.includes("S-1")) {
    throw new Error(`Las vistas Deck/Tabla no funcionan: ${JSON.stringify({ relationDeck, relationTable })}`);
  }

  const configuredTypes = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    const configure = (column, type) => {
      panel.querySelector('[data-configure-column="' + column + '"]').click();
      const typeSelect = panel.querySelector("#srd-property-type");
      typeSelect.value = type;
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      panel.querySelector("#srd-property-form").requestSubmit();
    };
    configure(2, "longText");
    configure(3, "number");
    const nameControl = panel.querySelector('[data-column="2"]');
    const ageControl = panel.querySelector('[data-column="3"]');
    return {
      nameTag: nameControl?.querySelector("textarea")?.tagName,
      nameType: nameControl?.dataset.fieldType,
      nameValue: nameControl?.dataset.serializedValue,
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
      ageType: panel.querySelector('[data-column="3"]')?.dataset.fieldType
    };
  })()`);
  if (persistentTypes.nameType !== "longText" || persistentTypes.ageType !== "number") {
    throw new Error(`Los tipos no se conservaron al cambiar de hoja: ${JSON.stringify(persistentTypes)}`);
  }

  sheets.Servicios.rows[0][2] = "FALSO";
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
        values: panel ? Array.from(panel.querySelectorAll("[data-column]"), control => control.dataset.serializedValue || "") : []
      };
    })()`);
    if (checkboxRow.gid === "1" && checkboxRow.saveState === "saved" && checkboxRow.values[2] === "FALSE" && checkboxRow.values[3] === "Inicial") break;
    await delay(100);
  }
  if (checkboxRow?.values?.[2] !== "FALSE") throw new Error(`No se normalizó FALSO al cargar la fila: ${JSON.stringify(checkboxRow)}`);

  await cdp.evaluate(`(() => {
    window.__minimalPaste = null;
    document.addEventListener("paste", event => {
      window.__minimalPaste = event.clipboardData?.getData("text/plain") || "";
    }, { capture: true, once: true });
    const panel = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".panel-frame").contentDocument;
    const input = panel.querySelector('[data-column="4"] input');
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
  console.log("RELACIONES_OK: opciones con color, casillas localizadas, fecha y hora en español, tipos persistentes y caché confirmados.");
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
