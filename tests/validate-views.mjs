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
  headers: ["ID Contacto", "Nombre", "Estado", "Fecha", "", ""],
  rows: [
    ["1", "Ana", "Nuevo ", "02/10/2026", "", ""],
    ["2", "Luis", "En proceso", "15/10/2026", "", ""],
    ["3", "Mia", "", "02/11/2026", "", ""]
  ]
};
const staleVisualizationRows = sheet.rows.map((row) => [...row]);

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
        globalThis.__pastes = [];
        globalThis.__clears = [];
        document.addEventListener("paste", event => {
          const paste = {
            reference: document.getElementById("t-name-box").value,
            value: event.clipboardData?.getData("text/plain") || ""
          };
          globalThis.__lastPaste = paste;
          globalThis.__pastes.push(paste);
        }, true);
        document.addEventListener("keydown", event => {
          if (event.key === "Delete") {
            globalThis.__clears.push(document.getElementById("t-name-box").value);
          }
        }, true);
      </script>
    </body></html>`);
    return;
  }
  if (url.pathname.endsWith("/htmlembed/sheet")) {
    const range = url.searchParams.get("range") || "A1";
    const firstRow = Number(range.match(/A(\d+)/)?.[1] || 1);
    const lastRow = Number(range.match(/:[A-Z]+(\d+)/)?.[1] || firstRow);
    const rows = Array.from({ length: lastRow - firstRow + 1 }, (_, offset) => {
      const rowNumber = firstRow + offset;
      const values = rowNumber === 1 ? sheet.headers : (sheet.rows[rowNumber - 2] || []);
      return `<tr><th class="row-headers-background">${rowNumber}</th>${cells(values)}</tr>`;
    });
    response.end(`<!doctype html><table><tbody>${rows.join("")}</tbody></table>`);
    return;
  }
  if (url.pathname.endsWith("/gviz/tq")) {
    const range = url.searchParams.get("range") || "";
    const rowNumber = Number(range.match(/A(\d+)/)?.[1] || 1);
    const rows = /^A(\d+):ZZ\1$/.test(range)
      ? [rowNumber === 1 ? sheet.headers : (staleVisualizationRows[rowNumber - 2] || [])]
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
          pending.set(commandId, { resolve: commandResolve, reject: commandReject, method, expression: params.expression || "" });
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
        current.reject(new Error(`${message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text}\nExpression: ${current.expression.slice(0, 500)}`));
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
  const viewExpression = (body) => `(() => {
    const view = document.getElementById("sheets-session-probe").shadowRoot.querySelector(".sheet-view-frame").contentDocument;
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

  const initialViews = await cdp.evaluate(panelExpression('return Array.from(panel.querySelectorAll("[data-sheet-view]"), button => button.dataset.sheetView);'));
  if (JSON.stringify(initialViews) !== JSON.stringify(["table"])) {
    throw new Error(`La tabla no quedo disponible como vista base: ${JSON.stringify(initialViews)}`);
  }

  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=table]").click();'));
  const tableDeadline = Date.now() + 5_000;
  let workspaceTable;
  while (Date.now() < tableDeadline) {
    workspaceTable = await cdp.evaluate(`(() => {
      const root = document.getElementById("sheets-session-probe").shadowRoot;
      const panelFrame = root.querySelector(".panel-frame");
      const viewFrame = root.querySelector(".sheet-view-frame");
      const view = viewFrame.contentDocument;
      return {
        mainHidden: panelFrame.hidden,
        viewOpen: !viewFrame.hidden,
        viewWidth: viewFrame.getBoundingClientRect().width,
        viewportWidth: innerWidth,
        viewZIndex: Number(getComputedStyle(viewFrame).zIndex),
        launcherZIndex: Number(getComputedStyle(root.querySelector(".reopen")).zIndex),
        browser: Boolean(view.querySelector("[data-workspace-browser]")),
        documents: Array.from(view.querySelectorAll(".workspace-browser-document-button"), item => item.textContent.trim()),
        sheets: Array.from(view.querySelectorAll(".workspace-browser-sheet"), item => item.textContent.trim()),
        activeView: view.querySelector("[data-workspace-view].ant-btn-primary")?.dataset.workspaceView || "",
        deckRows: Array.from(view.querySelectorAll("[data-workspace-deck-row]"), row => row.dataset.workspaceDeckRow),
        antDrawer: Boolean(view.querySelector(".ant-drawer"))
      };
    })()`);
    if (workspaceTable.deckRows?.length === 3) break;
    await delay(100);
  }
  if (!workspaceTable.mainHidden || !workspaceTable.viewOpen || workspaceTable.viewWidth !== workspaceTable.viewportWidth || workspaceTable.launcherZIndex >= workspaceTable.viewZIndex || workspaceTable.antDrawer || !workspaceTable.browser || workspaceTable.documents.length !== 1 || !workspaceTable.sheets.includes("Contactos") || workspaceTable.activeView !== "deck" || JSON.stringify(workspaceTable.deckRows) !== JSON.stringify(["2", "3", "4"])) {
    throw new Error(`La vista Deck no cargo el documento, la hoja y sus registros: ${JSON.stringify(workspaceTable)}`);
  }

  await cdp.evaluate(viewExpression('view.querySelector("[data-workspace-view=table]").click();'));
  const workspaceRowsDeadline = Date.now() + 3_000;
  while (Date.now() < workspaceRowsDeadline) {
    if (await cdp.evaluate(viewExpression('return view.querySelectorAll("[data-workspace-row]").length === 3;'))) break;
    await delay(80);
  }
  const directEditors = await cdp.evaluate(viewExpression(`
    const row = view.querySelector('[data-workspace-row="2"]');
    const cells = Array.from(row.querySelectorAll('td[data-column-id]'));
    const actions = row.querySelector('.workspace-table-actions');
    return {
      allDirect: cells.length > 0 && cells.every(cell => Boolean(cell.querySelector('.workspace-table-cell-editor'))),
      actionsZIndex: Number(getComputedStyle(actions).zIndex),
      editorZIndex: Number(getComputedStyle(cells[0]).zIndex),
      headerActions: Array.from(view.querySelector('.sheet-view-panel-actions')?.children || [], item =>
        item.matches('[data-sheet-view-cancel]') ? 'cancel'
          : item.matches('[data-sheet-view-save]') ? 'save'
            : item.matches('[data-sheet-view-save-state]') ? 'state'
              : item.matches('[data-theme-toggle]') ? 'theme'
              : item.matches('[data-close-sheet-view]') ? 'close'
                : 'unknown'
      )
    };
  `));
  if (!directEditors.allDirect || directEditors.actionsZIndex <= directEditors.editorZIndex || JSON.stringify(directEditors.headerActions) !== JSON.stringify(["cancel", "save", "state", "theme", "close"])) {
    throw new Error(`Tabla no mantuvo los editores directos debajo de sus acciones: ${JSON.stringify(directEditors)}`);
  }
  await cdp.evaluate(viewExpression(`
    const row = view.querySelector('[data-workspace-row="2"]');
    const cell = row.querySelectorAll('td[data-column-id]')[1];
    const input = cell.querySelector('.workspace-table-cell-editor input');
    const setter = Object.getOwnPropertyDescriptor(view.defaultView.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Ana desde');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(input, 'Ana desde Tabla');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `));
  await delay(350);
  const unsavedTable = await cdp.evaluate(viewExpression(`return {
    paste: (parent.__pastes || []).some((item) => item.reference.endsWith("!B2")),
    saveDisabled: view.querySelector("[data-sheet-view-save]").disabled,
    cancelDisabled: view.querySelector("[data-sheet-view-cancel]").disabled,
    state: view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState || ""
  };`));
  if (unsavedTable.paste || unsavedTable.saveDisabled || unsavedTable.cancelDisabled || unsavedTable.state !== "pending") {
    throw new Error(`Tabla no conservo el cambio como borrador: ${JSON.stringify(unsavedTable)}`);
  }
  await cdp.evaluate(viewExpression('view.querySelector("[data-sheet-view-cancel]").click();'));
  await delay(120);
  const cancelledTable = await cdp.evaluate(viewExpression(`return {
    value: view.querySelectorAll('[data-workspace-row="2"] td[data-column-id]')[1]?.querySelector('input')?.value || "",
    saveDisabled: view.querySelector("[data-sheet-view-save]").disabled,
    state: view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState || ""
  };`));
  if (cancelledTable.value !== "Ana" || !cancelledTable.saveDisabled || cancelledTable.state !== "saved") {
    throw new Error(`Cancelar no restauro la celda de Tabla: ${JSON.stringify(cancelledTable)}`);
  }
  await cdp.evaluate(viewExpression(`
    const row = view.querySelector('[data-workspace-row="2"]');
    const input = row.querySelectorAll('td[data-column-id]')[1].querySelector('.workspace-table-cell-editor input');
    const setter = Object.getOwnPropertyDescriptor(view.defaultView.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Ana desde');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(input, 'Ana desde Tabla');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `));
  await delay(100);
  await cdp.evaluate(viewExpression('view.querySelector("[data-sheet-view-save]").click();'));
  await delay(250);
  const tableSavingPresentation = await cdp.evaluate(viewExpression(`return {
    buttonLoading: view.querySelector("[data-sheet-view-save]").classList.contains("ant-btn-loading"),
    state: view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState || "",
    bodyOpacity: getComputedStyle(view.querySelector(".sheet-view-panel-body")).opacity
  };`));
  if (tableSavingPresentation.buttonLoading || tableSavingPresentation.state !== "saving" || tableSavingPresentation.bodyOpacity !== "1") {
    throw new Error(`Guardar duplico el indicador de carga del encabezado: ${JSON.stringify(tableSavingPresentation)}`);
  }
  const inlineEditDeadline = Date.now() + 4_000;
  let inlineEditPaste;
  while (Date.now() < inlineEditDeadline) {
    inlineEditPaste = (await cdp.evaluate("globalThis.__pastes || []")).find((paste) => paste.reference.endsWith("!B2") && paste.value === "Ana desde Tabla");
    if (inlineEditPaste) break;
    await delay(50);
  }
  if (!inlineEditPaste) throw new Error("La edicion directa de Tabla no escribio el campo en Sheets");
  const inlineCellPastes = (await cdp.evaluate("globalThis.__pastes || []"))
    .filter((paste) => paste.reference.endsWith("!B2"));
  if (inlineCellPastes.length !== 1 || inlineCellPastes[0].value !== "Ana desde Tabla") {
    throw new Error(`La escritura rapida de una celda no se consolido: ${JSON.stringify(inlineCellPastes)}`);
  }
  sheet.rows[0][1] = "Ana desde Tabla";
  staleVisualizationRows[0][1] = "Ana desde Tabla";
  const tableSavedDeadline = Date.now() + 5_000;
  let tableSaved;
  while (Date.now() < tableSavedDeadline) {
    tableSaved = await cdp.evaluate(viewExpression(`return {
      disabled: view.querySelector("[data-sheet-view-save]").disabled,
      state: view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState || ""
    };`));
    if (tableSaved.disabled && tableSaved.state === "saved") break;
    await delay(80);
  }
  if (!tableSaved?.disabled || tableSaved.state !== "saved") {
    throw new Error(`Tabla no confirmo el guardado manual: ${JSON.stringify(tableSaved)}`);
  }

  await cdp.evaluate(viewExpression(`
    const updates = [
      [3, 0, '2-M'],
      [3, 1, 'Luis M'],
      [4, 0, '3-M'],
      [4, 1, 'Mia M']
    ];
    const setter = Object.getOwnPropertyDescriptor(view.defaultView.HTMLInputElement.prototype, 'value').set;
    for (const [rowNumber, columnIndex, value] of updates) {
      const input = view.querySelector('[data-workspace-row="' + rowNumber + '"]')
        .querySelectorAll('td[data-column-id]')[columnIndex]
        .querySelector('.workspace-table-cell-editor input');
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    view.querySelector('[data-sheet-view-save]').click();
  `));
  const matrixPasteDeadline = Date.now() + 4_000;
  let matrixPaste;
  while (Date.now() < matrixPasteDeadline) {
    matrixPaste = (await cdp.evaluate("globalThis.__pastes || []")).find((paste) => (
      paste.reference.endsWith("!A3") && paste.value === "2-M\tLuis M\n3-M\tMia M"
    ));
    if (matrixPaste) break;
    await delay(50);
  }
  if (!matrixPaste) throw new Error("Tabla no consolido el bloque de dos filas por dos columnas");
  sheet.rows[1][0] = "2-M";
  sheet.rows[1][1] = "Luis M";
  sheet.rows[2][0] = "3-M";
  sheet.rows[2][1] = "Mia M";
  staleVisualizationRows[1][0] = "2-M";
  staleVisualizationRows[1][1] = "Luis M";
  staleVisualizationRows[2][0] = "3-M";
  staleVisualizationRows[2][1] = "Mia M";
  const matrixSavedDeadline = Date.now() + 5_000;
  while (Date.now() < matrixSavedDeadline) {
    const saved = await cdp.evaluate(viewExpression('return view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState === "saved";'));
    if (saved) break;
    await delay(80);
  }

  await cdp.evaluate(viewExpression('view.querySelector("[data-workspace-open-row=\\"2\\"]").click();'));
  const overlayDeadline = Date.now() + 5_000;
  let originalRecord;
  while (Date.now() < overlayDeadline) {
    originalRecord = await cdp.evaluate(`(() => {
      const root = document.getElementById("sheets-session-probe").shadowRoot;
      const panelFrame = root.querySelector(".panel-frame");
      const viewFrame = root.querySelector(".sheet-view-frame");
      const panel = panelFrame.contentDocument;
      const view = viewFrame.contentDocument;
      return {
        tableVisible: Boolean(view.querySelector('[data-workspace-browser]')),
        mainVisible: !panelFrame.hidden,
        viewVisible: !viewFrame.hidden,
        originalDrawer: panel.querySelector('.drawer')?.classList.contains('is-workspace-record-overlay') || false,
        oldDrawer: Boolean(panel.querySelector('.workspace-record-drawer')),
        mask: !panel.querySelector('.workspace-record-mask')?.hidden,
        fields: panel.querySelectorAll('.drawer > main .field').length,
        row: document.getElementById("sheets-session-probe")?.dataset?.row || ''
      };
    })()`);
    if (originalRecord.originalDrawer && originalRecord.fields === 4 && originalRecord.row === "2") break;
    await delay(80);
  }
  if (!originalRecord.tableVisible || !originalRecord.mainVisible || !originalRecord.viewVisible || !originalRecord.originalDrawer || originalRecord.oldDrawer || !originalRecord.mask || originalRecord.fields !== 4 || originalRecord.row !== "2") {
    throw new Error(`Abrir no reutilizo el drawer original encima de Tabla: ${JSON.stringify(originalRecord)}`);
  }

  const propertyOverRecord = await cdp.evaluate(panelExpression(`
    const recordDrawer = panel.querySelector('.drawer.is-workspace-record-overlay');
    panel.querySelector('.drawer > main .field-configure').click();
    const propertyDrawer = panel.querySelector('.property-drawer');
    return {
      open: !propertyDrawer.hidden,
      propertyZIndex: Number(getComputedStyle(propertyDrawer).zIndex),
      recordZIndex: Number(getComputedStyle(recordDrawer).zIndex),
      title: propertyDrawer.querySelector('h2')?.textContent || ''
    };
  `));
  if (!propertyOverRecord.open || propertyOverRecord.propertyZIndex <= propertyOverRecord.recordZIndex || propertyOverRecord.title !== "Editar propiedad") {
    throw new Error(`Editar propiedad no abrio encima del registro de Tabla: ${JSON.stringify(propertyOverRecord)}`);
  }

  await cdp.evaluate(panelExpression(`
    const selector = panel.querySelector('#srd-property-type-picker')?.closest('.ant-select')?.querySelector('.ant-select-selector');
    selector?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: panel.defaultView }));
    selector?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: panel.defaultView }));
    selector?.click();
  `));
  await delay(100);
  const propertyPopupLayer = await cdp.evaluate(panelExpression(`
    const propertyDrawer = panel.querySelector('.property-drawer');
    const popup = [...panel.querySelectorAll('.ant-select-dropdown')].find((item) => getComputedStyle(item).display !== 'none');
    return {
      open: Boolean(popup),
      popupZIndex: popup ? Number(getComputedStyle(popup).zIndex) : 0,
      propertyZIndex: Number(getComputedStyle(propertyDrawer).zIndex)
    };
  `));
  if (!propertyPopupLayer.open || propertyPopupLayer.popupZIndex <= propertyPopupLayer.propertyZIndex) {
    throw new Error(`El desplegable de propiedad quedo detras del drawer: ${JSON.stringify(propertyPopupLayer)}`);
  }
  await cdp.evaluate(panelExpression('panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));'));
  await cdp.evaluate(panelExpression('panel.querySelector(".property-drawer .secondary-button").click();'));

  await cdp.evaluate(panelExpression('panel.querySelector(".drawer > header .close").click();'));
  await delay(150);
  const restoredTable = await cdp.evaluate(`(() => {
    const root = document.getElementById("sheets-session-probe").shadowRoot;
    const panelFrame = root.querySelector(".panel-frame");
    const panel = panelFrame.contentDocument;
    const view = root.querySelector(".sheet-view-frame").contentDocument;
    return {
      table: Boolean(view.querySelector('[data-workspace-row="2"]')),
      activeView: view.querySelector('[data-workspace-view].ant-btn-primary')?.dataset.workspaceView || '',
      overlay: panel.querySelector('.drawer')?.classList.contains('is-workspace-record-overlay') || false,
      mainHidden: panelFrame.hidden
    };
  })()`);
  if (!restoredTable.table || restoredTable.activeView !== "table" || restoredTable.overlay || !restoredTable.mainHidden) {
    throw new Error(`Cerrar detalles no devolvio a la misma vista Tabla: ${JSON.stringify(restoredTable)}`);
  }

  await cdp.evaluate(viewExpression(`
    const option = Array.from(view.querySelectorAll('.workspace-table-columns .ant-checkbox-wrapper'))
      .find((item) => item.textContent.trim() === 'Nombre');
    option?.querySelector('input')?.click();
  `));
  await delay(120);
  const hiddenInTable = await cdp.evaluate(viewExpression(`return {
    checked: Array.from(view.querySelectorAll('.workspace-table-columns .ant-checkbox-wrapper'))
      .find((item) => item.textContent.trim() === 'Nombre')?.querySelector('input')?.checked,
    cellVisible: Array.from(view.querySelectorAll('.workspace-data-table thead .workspace-table-column-heading > span:nth-child(2)'))
      .some((item) => item.textContent.trim() === 'Nombre')
  };`));
  if (hiddenInTable.checked !== false || hiddenInTable.cellVisible) {
    throw new Error(`Ocultar una columna no se aplico a Tabla: ${JSON.stringify(hiddenInTable)}`);
  }

  await cdp.evaluate(viewExpression('view.querySelector("[data-workspace-view=deck]").click();'));
  await delay(100);
  const hiddenInDeck = await cdp.evaluate(viewExpression(`return {
    activeView: view.querySelector('[data-workspace-view].ant-btn-primary')?.dataset.workspaceView || '',
    labels: Array.from(view.querySelectorAll('.workspace-deck-field > span:nth-child(2)'), item => item.textContent.trim())
  };`));
  if (hiddenInDeck.activeView !== "deck" || hiddenInDeck.labels.includes("Nombre")) {
    throw new Error(`La columna oculta siguio visible en Deck: ${JSON.stringify(hiddenInDeck)}`);
  }

  await cdp.evaluate(viewExpression('view.querySelector("[data-close-sheet-view]").click();'));
  await delay(150);
  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=table]").click();'));
  const persistedColumnsDeadline = Date.now() + 5_000;
  let persistedColumns;
  while (Date.now() < persistedColumnsDeadline) {
    persistedColumns = await cdp.evaluate(viewExpression(`
      view.querySelector('[data-workspace-view=table]')?.click();
      const option = Array.from(view.querySelectorAll('.workspace-table-columns .ant-checkbox-wrapper'))
        .find((item) => item.textContent.trim() === 'Nombre');
      return {
        checked: option?.querySelector('input')?.checked,
        cellVisible: Array.from(view.querySelectorAll('.workspace-data-table thead .workspace-table-column-heading > span:nth-child(2)'))
          .some((item) => item.textContent.trim() === 'Nombre')
      };
    `));
    if (persistedColumns.checked === false && !persistedColumns.cellVisible) break;
    await delay(80);
  }
  if (persistedColumns?.checked !== false || persistedColumns.cellVisible) {
    throw new Error(`La visibilidad de columnas no persistio al reabrir Tabla: ${JSON.stringify(persistedColumns)}`);
  }

  await cdp.evaluate(viewExpression('view.querySelector("[data-workspace-open-row=\\"2\\"]").click();'));
  const hiddenDrawerDeadline = Date.now() + 5_000;
  let hiddenInDrawer;
  while (Date.now() < hiddenDrawerDeadline) {
    hiddenInDrawer = await cdp.evaluate(panelExpression(`return {
      open: panel.querySelector('.drawer')?.classList.contains('is-workspace-record-overlay') || false,
      labels: Array.from(panel.querySelectorAll('.drawer > main .field:not([hidden]) .field-label-text'), item => item.textContent.trim()),
      hiddenDisplay: (() => {
        const field = Array.from(panel.querySelectorAll('.drawer > main .field'))
          .find(item => item.querySelector('.field-label-text')?.textContent.trim() === 'Nombre');
        return field ? getComputedStyle(field).display : '';
      })()
    };`));
    if (hiddenInDrawer.open) break;
    await delay(80);
  }
  if (!hiddenInDrawer?.open || hiddenInDrawer.labels.includes("Nombre") || hiddenInDrawer.labels.length !== 3 || hiddenInDrawer.hiddenDisplay !== "none") {
    throw new Error(`La columna oculta siguio visible en el drawer: ${JSON.stringify(hiddenInDrawer)}`);
  }
  await cdp.evaluate(panelExpression('panel.querySelector(".drawer > header .close").click();'));
  await delay(120);
  await cdp.evaluate(viewExpression(`
    const option = Array.from(view.querySelectorAll('.workspace-table-columns .ant-checkbox-wrapper'))
      .find((item) => item.textContent.trim() === 'Nombre');
    option?.querySelector('input')?.click();
  `));
  await delay(120);
  const restoredColumn = await cdp.evaluate(viewExpression(`return {
    checked: Array.from(view.querySelectorAll('.workspace-table-columns .ant-checkbox-wrapper'))
      .find((item) => item.textContent.trim() === 'Nombre')?.querySelector('input')?.checked,
    cellVisible: Array.from(view.querySelectorAll('.workspace-data-table thead .workspace-table-column-heading > span:nth-child(2)'))
      .some((item) => item.textContent.trim() === 'Nombre')
  };`));
  if (!restoredColumn.checked || !restoredColumn.cellVisible) {
    throw new Error(`Volver a mostrar la columna no se aplico: ${JSON.stringify(restoredColumn)}`);
  }

  await cdp.evaluate(viewExpression('view.querySelector("[data-workspace-add-row]").click();'));
  const newRowDeadline = Date.now() + 4_000;
  let newRowDrawer;
  while (Date.now() < newRowDeadline) {
    newRowDrawer = await cdp.evaluate(panelExpression(`return {
      open: panel.querySelector('.drawer')?.classList.contains('is-workspace-record-overlay') || false,
      fields: panel.querySelectorAll('.drawer > main .field').length,
      creating: panel.defaultView.frameElement.getRootNode().host?.dataset?.creatingRecord || '',
      row: panel.defaultView.frameElement.getRootNode().host?.dataset?.row || '',
      save: Boolean(panel.querySelector('.drawer > footer .save'))
    };`));
    if (newRowDrawer.open && newRowDrawer.creating === "true" && newRowDrawer.row === "5") break;
    await delay(80);
  }
  if (!newRowDrawer.open || newRowDrawer.fields !== 4 || newRowDrawer.creating !== "true" || newRowDrawer.row !== "5" || !newRowDrawer.save) {
    throw new Error(`Nuevo registro no uso el formulario original sobre Tabla: ${JSON.stringify(newRowDrawer)}`);
  }
  await cdp.evaluate(panelExpression(`
    const input = panel.querySelector('[data-column="2"] input');
    const setter = Object.getOwnPropertyDescriptor(panel.defaultView.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Registro desde Tabla");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    panel.querySelector('.drawer > footer .save').click();
  `));
  const createDeadline = Date.now() + 4_000;
  let createPaste;
  while (Date.now() < createDeadline) {
    createPaste = (await cdp.evaluate("globalThis.__pastes || []")).find((paste) => paste.reference.endsWith("!B5") && paste.value === "Registro desde Tabla");
    if (createPaste) break;
    await delay(50);
  }
  if (!createPaste) throw new Error("Nuevo registro de Tabla no se escribio en Sheets");
  sheet.rows.push(["", "Registro desde Tabla", "", "", "", ""]);
  staleVisualizationRows.push(["", "Registro desde Tabla", "", "", "", ""]);
  const createdDeadline = Date.now() + 5_000;
  while (Date.now() < createdDeadline) {
    const creating = await cdp.evaluate('document.getElementById("sheets-session-probe")?.dataset?.creatingRecord || ""');
    if (!creating) break;
    await delay(100);
  }
  await cdp.evaluate(panelExpression('panel.querySelector(".drawer > header .close").click();'));
  await delay(200);
  const clearButtonDeadline = Date.now() + 4_000;
  while (Date.now() < clearButtonDeadline) {
    if (await cdp.evaluate(viewExpression('return Boolean(view.querySelector("[aria-label=\\"Limpiar fila 5\\"]"));'))) break;
    await delay(80);
  }
  const clearButtonReady = await cdp.evaluate(viewExpression('return Boolean(view.querySelector("[aria-label=\\"Limpiar fila 5\\"]"));'));
  if (!clearButtonReady) {
    const diagnostics = await cdp.evaluate(viewExpression(`return {
      browser: Boolean(view.querySelector("[data-workspace-browser]")),
      rows: Array.from(view.querySelectorAll("[data-workspace-row]"), row => row.dataset.workspaceRow),
      clearLabels: Array.from(view.querySelectorAll("[aria-label^=\\"Limpiar fila\\"]"), button => button.getAttribute("aria-label"))
    };`));
    throw new Error(`El nuevo registro no permanecio visible en la tabla despues de guardarlo: ${JSON.stringify(diagnostics)}`);
  }
  await cdp.evaluate(viewExpression('view.querySelector("[aria-label=\\"Limpiar fila 5\\"]").click();'));
  await delay(250);
  const clearPending = await cdp.evaluate(viewExpression(`return {
    rowVisible: Boolean(view.querySelector('[data-workspace-row="5"]')),
    wrote: (parent.__clears || []).some((reference) => reference.endsWith("!B5")),
    saveDisabled: view.querySelector("[data-sheet-view-save]").disabled,
    viewOpen: !view.defaultView.frameElement.hidden
  };`));
  if (clearPending.rowVisible || clearPending.wrote || clearPending.saveDisabled || !clearPending.viewOpen) {
    throw new Error(`Limpiar fila no quedo pendiente antes de guardar: ${JSON.stringify(clearPending)}`);
  }
  await cdp.evaluate(viewExpression('view.querySelector("[data-sheet-view-cancel]").click();'));
  await delay(120);
  const restoredClearedRow = await cdp.evaluate(viewExpression('return Boolean(view.querySelector(\'[data-workspace-row="5"]\'));'));
  if (!restoredClearedRow) throw new Error("Cancelar no restauro la fila limpiada en Tabla");
  await cdp.evaluate(viewExpression('view.querySelector(\'[aria-label="Limpiar fila 5"]\').click();'));
  await delay(100);
  await cdp.evaluate(viewExpression('view.querySelector("[data-sheet-view-save]").click();'));
  const clearTableDeadline = Date.now() + 4_000;
  let tableClears;
  while (Date.now() < clearTableDeadline) {
    tableClears = await cdp.evaluate("globalThis.__clears || []");
    if (tableClears.some((reference) => reference.endsWith("!B5"))) break;
    await delay(50);
  }
  if (!tableClears.some((reference) => reference.endsWith("!B5"))) {
    throw new Error(`Limpiar un registro desde Tabla no limpio Sheets: ${JSON.stringify(tableClears)}`);
  }
  await cdp.evaluate(viewExpression(`
    view.defaultView.__workspaceLoadingSeen = Boolean(view.querySelector(".workspace-browser-loading"));
    view.defaultView.__workspaceLoadingObserver = new MutationObserver(() => {
      if (view.querySelector(".workspace-browser-loading")) view.defaultView.__workspaceLoadingSeen = true;
    });
    view.defaultView.__workspaceLoadingObserver.observe(view.body, { childList: true, subtree: true });
  `));
  await cdp.evaluate(`(() => {
    document.querySelector(".docs-sheet-active-tab .docs-sheet-tab-name").textContent = "Otra hoja";
    location.hash = "#gid=1&range=B5";
  })()`);
  await delay(550);
  const viewAfterClearSheetChange = await cdp.evaluate(`(() => {
    const root = document.getElementById("sheets-session-probe").shadowRoot;
    const frame = root.querySelector(".sheet-view-frame");
    return {
      open: !frame.hidden,
      panel: frame.contentDocument.querySelector("[data-sheet-view-panel]")?.dataset.sheetViewPanel || "",
      loadingSeen: frame.contentWindow.__workspaceLoadingSeen === true
    };
  })()`);
  if (!viewAfterClearSheetChange.open || viewAfterClearSheetChange.panel !== "table" || viewAfterClearSheetChange.loadingSeen) {
    throw new Error(`Limpiar una fila interrumpio la vista al cambiar la hoja activa: ${JSON.stringify(viewAfterClearSheetChange)}`);
  }
  await cdp.evaluate(viewExpression('view.defaultView.__workspaceLoadingObserver?.disconnect();'));
  await cdp.evaluate(`(() => {
    document.querySelector(".docs-sheet-active-tab .docs-sheet-tab-name").textContent = "Contactos";
    location.hash = "#gid=0&range=B5";
  })()`);
  await delay(350);
  sheet.rows.pop();
  staleVisualizationRows.pop();
  const clearSavedDeadline = Date.now() + 5_000;
  while (Date.now() < clearSavedDeadline) {
    const saved = await cdp.evaluate(viewExpression('return view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState === "saved";'));
    if (saved) break;
    await delay(80);
  }
  await cdp.evaluate(viewExpression('view.querySelector("[data-close-sheet-view]")?.click();'));
  await delay(180);

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
  if (JSON.stringify(statusButtons) !== JSON.stringify(["table", "kanban"])) {
    throw new Error(`La condicion de Kanban no se aplico: ${JSON.stringify(statusButtons)}`);
  }

  await configureColumn(4, "date");
  const viewButtons = await cdp.evaluate(panelExpression(`
    return {
      views: Array.from(panel.querySelectorAll("[data-sheet-view]"), button => button.dataset.sheetView),
      beforeCheck: panel.querySelector(".sheet-view-actions")?.nextElementSibling?.classList.contains("save-state") || false
    };
  `));
  if (JSON.stringify(viewButtons.views) !== JSON.stringify(["table", "kanban", "calendar"]) || !viewButtons.beforeCheck) {
    throw new Error(`Los botones no quedaron antes de la validacion: ${JSON.stringify(viewButtons)}`);
  }

  await cdp.evaluate(`(() => {
    document.getElementById("t-name-box").value = "A2";
    location.hash = "#gid=0&range=A2";
  })()`);
  const selectedRowDeadline = Date.now() + 5_000;
  while (Date.now() < selectedRowDeadline) {
    const selectedRowReady = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
      return host.dataset.row === "2" && panel.querySelectorAll(".field").length === 4;
    })()`);
    if (selectedRowReady) break;
    await delay(80);
  }

  const configuredSheetSnapshot = {
    headers: [...sheet.headers],
    rows: sheet.rows.map((row) => [...row]),
    staleRows: staleVisualizationRows.map((row) => [...row])
  };
  const replaceSheetData = (headers, rows, staleRows = rows) => {
    sheet.headers.splice(0, sheet.headers.length, ...headers);
    sheet.rows.splice(0, sheet.rows.length, ...rows.map((row) => [...row]));
    staleVisualizationRows.splice(0, staleVisualizationRows.length, ...staleRows.map((row) => [...row]));
  };
  const notifySheetChange = () => cdp.evaluate(`window.postMessage({
    source: "sheets-row-drawer",
    type: "sheet-change"
  }, location.origin)`, isolated.executionContextId);
  const waitForPropertyLayout = async (expectedLabels, expectedTypes) => {
    const layoutDeadline = Date.now() + 5_000;
    let layout;
    while (Date.now() < layoutDeadline) {
      layout = await cdp.evaluate(panelExpression(`return {
        labels: Array.from(panel.querySelectorAll('.field-label-text'), item => item.textContent.trim()),
        types: Array.from(panel.querySelectorAll('.field-type-name'), item => item.textContent.trim())
      };`));
      if (JSON.stringify(layout.labels) === JSON.stringify(expectedLabels) && JSON.stringify(layout.types) === JSON.stringify(expectedTypes)) return layout;
      await delay(80);
    }
    return layout;
  };

  replaceSheetData(
    configuredSheetSnapshot.headers.filter((_, index) => index !== 3),
    configuredSheetSnapshot.rows.map((row) => row.filter((_, index) => index !== 3)),
    configuredSheetSnapshot.staleRows.map((row) => row.filter((_, index) => index !== 3))
  );
  await notifySheetChange();
  const partialHeaderLayout = await waitForPropertyLayout(["ID Contacto", "Nombre", "Estado"], ["text", "text", "status"]);
  if (JSON.stringify(partialHeaderLayout?.types) !== JSON.stringify(["text", "text", "status"])) {
    throw new Error(`La prueba no alcanzo la lectura parcial de encabezados: ${JSON.stringify(partialHeaderLayout)}`);
  }

  replaceSheetData(
    configuredSheetSnapshot.headers.filter((_, index) => index !== 2),
    configuredSheetSnapshot.rows.map((row) => row.filter((_, index) => index !== 2)),
    configuredSheetSnapshot.staleRows.map((row) => row.filter((_, index) => index !== 2))
  );
  await notifySheetChange();
  const afterColumnDeletion = await waitForPropertyLayout(["ID Contacto", "Nombre", "Fecha"], ["text", "text", "date"]);
  if (JSON.stringify(afterColumnDeletion?.labels) !== JSON.stringify(["ID Contacto", "Nombre", "Fecha"]) || JSON.stringify(afterColumnDeletion?.types) !== JSON.stringify(["text", "text", "date"])) {
    throw new Error(`Eliminar una columna desplazo la configuracion de otra propiedad: ${JSON.stringify(afterColumnDeletion)}`);
  }

  replaceSheetData(configuredSheetSnapshot.headers, configuredSheetSnapshot.rows, configuredSheetSnapshot.staleRows);
  await notifySheetChange();
  const restoredPropertyLayout = await waitForPropertyLayout(
    ["ID Contacto", "Nombre", "Estado", "Fecha"],
    ["text", "text", "status", "date"]
  );
  if (JSON.stringify(restoredPropertyLayout?.types) !== JSON.stringify(["text", "text", "status", "date"])) {
    throw new Error(`Restaurar encabezados no recupero sus propiedades por nombre: ${JSON.stringify(restoredPropertyLayout)}`);
  }

  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=kanban]").click();'));
  const kanbanDeadline = Date.now() + 5_000;
  let kanban;
  while (Date.now() < kanbanDeadline) {
    kanban = await cdp.evaluate(viewExpression(`
      const surface = view.querySelector(".sheet-view-panel");
      return {
        title: surface?.querySelector(".sheet-view-panel-title")?.textContent || "",
        groups: Array.from(surface?.querySelectorAll("[data-kanban-group]") || [], group => ({
          id: group.dataset.kanbanGroup,
          count: Number(group.querySelector(".kanban-count")?.textContent || 0)
        })),
        rows: Array.from(surface?.querySelectorAll(".kanban-card-shell") || [], card => card.dataset.sheetRow)
      };
    `));
    if (kanban.rows?.length === 3) break;
    await delay(100);
  }
  if (!kanban.title.includes("Kanban") || kanban.rows.length !== 3 || kanban.groups[0]?.id !== "__empty__" || !kanban.groups.some((group) => group.id === "Nuevo" && group.count === 1) || !kanban.groups.some((group) => group.id === "__empty__" && group.count === 1)) {
    throw new Error(`Kanban no represento toda la hoja: ${JSON.stringify(kanban)}`);
  }

  const kanbanLayoutDefaults = await cdp.evaluate(viewExpression(`
    const board = view.querySelector('.kanban-board');
    return {
      columnsInput: view.querySelector('[data-kanban-columns]')?.value || '',
      heightInput: view.querySelector('[data-kanban-height]')?.value || '',
      columns: board?.style.getPropertyValue('--kanban-columns') || '',
      height: board?.style.getPropertyValue('--kanban-height') || '',
      firstColumnHeight: view.querySelector('.kanban-column') ? getComputedStyle(view.querySelector('.kanban-column')).height : ''
    };
  `));
  if (kanbanLayoutDefaults.columnsInput !== "3" || kanbanLayoutDefaults.heightInput !== "600" || kanbanLayoutDefaults.columns !== "3" || kanbanLayoutDefaults.height !== "600px" || kanbanLayoutDefaults.firstColumnHeight !== "600px") {
    throw new Error(`Kanban no aplico la configuracion inicial del ejemplo: ${JSON.stringify(kanbanLayoutDefaults)}`);
  }

  await cdp.evaluate(viewExpression(`
    const setNumber = (selector, value) => {
      const input = view.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(view.defaultView.HTMLInputElement.prototype, 'value').set;
      setter.call(input, String(value));
      input.dispatchEvent(new view.defaultView.Event('input', { bubbles: true }));
      input.dispatchEvent(new view.defaultView.Event('change', { bubbles: true }));
    };
    setNumber('[data-kanban-columns]', 2);
    setNumber('[data-kanban-height]', 480);
  `));
  await delay(100);
  const configuredKanbanLayout = await cdp.evaluate(viewExpression(`
    const board = view.querySelector('.kanban-board');
    const columns = Array.from(view.querySelectorAll('.kanban-column'));
    return {
      columns: board?.style.getPropertyValue('--kanban-columns') || '',
      height: board?.style.getPropertyValue('--kanban-height') || '',
      firstColumnHeight: columns[0] ? getComputedStyle(columns[0]).height : '',
      firstTop: columns[0]?.offsetTop || 0,
      thirdTop: columns[2]?.offsetTop || 0
    };
  `));
  if (configuredKanbanLayout.columns !== "2" || configuredKanbanLayout.height !== "480px" || configuredKanbanLayout.firstColumnHeight !== "480px" || configuredKanbanLayout.thirdTop <= configuredKanbanLayout.firstTop) {
    throw new Error(`Kanban no aplico columnas por fila y alto: ${JSON.stringify(configuredKanbanLayout)}`);
  }

  const independentKanban = await cdp.evaluate(`(() => {
    const root = document.getElementById("sheets-session-probe").shadowRoot;
    const panelFrame = root.querySelector(".panel-frame");
    const viewFrame = root.querySelector(".sheet-view-frame");
    const view = viewFrame.contentDocument;
    return {
      mainHidden: panelFrame.hidden,
      viewOpen: !viewFrame.hidden,
      width: viewFrame.getBoundingClientRect().width,
      height: viewFrame.getBoundingClientRect().height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      transition: getComputedStyle(viewFrame).transitionDuration,
      antDrawer: Boolean(view.querySelector(".ant-drawer")),
      expandAction: Boolean(view.querySelector("[data-kanban-expand]"))
    };
  })()`);
  if (!independentKanban.mainHidden || !independentKanban.viewOpen || independentKanban.width !== independentKanban.viewportWidth || independentKanban.height !== independentKanban.viewportHeight || independentKanban.transition !== "0s" || independentKanban.antDrawer || independentKanban.expandAction) {
    throw new Error(`Kanban no abrio como superficie completa independiente: ${JSON.stringify(independentKanban)}`);
  }

  const rapidReturnOrigin = await cdp.evaluate(viewExpression(`return view.querySelector('.kanban-card-shell[data-sheet-row="2"]')?.closest('[data-kanban-group]')?.dataset.kanbanGroup || "";`));
  await cdp.evaluate(viewExpression(`
    const card = view.querySelector('.kanban-card-shell[data-sheet-row="2"]');
    const target = [...view.querySelectorAll('[data-kanban-group]')]
      .find((column) => column.dataset.kanbanGroup !== ${JSON.stringify(rapidReturnOrigin)})
      ?.querySelector('.cards');
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: target.getBoundingClientRect().top + 120,
      dataTransfer
    }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  `));
  await delay(20);
  await cdp.evaluate(viewExpression(`
    const card = view.querySelector('.kanban-card-shell[data-sheet-row="2"]');
    const target = view.querySelector('[data-kanban-group=${JSON.stringify(rapidReturnOrigin)}] .cards');
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: target.getBoundingClientRect().top + 120,
      dataTransfer
    }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  `));
  await delay(80);
  const rapidReturnState = await cdp.evaluate(viewExpression(`return {
    group: view.querySelector('.kanban-card-shell[data-sheet-row="2"]')?.closest('[data-kanban-group]')?.dataset.kanbanGroup || "",
    saveDisabled: view.querySelector('[data-sheet-view-save]').disabled,
    state: view.querySelector('[data-sheet-view-save-state]')?.dataset.sheetViewSaveState || ""
  };`));
  if (rapidReturnState.group !== rapidReturnOrigin || !rapidReturnState.saveDisabled || rapidReturnState.state !== "saved") {
    throw new Error(`Kanban mantuvo cambios pendientes despues de devolver rapidamente una tarjeta: ${JSON.stringify({ rapidReturnOrigin, rapidReturnState })}`);
  }

  await cdp.evaluate(viewExpression(`
    const card = view.querySelector('.kanban-card-shell[data-sheet-row="2"]');
    const target = [...view.querySelectorAll('[data-kanban-group]')]
      .find((column) => column.dataset.kanbanGroup !== ${JSON.stringify(rapidReturnOrigin)})
      ?.querySelector('.cards');
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: target.getBoundingClientRect().top + 120,
      dataTransfer
    }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  `));
  await delay(80);
  const thirdMoveState = await cdp.evaluate(viewExpression(`return {
    group: view.querySelector('.kanban-card-shell[data-sheet-row="2"]')?.closest('[data-kanban-group]')?.dataset.kanbanGroup || "",
    saveDisabled: view.querySelector('[data-sheet-view-save]').disabled,
    state: view.querySelector('[data-sheet-view-save-state]')?.dataset.sheetViewSaveState || ""
  };`));
  if (thirdMoveState.group === rapidReturnOrigin || thirdMoveState.saveDisabled || thirdMoveState.state !== "pending") {
    throw new Error(`Kanban no detecto el tercer movimiento despues de volver al origen: ${JSON.stringify({ rapidReturnOrigin, thirdMoveState })}`);
  }

  await cdp.evaluate(viewExpression(`
    const card = view.querySelector('.kanban-card-shell[data-sheet-row="2"]');
    const target = view.querySelector('[data-kanban-group=${JSON.stringify(rapidReturnOrigin)}] .cards');
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: target.getBoundingClientRect().top + 120,
      dataTransfer
    }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  `));
  await delay(80);
  const fourthReturnState = await cdp.evaluate(viewExpression(`return {
    group: view.querySelector('.kanban-card-shell[data-sheet-row="2"]')?.closest('[data-kanban-group]')?.dataset.kanbanGroup || "",
    saveDisabled: view.querySelector('[data-sheet-view-save]').disabled,
    state: view.querySelector('[data-sheet-view-save-state]')?.dataset.sheetViewSaveState || ""
  };`));
  if (fourthReturnState.group !== rapidReturnOrigin || !fourthReturnState.saveDisabled || fourthReturnState.state !== "saved") {
    throw new Error(`Kanban no limpio el cuarto movimiento al volver otra vez al origen: ${JSON.stringify({ rapidReturnOrigin, fourthReturnState })}`);
  }

  await cdp.evaluate(viewExpression('view.querySelector(\'.kanban-card-shell[data-sheet-row="4"]\').click();'));
  await delay(250);
  const afterSingleClick = await cdp.evaluate(`({ box: document.getElementById("t-name-box").value, row: document.getElementById("sheets-session-probe").dataset.row })`);
  if (afterSingleClick.box === "A4" && afterSingleClick.row === "4") {
    throw new Error(`La tarjeta abrio su fila con un solo clic: ${JSON.stringify(afterSingleClick)}`);
  }

  const firstNativeDrag = await cdp.evaluate(viewExpression(`
    const card = view.querySelector('.card[data-sheet-row="4"]');
    const target = view.querySelector('[data-kanban-group="En proceso"] .cards');
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: target.getBoundingClientRect().top + 120,
      dataTransfer
    }));
    const during = card.closest('[data-kanban-group]')?.dataset.kanbanGroup || '';
    const dragging = card.classList.contains('dragging');
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
    return { during, dragging };
  `));
  if (firstNativeDrag.during !== "En proceso" || !firstNativeDrag.dragging) {
    throw new Error(`Kanban no reemplazo el arrastre con el flujo nativo: ${JSON.stringify(firstNativeDrag)}`);
  }
  const firstFrameKanbanGroup = await cdp.evaluate(viewExpression(`return view.querySelector('.kanban-card-shell[data-sheet-row="4"]')?.closest('[data-kanban-group]')?.dataset.kanbanGroup || "";`));
  if (firstFrameKanbanGroup !== "En proceso") {
    throw new Error(`Kanban reboto a la columna de origen en el primer frame: ${firstFrameKanbanGroup || "sin columna"}`);
  }
  await delay(50);
  await delay(200);
  await cdp.evaluate(viewExpression(`
    const card = view.querySelector('.kanban-card-shell[data-sheet-row="3"]');
    const target = view.querySelector('[data-kanban-group="Nuevo"] .cards');
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: target.getBoundingClientRect().top + 120,
      dataTransfer
    }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  `));
  await delay(225);
  const pendingKanban = await cdp.evaluate(viewExpression(`return {
    wrote: (parent.__pastes || []).some((paste) => paste.reference.endsWith("!C3") || paste.reference.endsWith("!C4")),
    saveDisabled: view.querySelector("[data-sheet-view-save]").disabled,
    cancelDisabled: view.querySelector("[data-sheet-view-cancel]").disabled,
    state: view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState || "",
    row3Group: view.querySelector('.kanban-card-shell[data-sheet-row="3"]')?.closest('[data-kanban-group]')?.dataset.kanbanGroup || "",
    row4Group: view.querySelector('.kanban-card-shell[data-sheet-row="4"]')?.closest('[data-kanban-group]')?.dataset.kanbanGroup || ""
  };`));
  if (pendingKanban.wrote || pendingKanban.saveDisabled || pendingKanban.cancelDisabled || pendingKanban.state !== "pending" || pendingKanban.row3Group !== "Nuevo" || pendingKanban.row4Group !== "En proceso") {
    throw new Error(`Kanban no conservo los movimientos como borrador: ${JSON.stringify(pendingKanban)}`);
  }
  await cdp.evaluate(viewExpression(`
    const card = view.querySelector('.card[data-sheet-row="3"]');
    const target = view.querySelector('.card[data-sheet-row="2"]');
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: target.getBoundingClientRect().top + 2,
      dataTransfer
    }));
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
  `));
  await delay(100);
  const verticalOrder = await cdp.evaluate(viewExpression(`return Array.from(
    view.querySelector('[data-kanban-group="Nuevo"]')?.querySelectorAll('.card[data-sheet-row]') || [],
    card => card.dataset.sheetRow
  );`));
  if (JSON.stringify(verticalOrder) !== JSON.stringify(["3", "2"])) {
    throw new Error(`Kanban no conservo el orden vertical nativo: ${JSON.stringify(verticalOrder)}`);
  }
  await cdp.evaluate(viewExpression('view.querySelector("[data-sheet-view-save]").click();'));
  const pasteDeadline = Date.now() + 4_000;
  let pastes = [];
  while (Date.now() < pasteDeadline) {
    pastes = await cdp.evaluate("globalThis.__pastes || []");
    const batched = pastes.some((paste) => paste.reference.endsWith("!C3") && paste.value === "Nuevo\nEn proceso");
    const split = pastes.some((paste) => paste.reference.endsWith("!C4") && paste.value === "En proceso")
      && pastes.some((paste) => paste.reference.endsWith("!C3") && paste.value === "Nuevo");
    if (batched || split) break;
    await delay(50);
  }
  const batchedWrites = pastes.some((paste) => paste.reference.endsWith("!C3") && paste.value === "Nuevo\nEn proceso");
  const serializedWrites = pastes.some((paste) => paste.reference.endsWith("!C4") && paste.value === "En proceso")
    && pastes.some((paste) => paste.reference.endsWith("!C3") && paste.value === "Nuevo");
  if (!batchedWrites && !serializedWrites) {
    throw new Error(`Kanban no guardo correctamente los cambios agrupados de Estado: ${JSON.stringify(pastes)}`);
  }
  sheet.rows[1][2] = "Nuevo";
  const pastesBeforeRepair = pastes.length;
  const repairDeadline = Date.now() + 4_000;
  let repairedMissingWrite = false;
  while (Date.now() < repairDeadline) {
    const repairPastes = await cdp.evaluate("globalThis.__pastes || []");
    repairedMissingWrite = repairPastes.slice(pastesBeforeRepair).some((paste) => (
      paste.reference.endsWith("!C4") && paste.value === "En proceso"
    ));
    if (repairedMissingWrite) break;
    await delay(50);
  }
  if (!repairedMissingWrite) {
    throw new Error("Kanban no reintento la celda faltante despues de verificar el lote");
  }
  sheet.rows[2][2] = "En proceso";
  const kanbanSavedDeadline = Date.now() + 5_000;
  let kanbanSaved = false;
  while (Date.now() < kanbanSavedDeadline) {
    kanbanSaved = await cdp.evaluate(viewExpression('return view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState === "saved";'));
    if (kanbanSaved) break;
    await delay(80);
  }
  if (!kanbanSaved) throw new Error("Kanban no confirmo el guardado manual de los movimientos");
  const editedSelection = await cdp.evaluate('document.getElementById("t-name-box").value');
  if (!editedSelection.endsWith("!C3")) {
    throw new Error(`Kanban restauro la seleccion anterior en lugar de conservar la ultima celda editada: ${editedSelection}`);
  }
  const emptyDropHintHidden = await cdp.evaluate(viewExpression(`
    const card = view.querySelector('.kanban-card-shell[data-sheet-row="2"]');
    const target = view.querySelector('[data-kanban-group="__empty__"] .cards');
    const dataTransfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientY: target.getBoundingClientRect().top + 120,
      dataTransfer
    }));
    const hidden = getComputedStyle(target.querySelector('.kanban-empty-drop')).display === 'none';
    card.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
    return hidden;
  `));
  if (!emptyDropHintHidden) throw new Error('Kanban mostro el aviso vacio mientras una tarjeta ocupaba la zona de destino');
  await delay(225);
  const pendingClear = await cdp.evaluate(viewExpression(`return {
    wrote: (parent.__clears || []).includes("'Contactos'!C2"),
    saveDisabled: view.querySelector("[data-sheet-view-save]").disabled,
    state: view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState || "",
    group: view.querySelector('.kanban-card-shell[data-sheet-row="2"]')?.closest('[data-kanban-group]')?.dataset.kanbanGroup || ""
  };`));
  if (pendingClear.wrote || pendingClear.saveDisabled || pendingClear.state !== "pending" || pendingClear.group !== "__empty__") {
    throw new Error(`Kanban no dejo pendiente la limpieza de Estado: ${JSON.stringify(pendingClear)}`);
  }
  await cdp.evaluate(viewExpression('view.querySelector("[data-sheet-view-save]").click();'));
  const clearDeadline = Date.now() + 4_000;
  let clears = [];
  while (Date.now() < clearDeadline) {
    clears = await cdp.evaluate("globalThis.__clears || []");
    if (clears.includes("'Contactos'!C2")) break;
    await delay(50);
  }
  if (!clears.includes("'Contactos'!C2")) {
    throw new Error(`Mover a Sin seleccion no limpio la celda de Estado: ${JSON.stringify(clears)}`);
  }
  sheet.rows[0][2] = "";
  const clearKanbanSavedDeadline = Date.now() + 5_000;
  let clearKanbanSaved = false;
  while (Date.now() < clearKanbanSavedDeadline) {
    clearKanbanSaved = await cdp.evaluate(viewExpression('return view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState === "saved";'));
    if (clearKanbanSaved) break;
    await delay(80);
  }
  if (!clearKanbanSaved) throw new Error("Kanban no confirmo el guardado manual al limpiar Estado");
  const clearedSelection = await cdp.evaluate('document.getElementById("t-name-box").value');
  if (!clearedSelection.endsWith("!C2")) {
    throw new Error(`La limpieza del Kanban no conservo la celda editada: ${clearedSelection}`);
  }
  await cdp.evaluate(viewExpression(`
    view.querySelector('.kanban-card-shell[data-sheet-row="4"]').dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: 2,
      button: 0
    }));
  `));

  const rowDeadline = Date.now() + 5_000;
  let selected;
  while (Date.now() < rowDeadline) {
    selected = await cdp.evaluate(`({ box: document.getElementById("t-name-box").value, row: document.getElementById("sheets-session-probe").dataset.row })`);
    if (selected.box === "A4" && selected.row === "4") break;
    await delay(100);
  }
  if (selected?.box !== "A4" || selected.row !== "4") {
    throw new Error(`La tarjeta no abrio su fila despues del guardado manual: ${JSON.stringify(selected)}`);
  }

  await delay(250);
  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=calendar]").click();'));
  const calendarDeadline = Date.now() + 5_000;
  let calendar;
  while (Date.now() < calendarDeadline) {
    calendar = await cdp.evaluate(viewExpression(`
      const surface = view.querySelector(".sheet-view-panel");
      return {
        title: surface?.querySelector(".sheet-view-panel-title")?.textContent || "",
        month: surface?.querySelector(".month-controls strong")?.textContent || "",
        weekdays: Array.from(surface?.querySelectorAll(".calendar-weekday") || [], day => day.textContent),
        rows: Array.from(surface?.querySelectorAll(".calendar-item") || [], item => item.dataset.sheetRow)
      };
    `));
    if (calendar.rows?.length === 3) break;
    await delay(100);
  }
  if (!calendar.title.includes("Calendario") || calendar.month !== "octubre 2026" || calendar.weekdays.join("") !== "LunMarMiéJueVieSábDom" || JSON.stringify(calendar.rows) !== JSON.stringify(["2", "3", "4"])) {
    throw new Error(`Calendario no siguio el patron de Workspace: ${JSON.stringify(calendar)}`);
  }

  let independentCalendar = await cdp.evaluate(`(() => {
    const root = document.getElementById("sheets-session-probe").shadowRoot;
    const panelFrame = root.querySelector(".panel-frame");
    const viewFrame = root.querySelector(".sheet-view-frame");
    const view = viewFrame.contentDocument;
    return {
      mainHidden: panelFrame.hidden,
      viewOpen: !viewFrame.hidden,
      width: viewFrame.getBoundingClientRect().width,
      height: viewFrame.getBoundingClientRect().height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      transition: getComputedStyle(viewFrame).transitionDuration,
      antDrawer: Boolean(view.querySelector(".ant-drawer")),
      expandAction: Boolean(view.querySelector("[data-calendar-expand]"))
    };
  })()`);
  if (!independentCalendar.mainHidden || !independentCalendar.viewOpen || independentCalendar.width !== independentCalendar.viewportWidth || independentCalendar.height !== independentCalendar.viewportHeight || independentCalendar.transition !== "0s" || independentCalendar.antDrawer || independentCalendar.expandAction) {
    throw new Error(`Calendario no abrio como superficie completa independiente: ${JSON.stringify(independentCalendar)}`);
  }

  await cdp.evaluate(viewExpression('view.querySelector("[data-close-sheet-view]").click();'));
  await delay(180);
  const calendarClosed = await cdp.evaluate(`(() => {
    const root = document.getElementById("sheets-session-probe").shadowRoot;
    return {
      mainHidden: root.querySelector(".panel-frame").hidden,
      viewHidden: root.querySelector(".sheet-view-frame").hidden
    };
  })()`);
  if (calendarClosed.mainHidden || !calendarClosed.viewHidden) {
    throw new Error(`Cerrar Calendario no restauro el drawer principal: ${JSON.stringify(calendarClosed)}`);
  }

  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=calendar]").click();'));
  const calendarReopenDeadline = Date.now() + 5_000;
  while (Date.now() < calendarReopenDeadline) {
    independentCalendar = await cdp.evaluate(`(() => {
      const root = document.getElementById("sheets-session-probe").shadowRoot;
      const panelFrame = root.querySelector(".panel-frame");
      const viewFrame = root.querySelector(".sheet-view-frame");
      const view = viewFrame.contentDocument;
      return {
        mainHidden: panelFrame.hidden,
        viewOpen: !viewFrame.hidden,
        rows: view.querySelectorAll(".calendar-item").length
      };
    })()`);
    if (independentCalendar.mainHidden && independentCalendar.viewOpen && independentCalendar.rows === 3) break;
    await delay(100);
  }
  if (!independentCalendar.mainHidden || !independentCalendar.viewOpen || independentCalendar.rows !== 3) {
    throw new Error(`Calendario no reabrio en su superficie independiente: ${JSON.stringify(independentCalendar)}`);
  }

  const calendarSelectionBeforeClick = await cdp.evaluate(`({ box: document.getElementById("t-name-box").value, row: document.getElementById("sheets-session-probe").dataset.row })`);
  await cdp.evaluate(viewExpression('view.querySelector(\'.calendar-item[data-sheet-row="2"]\').click();'));
  await delay(250);
  const calendarSelectionAfterClick = await cdp.evaluate(`({ box: document.getElementById("t-name-box").value, row: document.getElementById("sheets-session-probe").dataset.row })`);
  if (calendarSelectionAfterClick.box !== calendarSelectionBeforeClick.box || calendarSelectionAfterClick.row !== calendarSelectionBeforeClick.row) {
    throw new Error(`El evento del Calendario abrio su fila con un solo clic: ${JSON.stringify({ calendarSelectionBeforeClick, calendarSelectionAfterClick })}`);
  }

  await cdp.evaluate(viewExpression(`
    view.querySelector('.calendar-item[data-sheet-row="2"]').dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: 2,
      button: 0
    }));
  `));
  const calendarRowDeadline = Date.now() + 5_000;
  while (Date.now() < calendarRowDeadline) {
    selected = await cdp.evaluate(`({ box: document.getElementById("t-name-box").value, row: document.getElementById("sheets-session-probe").dataset.row })`);
    if (selected.box === "A2" && selected.row === "2") break;
    await delay(100);
  }
  if (selected?.box !== "A2" || selected.row !== "2") {
    throw new Error(`El evento no abrio su fila: ${JSON.stringify(selected)}`);
  }

  const removeFirstColumn = (row) => [row[1] || "", row[2] || "", row[3] || "", "", ""];
  sheet.headers.splice(0, sheet.headers.length, "Nombre", "Estado", "Fecha", "", "");
  sheet.rows.splice(0, sheet.rows.length, ...sheet.rows.map(removeFirstColumn));
  staleVisualizationRows.splice(0, staleVisualizationRows.length, ...staleVisualizationRows.map(removeFirstColumn));
  await cdp.evaluate(`window.postMessage({ source: "sheets-row-drawer", type: "sheet-change", reason: "test-column-removal" }, location.origin)`);
  const removedColumnDeadline = Date.now() + 5_000;
  while (Date.now() < removedColumnDeadline) {
    const labels = await cdp.evaluate(panelExpression(`return Array.from(panel.querySelectorAll('.field-label-text'), item => item.textContent.trim());`));
    if (JSON.stringify(labels) === JSON.stringify(["Nombre", "Estado", "Fecha"])) break;
    await delay(80);
  }

  const insertNewColumn = (row) => [row[0] || "", "Nuevo", row[1] || "", row[2] || "", ""];
  sheet.headers.splice(0, sheet.headers.length, "Nombre", "Nueva", "Estado", "Fecha", "");
  sheet.rows.splice(0, sheet.rows.length, ...sheet.rows.map(insertNewColumn));
  staleVisualizationRows.splice(0, staleVisualizationRows.length, ...staleVisualizationRows.map(insertNewColumn));
  await cdp.evaluate(`window.postMessage({ source: "sheets-row-drawer", type: "sheet-change", reason: "test-column-insertion" }, location.origin)`);
  const insertedColumnDeadline = Date.now() + 5_000;
  while (Date.now() < insertedColumnDeadline) {
    const labels = await cdp.evaluate(panelExpression(`return Array.from(panel.querySelectorAll('.field-label-text'), item => item.textContent.trim());`));
    if (JSON.stringify(labels) === JSON.stringify(["Nombre", "Nueva", "Estado", "Fecha"])) break;
    await delay(80);
  }

  await cdp.evaluate(panelExpression('panel.querySelector("[data-sheet-view=table]").click();'));
  const repairedTableDeadline = Date.now() + 5_000;
  while (Date.now() < repairedTableDeadline) {
    const ready = await cdp.evaluate(viewExpression(`
      view.querySelector('[data-workspace-view=table]')?.click();
      return view.querySelectorAll('[data-workspace-row]').length > 0;
    `));
    if (ready) break;
    await delay(80);
  }
  for (let iteration = 0; iteration < 3; iteration += 1) {
    await cdp.evaluate(viewExpression(`
      const option = Array.from(view.querySelectorAll('.workspace-table-columns .ant-checkbox-wrapper'))
        .find(item => item.textContent.trim() === 'Nueva');
      option?.querySelector('input')?.click();
    `));
    await delay(80);
    await cdp.evaluate(viewExpression(`
      const option = Array.from(view.querySelectorAll('.workspace-table-columns .ant-checkbox-wrapper'))
        .find(item => item.textContent.trim() === 'Nueva');
      option?.querySelector('input')?.click();
    `));
    await delay(80);
  }
  const repairedColumns = await cdp.evaluate(viewExpression(`return {
    headings: Array.from(view.querySelectorAll('.workspace-data-table thead .workspace-table-column-heading > span:nth-child(2)'), item => item.textContent.trim()),
    ids: Array.from(view.querySelectorAll('[data-workspace-row="2"] td[data-column-id]'), item => item.dataset.columnId),
    options: Array.from(view.querySelectorAll('.workspace-table-columns .ant-checkbox-wrapper'), item => ({
      label: item.textContent.trim(),
      checked: item.querySelector('input')?.checked === true
    }))
  };`));
  if (
    JSON.stringify(repairedColumns.headings) !== JSON.stringify(["Nombre", "Nueva", "Estado", "Fecha"])
    || new Set(repairedColumns.ids).size !== 4
    || repairedColumns.ids.length !== 4
    || repairedColumns.options.length !== 4
    || repairedColumns.options.some((option) => !option.checked)
  ) {
    throw new Error(`Los identificadores repetidos desestabilizaron las columnas: ${JSON.stringify(repairedColumns)}`);
  }

  await cdp.evaluate(viewExpression(`
    for (const rowNumber of [3, 4]) {
      view.querySelector('[data-workspace-row="' + rowNumber + '"] .workspace-table-select input')?.click();
    }
    Array.from(view.querySelectorAll('.workspace-table-toolbar button'))
      .find((button) => button.textContent.includes('Limpiar (2)'))?.click();
  `));
  await delay(120);
  await cdp.evaluate(viewExpression('view.querySelector("[data-sheet-view-save]").click();'));
  const rectangularClearDeadline = Date.now() + 4_000;
  let rectangularClear = false;
  let rectangularClears = [];
  while (Date.now() < rectangularClearDeadline) {
    rectangularClears = await cdp.evaluate("globalThis.__clears || []");
    rectangularClear = rectangularClears.some((reference) => reference.endsWith("!A3:D4"));
    if (rectangularClear) break;
    await delay(50);
  }
  if (!rectangularClear) throw new Error(`Tabla no consolido dos filas completas en un unico clear rectangular: ${JSON.stringify(rectangularClears)}`);
  for (const rowIndex of [1, 2]) {
    for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
      sheet.rows[rowIndex][columnIndex] = "";
      staleVisualizationRows[rowIndex][columnIndex] = "";
    }
  }
  const rectangularClearSavedDeadline = Date.now() + 5_000;
  let rectangularClearSaved = false;
  while (Date.now() < rectangularClearSavedDeadline) {
    rectangularClearSaved = await cdp.evaluate(viewExpression('return view.querySelector("[data-sheet-view-save-state]")?.dataset.sheetViewSaveState === "saved";'));
    if (rectangularClearSaved) break;
    await delay(80);
  }
  if (!rectangularClearSaved) throw new Error("Tabla no verifico el borrado rectangular de varias filas");

  console.log("VISTAS_OK: Tabla, Kanban y Calendario usan una superficie independiente; sus registros reutilizan el drawer original.");
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
