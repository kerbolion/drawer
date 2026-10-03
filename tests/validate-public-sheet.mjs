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
  await cdp.evaluate(`(() => {
    document.getElementById("srd-test-companion")?.remove();
    const container = document.createElement("div");
    container.id = "srd-test-companion";
    container.className = "companion-app-switcher-container";
    container.style.cssText = "position:fixed;right:8px;top:80px;width:48px;height:160px";
    const switcher = document.createElement("div");
    switcher.className = "companion-guest-app-switcher";
    switcher.setAttribute("role", "tablist");
    switcher.style.cssText = "display:flex;flex-direction:column;align-items:center;width:48px;height:160px";
    const add = document.createElement("div");
    add.id = "srd-test-addons";
    add.className = "agca-gab-button app-switcher-button";
    add.setAttribute("role", "tab");
    add.setAttribute("aria-label", "Obtener Complementos");
    add.style.cssText = "width:40px;height:40px";
    const icon = document.createElement("div");
    icon.className = "app-switcher-button-icon-container";
    icon.style.backgroundImage = "url(https://fonts.gstatic.com/s/i/googlematerialicons/add/v21/black-24dp/1x/gm_add_black_24dp.png)";
    add.appendChild(icon);
    switcher.appendChild(add);
    container.appendChild(switcher);
    document.body.prepend(container);
  })()`);
  const frameTree = await cdp.command("Page.getFrameTree");
  const frameId = frameTree.frameTree.frame.id;
  const isolated = await cdp.command("Page.createIsolatedWorld", {
    frameId,
    worldName: "sheets-row-drawer-test",
    grantUniveralAccess: true
  });
  const writeScript = await readFile(path.join(extensionDir, "page-write.js"), "utf8");
  await cdp.evaluate(writeScript);
  await cdp.evaluate(`(() => {
    globalThis.__codexBridgeTest = { delivered: false, result: null };
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          if (message?.source !== "sheets-row-drawer-codex") return callback(null);
          if (message.type === "poll") {
            if (globalThis.__codexBridgeTest.delivered) return callback({ command: null });
            globalThis.__codexBridgeTest.delivered = true;
            return callback({
              command: {
                id: "browser-read-test",
                action: "read",
                params: { gid: "0", range: "A1:F3", sheet: "" }
              }
            });
          }
          if (message.type === "result") {
            globalThis.__codexBridgeTest.result = message.payload;
            return callback({ ok: true });
          }
          callback(null);
        }
      }
    };
  })()`, isolated.executionContextId);
  const contentScript = await readFile(path.join(extensionDir, "dist", "content.js"), "utf8");
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
        statusHidden: panel?.querySelector(".status")?.hidden ?? false,
        nameBox: document.getElementById("t-name-box")?.value || null,
        themeSource: host?.dataset.themeSource || null,
        saveState: host?.dataset.saveState || null,
        drawerHidden: host?.shadowRoot?.querySelector(".panel-frame")?.hidden ?? null,
        primaryToken: panel ? getComputedStyle(panel.documentElement).getPropertyValue("--workspace-primary").trim() : null
      };
    })()`);
    if (result?.status === "error" || (result?.status === "ok" && result?.saveState === "saved")) break;
    await delay(500);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result?.exists) throw new Error("La extension no se inyecto");
  if (result.status !== "ok") throw new Error(result.message || "La lectura no termino correctamente");
  if (result.row !== "2") throw new Error(`Se esperaba la fila 2 y se obtuvo ${result.row}`);
  if (!result.fields.includes("Alexandra")) throw new Error("La fila leida no contiene el valor esperado");
  if (!result.statusHidden || result.saveState !== "saved") throw new Error("El estado rutinario no se movio al icono del encabezado");
  if (result.themeSource !== "workspace-antd" || result.drawerHidden !== true || result.primaryToken !== "#1677ff") {
    throw new Error(`El tema de workspace-antd no se aplico correctamente: ${JSON.stringify(result)}`);
  }

  const launcherDeadline = Date.now() + 3_000;
  let launcherPlacement;
  while (Date.now() < launcherDeadline) {
    launcherPlacement = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const add = document.getElementById("srd-test-addons");
      const launcher = host?.shadowRoot?.querySelector(".reopen");
      const addRect = add?.getBoundingClientRect();
      const launcherRect = launcher?.getBoundingClientRect();
      return {
        exists: Boolean(launcher),
        ownedByExtension: launcher?.getRootNode() === host?.shadowRoot,
        googleTreeUntouched: add?.nextElementSibling === null,
        belowAdd: Boolean(addRect && launcherRect && launcherRect.top >= addRect.bottom + 7),
        initiallyHidden: launcher?.hidden ?? null,
        anchor: host?.dataset.launcherAnchor || null
      };
    })()`);
    if (launcherPlacement.exists && launcherPlacement.belowAdd && launcherPlacement.anchor === "ready") break;
    await delay(50);
  }
  if (!launcherPlacement?.ownedByExtension || !launcherPlacement.googleTreeUntouched || !launcherPlacement.belowAdd || launcherPlacement.initiallyHidden !== false) {
    throw new Error(`El lanzador no quedó debajo de Obtener Complementos: ${JSON.stringify(launcherPlacement)}`);
  }

  const initiallyOpenedDrawer = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const frame = host.shadowRoot.querySelector(".panel-frame");
    const launcher = host.shadowRoot.querySelector(".reopen");
    launcher.click();
    return {
      drawerHidden: frame.hidden,
      launcherHidden: launcher.hidden,
      drawerWidth: Math.round(frame.getBoundingClientRect().width)
    };
  })()`);
  if (initiallyOpenedDrawer.drawerHidden || initiallyOpenedDrawer.launcherHidden || initiallyOpenedDrawer.drawerWidth < 700 || initiallyOpenedDrawer.drawerWidth > 720) {
    throw new Error(`El botón lateral no abrió el drawer inicialmente cerrado: ${JSON.stringify(initiallyOpenedDrawer)}`);
  }

  const closedDrawer = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const frame = host.shadowRoot.querySelector(".panel-frame");
    frame.contentDocument.querySelector(".close").click();
    const launcher = host.shadowRoot.querySelector(".reopen");
    const style = getComputedStyle(launcher);
    const rect = launcher.getBoundingClientRect();
    return {
      drawerHidden: frame.hidden,
      launcherHidden: launcher.hidden,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      borderRadius: style.borderRadius
    };
  })()`);
  if (!closedDrawer.drawerHidden || closedDrawer.launcherHidden || closedDrawer.width !== 40 || closedDrawer.height !== 40 || closedDrawer.borderRadius !== "50%") {
    throw new Error(`El lanzador circular no mostró el estado esperado: ${JSON.stringify(closedDrawer)}`);
  }

  const reopenedDrawer = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const frame = host.shadowRoot.querySelector(".panel-frame");
    const launcher = host.shadowRoot.querySelector(".reopen");
    launcher.click();
    return {
      drawerHidden: frame.hidden,
      launcherHidden: launcher.hidden,
      drawerLayer: Number(getComputedStyle(frame).zIndex),
      launcherLayer: Number(getComputedStyle(launcher).zIndex)
    };
  })()`);
  if (reopenedDrawer.drawerHidden || reopenedDrawer.launcherHidden || reopenedDrawer.launcherLayer >= reopenedDrawer.drawerLayer) {
    throw new Error(`El botón lateral no volvió a abrir el drawer: ${JSON.stringify(reopenedDrawer)}`);
  }

  const darkTheme = await cdp.evaluate(`(async () => {
    const host = document.getElementById("sheets-session-probe");
    const frame = host.shadowRoot.querySelector(".panel-frame");
    const sheetViewFrame = host.shadowRoot.querySelector(".sheet-view-frame");
    const panel = frame.contentDocument;
    const toggle = panel.querySelector("[data-theme-toggle]");
    toggle.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const activeToggle = panel.querySelector("[data-theme-toggle]");
    const toggleRect = activeToggle.getBoundingClientRect();
    const iconRect = activeToggle.querySelector(".ant-switch-inner-checked .anticon").getBoundingClientRect();
    return {
      hostTheme: host.dataset.theme,
      googleTheme: document.documentElement.dataset.srdTheme,
      panelTheme: panel.documentElement.dataset.theme,
      sheetViewTheme: sheetViewFrame.contentDocument.documentElement.dataset.theme,
      toggleTheme: panel.querySelector("[data-theme-toggle]")?.dataset.themeToggle || null,
      panelBackground: getComputedStyle(panel.body).backgroundColor,
      sheetViewBackground: getComputedStyle(sheetViewFrame.contentDocument.body).backgroundColor,
      iconSignedVerticalOffset: (iconRect.top + iconRect.height / 2) - (toggleRect.top + toggleRect.height / 2),
      iconVerticalOffset: Math.abs((iconRect.top + iconRect.height / 2) - (toggleRect.top + toggleRect.height / 2)),
      googleFilter: getComputedStyle(document.body).filter,
      storedTheme: localStorage.getItem("srd:theme-mode")
    };
  })()`);
  if (
    darkTheme.hostTheme !== "dark"
    || darkTheme.googleTheme !== "dark"
    || darkTheme.panelTheme !== "dark"
    || darkTheme.sheetViewTheme !== "dark"
    || darkTheme.toggleTheme !== "dark"
    || darkTheme.panelBackground !== "rgb(31, 31, 31)"
    || darkTheme.sheetViewBackground !== "rgb(31, 31, 31)"
    || darkTheme.iconVerticalOffset > 0.5
    || !darkTheme.googleFilter.includes("invert")
    || darkTheme.storedTheme !== "dark"
  ) {
    throw new Error(`El modo oscuro no se aplico de extremo a extremo: ${JSON.stringify(darkTheme)}`);
  }

  const lightTheme = await cdp.evaluate(`(async () => {
    const host = document.getElementById("sheets-session-probe");
    const frame = host.shadowRoot.querySelector(".panel-frame");
    const panel = frame.contentDocument;
    panel.querySelector("[data-theme-toggle]").click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const activeToggle = panel.querySelector("[data-theme-toggle]");
    const toggleRect = activeToggle.getBoundingClientRect();
    const iconRect = activeToggle.querySelector(".ant-switch-inner-unchecked .anticon").getBoundingClientRect();
    return {
      hostTheme: host.dataset.theme,
      googleTheme: document.documentElement.dataset.srdTheme,
      panelTheme: panel.documentElement.dataset.theme,
      panelBackground: getComputedStyle(panel.body).backgroundColor,
      iconSignedVerticalOffset: (iconRect.top + iconRect.height / 2) - (toggleRect.top + toggleRect.height / 2),
      iconVerticalOffset: Math.abs((iconRect.top + iconRect.height / 2) - (toggleRect.top + toggleRect.height / 2)),
      googleFilter: getComputedStyle(document.body).filter,
      storedTheme: localStorage.getItem("srd:theme-mode")
    };
  })()`);
  if (
    lightTheme.hostTheme !== "light"
    || lightTheme.googleTheme !== "light"
    || lightTheme.panelTheme !== "light"
    || lightTheme.panelBackground !== "rgb(255, 255, 255)"
    || lightTheme.iconVerticalOffset > 0.5
    || lightTheme.googleFilter !== "none"
    || lightTheme.storedTheme !== "light"
  ) {
    throw new Error(`El modo claro no se restauro por completo: ${JSON.stringify(lightTheme)}`);
  }

  const launcherMove = await cdp.evaluate(`(async () => {
    const host = document.getElementById("sheets-session-probe");
    const launcher = host.shadowRoot.querySelector(".reopen");
    const companion = document.getElementById("srd-test-companion");
    const before = launcher.getBoundingClientRect().top;
    companion.style.top = "120px";
    window.dispatchEvent(new Event("resize"));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      before: Math.round(before),
      after: Math.round(launcher.getBoundingClientRect().top),
      hidden: launcher.hidden,
      stillOutsideGoogleTree: launcher.getRootNode() === host.shadowRoot
    };
  })()`);
  if (launcherMove.after - launcherMove.before !== 40 || launcherMove.hidden || !launcherMove.stillOutsideGoogleTree) {
    throw new Error(`El lanzador no siguió la barra mediante listeners: ${JSON.stringify(launcherMove)}`);
  }

  const bridgeDeadline = Date.now() + 15_000;
  let bridgeResult;
  while (Date.now() < bridgeDeadline) {
    bridgeResult = await cdp.evaluate("globalThis.__codexBridgeTest.result", isolated.executionContextId);
    if (bridgeResult) break;
    await delay(100);
  }
  const bridgeValues = bridgeResult?.result?.rows?.flatMap((row) => row.values) || [];
  if (!bridgeResult?.ok || !bridgeValues.includes("Alexandra")) {
    throw new Error(`El ejecutor de Codex no leyó la hoja autenticada: ${JSON.stringify(bridgeResult)}`);
  }

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
    window.__probeClearCount = 0;
    document.addEventListener("keydown", event => {
      if (event.key === "Delete") window.__probeClearCount += 1;
    }, { capture: true });
  })()`);
  await cdp.evaluate(`window.postMessage({
    source: "sheets-row-drawer",
    type: "write-range",
    requestId: "automated-clear-noop",
    operations: [{ action: "clear", reference: "A2:B2" }]
  }, location.origin)`, isolated.executionContextId);
  const clearDeadline = Date.now() + 5_000;
  let clearCount = 0;
  while (Date.now() < clearDeadline) {
    clearCount = await cdp.evaluate("window.__probeClearCount");
    if (clearCount) break;
    await delay(100);
  }
  if (clearCount !== 1) throw new Error("El puente no generó una única limpieza de rango");

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
        saveState: host?.dataset.saveState || null,
        row: host?.dataset.row || null,
        fields: panel ? Array.from(panel.querySelectorAll(".field input"), input => input.value) : []
      };
    })()`);
    if (result?.status === "ok" && result?.saveState === "saved" && result?.row === "3") break;
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

  const configured = await cdp.evaluate(`(() => {
    const host = document.getElementById("sheets-session-probe");
    const panel = host.shadowRoot.querySelector(".panel-frame").contentDocument;
    panel.querySelector('[data-configure-column="1"]').click();
    const type = panel.querySelector("#srd-property-type");
    type.value = "longText";
    type.dispatchEvent(new Event("change", { bubbles: true }));
    panel.querySelector("#srd-property-form").requestSubmit();
    return panel.querySelector('[data-column="1"]')?.dataset.fieldType;
  })()`);
  if (configured !== "longText") throw new Error("El drawer de propiedad no aplico el tipo configurado");

  await cdp.evaluate(`(() => {
    const box = document.getElementById("t-name-box");
    box.focus();
    box.value = "A100";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
  })()`);
  const emptyDeadline = Date.now() + 15_000;
  let emptyResult;
  while (Date.now() < emptyDeadline) {
    emptyResult = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
      return {
        status: host?.dataset.status || null,
        empty: host?.dataset.empty || null,
        saveState: host?.dataset.saveState || null,
        row: host?.dataset.row || null,
        fieldCount: panel?.querySelectorAll(".field").length ?? -1,
        fieldsHidden: panel?.querySelector(".fields")?.hidden ?? false,
        relatedHidden: panel?.querySelector(".related")?.hidden ?? false,
        emptyHidden: panel?.querySelector(".empty-state")?.hidden ?? true,
        description: panel?.querySelector(".empty-state .ant-empty-description")?.textContent || "",
        errorVisible: !(panel?.querySelector(".status")?.hidden ?? true)
      };
    })()`);
    if (emptyResult?.status === "empty" && emptyResult?.row === "100") break;
    await delay(250);
  }
  if (
    emptyResult?.empty !== "true"
    || emptyResult.saveState !== "saved"
    || emptyResult.fieldCount !== 0
    || !emptyResult.fieldsHidden
    || !emptyResult.relatedHidden
    || emptyResult.emptyHidden
    || emptyResult.description !== "Nada para mostrar"
    || emptyResult.errorVisible
  ) {
    throw new Error(`La fila vacía no mostró el estado Empty esperado: ${JSON.stringify(emptyResult)}`);
  }

  await cdp.evaluate(`(() => {
    const box = document.getElementById("t-name-box");
    box.focus();
    box.value = "A3";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
  })()`);
  const restoredDeadline = Date.now() + 10_000;
  while (Date.now() < restoredDeadline) {
    const restored = await cdp.evaluate(`(() => {
      const host = document.getElementById("sheets-session-probe");
      const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
      return host?.dataset.row === "3"
        && host?.dataset.status === "ok"
        && panel?.querySelector('[data-column="1"]')?.dataset.fieldType === "longText";
    })()`);
    if (restored) break;
    await delay(250);
  }

  await delay(300);
  await cdp.command("Page.reload", { ignoreCache: true });
  const persistenceDeadline = Date.now() + 30_000;
  let persistedType = null;
  while (Date.now() < persistenceDeadline) {
    try {
      persistedType = await cdp.evaluate(`(() => {
        const host = document.getElementById("sheets-session-probe");
        const panel = host?.shadowRoot?.querySelector(".panel-frame")?.contentDocument;
        return panel?.querySelector('[data-column="1"]')?.dataset.fieldType || null;
      })()`);
      if (persistedType === "longText") break;
    } catch {}
    await delay(250);
  }
  if (persistedType !== "longText") throw new Error("El tipo de columna no persistio despues de recargar Sheets");

  console.log("VALIDACION_OK: tipos persistentes, estado animado, tema Ant Design, lectura, fila vacía, cambio sin rerender, foco y pegado TSV confirmados.");
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
