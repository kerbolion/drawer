(() => {
  "use strict";

  if (!/\/spreadsheets\/d\/[^/]+\/edit/.test(location.pathname)) return;
  if (window.__sheetsRowDrawerWriteBridge) return;
  window.__sheetsRowDrawerWriteBridge = true;

  const SOURCE = "sheets-row-drawer";
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  let interactionQueue = Promise.resolve();
  let bridgeInteractionDepth = 0;
  let sheetChangeTimer = null;
  let pendingSheetChange = null;
  let observedSaveIndicator = null;
  let saveIndicatorObserver = null;

  function enqueueInteraction(task) {
    const queued = interactionQueue.then(task, task);
    interactionQueue = queued.catch(() => {});
    return queued;
  }

  function enqueueBridgeInteraction(task) {
    return enqueueInteraction(async () => {
      bridgeInteractionDepth += 1;
      try {
        return await task();
      } finally {
        bridgeInteractionDepth = Math.max(0, bridgeInteractionDepth - 1);
      }
    });
  }

  function isNameBox(target) {
    return target instanceof Element && (target.id === "t-name-box" || Boolean(target.closest("#t-name-box")));
  }

  function saveIndicator() {
    return document.getElementById("docs-save-indicator-badge");
  }

  function saveInProgress(indicator) {
    return Boolean(indicator?.querySelector("#docs-save-indicator-id [class*='docs-sync-']"));
  }

  function emitPendingSheetChange() {
    if (!pendingSheetChange) return;
    if (bridgeInteractionDepth > 0) {
      clearTimeout(sheetChangeTimer);
      sheetChangeTimer = setTimeout(emitPendingSheetChange, 150);
      return;
    }
    const { reason } = pendingSheetChange;
    pendingSheetChange = null;
    sheetChangeTimer = null;
    window.postMessage({ source: SOURCE, type: "sheet-change", reason }, location.origin);
  }

  function inspectSaveIndicator() {
    if (!pendingSheetChange) return;
    const indicator = observeSaveIndicator();
    if (!indicator) return;
    if (saveInProgress(indicator)) emitPendingSheetChange();
  }

  function observeSaveIndicator() {
    const indicator = saveIndicator();
    if (indicator === observedSaveIndicator) return indicator;
    saveIndicatorObserver?.disconnect();
    observedSaveIndicator = indicator;
    if (!indicator) return null;
    saveIndicatorObserver = new MutationObserver(inspectSaveIndicator);
    saveIndicatorObserver.observe(indicator, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      characterData: true,
      subtree: true
    });
    return indicator;
  }

  function notifySheetChange(reason) {
    if (bridgeInteractionDepth > 0) return;
    const committed = reason !== "input" && reason !== "composition";
    const indicator = observeSaveIndicator();
    pendingSheetChange = { reason };
    clearTimeout(sheetChangeTimer);
    if (!indicator) {
      sheetChangeTimer = setTimeout(emitPendingSheetChange, committed ? 60 : 160);
      return;
    }
    inspectSaveIndicator();
  }

  document.addEventListener("input", (event) => {
    if (!isNameBox(event.target)) notifySheetChange("input");
  }, true);
  document.addEventListener("change", (event) => {
    if (!isNameBox(event.target)) notifySheetChange("change");
  }, true);
  document.addEventListener("compositionend", (event) => {
    if (!isNameBox(event.target)) notifySheetChange("composition");
  }, true);
  document.addEventListener("paste", () => notifySheetChange("paste"), true);
  document.addEventListener("cut", () => notifySheetChange("cut"), true);
  document.addEventListener("keydown", (event) => {
    const key = String(event.key || "").toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    const editable = event.target instanceof Element && Boolean(event.target.closest("input:not(#t-name-box), textarea, [contenteditable='true'], .cell-input"));
    const directSheetCommand = !editable && (key === "delete" || key === "backspace" || (command && (key === "z" || key === "y")));
    if (directSheetCommand || (editable && (key === "enter" || key === "tab"))) {
      notifySheetChange("keyboard");
    }
  }, true);
  document.addEventListener("pointerup", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[role='option'], [role='menuitem'], [role='checkbox'], .goog-menuitem, .waffle-data-validation-menu-item")) {
      notifySheetChange("control");
    }
  }, true);

  function focusCell(reference) {
    const box = document.getElementById("t-name-box");
    if (!box) throw new Error("No se encontró el cuadro de nombre de Google Sheets");
    box.focus();
    box.value = reference;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
  }

  function paste(value) {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", value);
    const event = new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true
    });
    (document.activeElement || document.body).dispatchEvent(event);
  }

  function clearSelection() {
    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Delete", code: "Delete", keyCode: 46, which: 46, bubbles: true, cancelable: true
    }));
    target.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Delete", code: "Delete", keyCode: 46, which: 46, bubbles: true, cancelable: true
    }));
  }

  function normalizedReference(reference) {
    return String(reference || "").trim().replace(/\$/g, "");
  }

  function sheetNameKey(value) {
    return String(value || "").trim().normalize("NFC").toLocaleLowerCase();
  }

  function sheetTabs() {
    return Array.from(document.querySelectorAll(".docs-sheet-tab"));
  }

  function sheetTabName(tab) {
    return String(tab?.querySelector(".docs-sheet-tab-name")?.textContent || "").trim();
  }

  function findSheetTab(name) {
    const key = sheetNameKey(name);
    return sheetTabs().find((tab) => sheetNameKey(sheetTabName(tab)) === key) || null;
  }

  function activeSheetTab() {
    return document.querySelector(".docs-sheet-tab.docs-sheet-active-tab");
  }

  function currentSheetNames() {
    return sheetTabs().map(sheetTabName).filter(Boolean);
  }

  function isAvailable(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true" || element.closest("[aria-hidden='true']")) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }

  function elementLabel(element) {
    return [element?.textContent, element?.getAttribute?.("aria-label"), element?.getAttribute?.("data-tooltip")]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  async function waitForValue(read, timeout = 6_000, message = "Google Sheets no confirmó la operación") {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await wait(60);
    }
    throw new Error(message);
  }

  function dispatchMouse(element, type, options = {}) {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      ...options
    }));
  }

  function clickElement(element) {
    if (!element) throw new Error("No se encontró el control solicitado en Google Sheets");
    dispatchMouse(element, "pointerdown", { button: 0, buttons: 1 });
    dispatchMouse(element, "mousedown", { button: 0, buttons: 1 });
    dispatchMouse(element, "mouseup", { button: 0, buttons: 0 });
    element.click();
  }

  function menuItem(patterns) {
    const candidates = Array.from(document.querySelectorAll("[role='menuitem'], .goog-menuitem"));
    return candidates.reverse().find((item) => isAvailable(item) && patterns.some((pattern) => pattern.test(elementLabel(item)))) || null;
  }

  async function openSheetMenu(tab) {
    tab.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    dispatchMouse(tab, "mouseover", { button: 0 });
    const trigger = tab.querySelector(".docs-sheet-tab-dropdown, [aria-haspopup='menu']");
    if (trigger) clickElement(trigger);
    else dispatchMouse(tab, "contextmenu", { button: 2, buttons: 2 });
    await wait(80);
  }

  async function chooseSheetMenuAction(tab, patterns, label) {
    await openSheetMenu(tab);
    const item = await waitForValue(
      () => menuItem(patterns),
      4_000,
      `No se encontró la opción ${label} en el menú de la hoja`
    );
    clickElement(item);
  }

  function setControlValue(control, value) {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(control, value);
    else control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function visibleDialog() {
    return Array.from(document.querySelectorAll("[role='dialog'], .docs-material-gm-dialog, .modal-dialog"))
      .reverse()
      .find(isAvailable) || null;
  }

  function dialogButton(dialog, patterns) {
    return Array.from(dialog?.querySelectorAll("button, [role='button']") || [])
      .reverse()
      .find((button) => isAvailable(button) && patterns.some((pattern) => pattern.test(elementLabel(button)))) || null;
  }

  async function renameSheetTab(tab, name) {
    await chooseSheetMenuAction(tab, [/^cambiar nombre$/i, /^renombrar$/i, /^rename$/i, /rename sheet/i], "Cambiar nombre");
    const input = await waitForValue(() => {
      const dialog = visibleDialog();
      return Array.from(document.querySelectorAll(".docs-sheet-tab input, input.docs-sheet-tab-name-input, [role='dialog'] input[type='text'], .docs-material-gm-dialog input[type='text']"))
        .reverse()
        .find((candidate) => isAvailable(candidate) && (!dialog || dialog.contains(candidate) || candidate.closest(".docs-sheet-tab"))) || null;
    }, 4_000, "No se encontró el campo para cambiar el nombre de la hoja");
    input.focus();
    input.select?.();
    setControlValue(input, name);
    const dialog = input.closest("[role='dialog'], .docs-material-gm-dialog, .modal-dialog");
    const confirm = dialogButton(dialog, [/^aceptar$/i, /^ok$/i, /^cambiar nombre$/i, /^rename$/i, /^guardar$/i, /^save$/i]);
    if (confirm) clickElement(confirm);
    else {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
      }));
    }
    await waitForValue(
      () => findSheetTab(name),
      8_000,
      `Google Sheets no confirmó el nombre ${name}`
    );
  }

  function validateSheetName(name) {
    const value = String(name || "").trim();
    if (!value) throw new Error("El nombre de la hoja no puede estar vacío");
    if (value.length > 100) throw new Error("El nombre de la hoja admite como máximo 100 caracteres");
    if (/[\\/?*\[\]:]/.test(value)) throw new Error("El nombre de la hoja contiene caracteres no permitidos");
    return value;
  }

  async function createSheet(name) {
    const targetName = validateSheetName(name);
    if (findSheetTab(targetName)) throw new Error(`Ya existe una hoja llamada ${targetName}`);
    const previousTabs = new Set(sheetTabs());
    const addButton = [
      "#docs-sheet-add",
      ".docs-sheet-add-button",
      "[aria-label='Añadir hoja']",
      "[aria-label='Add sheet']",
      "[data-tooltip='Añadir hoja']",
      "[data-tooltip='Add sheet']"
    ].map((selector) => document.querySelector(selector)).find(Boolean);
    if (!addButton) throw new Error("No se encontró el botón para añadir una hoja");
    clickElement(addButton);
    const createdTab = await waitForValue(
      () => sheetTabs().find((tab) => !previousTabs.has(tab)) || (sheetTabs().length > previousTabs.size ? activeSheetTab() : null),
      8_000,
      "Google Sheets no confirmó la creación de la hoja"
    );
    await renameSheetTab(createdTab, targetName);
    return targetName;
  }

  async function renameSheet(previousName, name) {
    const targetName = validateSheetName(name);
    const tab = findSheetTab(previousName);
    if (!tab) throw new Error(`No existe la hoja ${previousName}`);
    const duplicate = findSheetTab(targetName);
    if (duplicate && duplicate !== tab) throw new Error(`Ya existe una hoja llamada ${targetName}`);
    if (sheetNameKey(previousName) === sheetNameKey(targetName) && sheetTabName(tab) === targetName) return targetName;
    clickElement(tab);
    await renameSheetTab(tab, targetName);
    return targetName;
  }

  async function deleteSheet(name) {
    if (sheetTabs().length <= 1) throw new Error("Google Sheets requiere conservar al menos una hoja");
    const tab = findSheetTab(name);
    if (!tab) throw new Error(`No existe la hoja ${name}`);
    await chooseSheetMenuAction(tab, [/^eliminar$/i, /^eliminar hoja$/i, /^delete$/i, /^delete sheet$/i], "Eliminar");
    await wait(120);
    const dialog = visibleDialog();
    if (dialog) {
      const confirm = dialogButton(dialog, [/^eliminar$/i, /^delete$/i, /^aceptar$/i, /^ok$/i]);
      if (!confirm) throw new Error("No se encontró la confirmación para eliminar la hoja");
      clickElement(confirm);
    }
    await waitForValue(
      () => !findSheetTab(name),
      8_000,
      `Google Sheets no confirmó la eliminación de ${name}`
    );
    return name;
  }

  async function executeSheetOperation(message) {
    const operation = String(message.operation || "");
    if (operation === "create") await createSheet(message.name);
    else if (operation === "rename") await renameSheet(message.sheet, message.name);
    else if (operation === "delete") await deleteSheet(message.sheet);
    else throw new Error(`Operación de hoja no soportada: ${operation}`);
    return {
      sheets: currentSheetNames(),
      activeSheet: sheetTabName(activeSheetTab())
    };
  }

  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (event.source !== window || message?.source !== SOURCE) return;

    if (message?.type === "focus-range") {
      try {
        await enqueueBridgeInteraction(async () => {
          focusCell(String(message.reference || ""));
          await wait(180);
        });
        window.postMessage({ source: SOURCE, type: "focus-result", requestId: message.requestId, ok: true }, location.origin);
      } catch (error) {
        window.postMessage({
          source: SOURCE,
          type: "focus-result",
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }, location.origin);
      }
      return;
    }

    if (message?.type === "sheet-operation") {
      try {
        const result = await enqueueBridgeInteraction(() => executeSheetOperation(message));
        window.postMessage({
          source: SOURCE,
          type: "sheet-operation-result",
          requestId: message.requestId,
          ok: true,
          result
        }, location.origin);
      } catch (error) {
        window.postMessage({
          source: SOURCE,
          type: "sheet-operation-result",
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }, location.origin);
      }
      return;
    }

    if (message?.type !== "write-range") return;

    try {
      await enqueueBridgeInteraction(async () => {
        const operations = Array.isArray(message.operations) && message.operations.length
          ? message.operations
          : [{ reference: message.reference, tsv: message.tsv }];
        for (const operation of operations) {
          focusCell(operation.reference);
          await wait(120);
          if (operation.action === "clear") clearSelection();
          else paste(String(operation.tsv ?? ""));
          await wait(180);
        }
        const selectionReference = message.selectionReference || message.restoreReference || "";
        const lastOperationReference = operations[operations.length - 1]?.reference || "";
        if (selectionReference && normalizedReference(selectionReference) !== normalizedReference(lastOperationReference)) {
          focusCell(selectionReference);
          await wait(180);
        }
      });
      window.postMessage({ source: SOURCE, type: "write-result", requestId: message.requestId, ok: true }, location.origin);
    } catch (error) {
      window.postMessage({
        source: SOURCE,
        type: "write-result",
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }, location.origin);
    }
  });
})();
