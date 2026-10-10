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

  function normalizedSheetName(value) {
    return String(value || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function validateSheetName(value) {
    const name = String(value || "").trim();
    if (!name || name.length > 100 || /[:\\/?*\[\]]/.test(name)) {
      throw new Error("El nombre de la hoja debe tener entre 1 y 100 caracteres y no puede contener : \\ / ? * [ ]");
    }
    return name;
  }

  function sheetTabs() {
    return Array.from(document.querySelectorAll(".docs-sheet-tab")).filter((tab) => tab.querySelector(".docs-sheet-tab-name"));
  }

  function sheetTabName(tab) {
    return String(tab?.querySelector(".docs-sheet-tab-name")?.textContent || "").trim();
  }

  function findSheetTab(name) {
    const key = normalizedSheetName(name);
    return sheetTabs().find((tab) => normalizedSheetName(sheetTabName(tab)) === key) || null;
  }

  function sheetTabGid(tab) {
    const candidates = [
      tab?.id,
      tab?.getAttribute("data-gid"),
      tab?.getAttribute("data-sheet-id"),
      tab?.getAttribute("aria-controls"),
      tab?.querySelector("[href*='gid=']")?.getAttribute("href")
    ];
    for (const candidate of candidates) {
      const text = String(candidate || "");
      const match = text.match(/sheet-button-(\d+)/i) || text.match(/(?:^|[?&#])gid=(\d+)/i) || text.match(/^(\d+)$/);
      if (match) return match[1];
    }
    return "";
  }

  function elementVisible(element) {
    if (!(element instanceof Element) || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  async function waitForElement(read, errorMessage, timeout = 8_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await wait(60);
    }
    throw new Error(errorMessage);
  }

  function clickElement(element) {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
    element.click();
  }

  function sheetActionMenuItem(action) {
    const patterns = action === "rename"
      ? ["cambiar nombre", "renombrar", "rename"]
      : ["eliminar hoja", "borrar hoja", "delete sheet", "eliminar", "borrar", "delete"];
    return Array.from(document.querySelectorAll(".goog-menuitem, [role='menuitem']")).find((item) => {
      if (!elementVisible(item) || item.getAttribute("aria-disabled") === "true") return false;
      const label = normalizedSheetName(`${item.getAttribute("aria-label") || ""} ${item.getAttribute("data-id") || ""} ${item.textContent || ""}`);
      return patterns.some((pattern) => label.includes(pattern));
    }) || null;
  }

  async function openSheetAction(tab, action) {
    clickElement(tab.querySelector(".docs-sheet-tab-name") || tab);
    await wait(80);
    const dropdown = tab.querySelector(".docs-sheet-tab-dropdown, [aria-haspopup='menu']");
    if (dropdown) clickElement(dropdown);
    else tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, buttons: 2 }));
    const item = await waitForElement(
      () => sheetActionMenuItem(action),
      action === "rename" ? "No se encontró la opción para cambiar el nombre de la hoja" : "No se encontró la opción para eliminar la hoja"
    );
    clickElement(item);
  }

  function renameEditor() {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.id !== "t-name-box" && elementVisible(active)) return active;
    const selectors = [
      ".docs-sheet-tab input",
      ".docs-sheet-tab [contenteditable='true']",
      "[role='dialog'] input[type='text']",
      ".modal-dialog input[type='text']"
    ];
    return Array.from(document.querySelectorAll(selectors.join(","))).find(elementVisible) || null;
  }

  function setEditorValue(editor, value) {
    editor.focus();
    if (editor instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(editor, value);
      else editor.value = value;
    } else {
      editor.textContent = value;
    }
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function confirmationButton(action) {
    const patterns = action === "rename"
      ? ["aceptar", "guardar", "cambiar nombre", "rename", "ok"]
      : ["eliminar", "borrar", "delete", "aceptar", "ok"];
    const dialogs = Array.from(document.querySelectorAll("[role='dialog'], .modal-dialog")).filter(elementVisible);
    for (const dialog of dialogs) {
      const button = Array.from(dialog.querySelectorAll("button, [role='button'], .goog-buttonset-action")).find((candidate) => {
        if (!elementVisible(candidate)) return false;
        const label = normalizedSheetName(`${candidate.getAttribute("aria-label") || ""} ${candidate.textContent || ""}`);
        return patterns.some((pattern) => label === pattern || label.includes(pattern));
      });
      if (button) return button;
    }
    return null;
  }

  async function renameSheet(previousName, nextValue) {
    const nextName = validateSheetName(nextValue);
    const source = findSheetTab(previousName);
    if (!source) throw new Error(`No se encontró la hoja ${previousName}`);
    const duplicate = findSheetTab(nextName);
    if (duplicate && duplicate !== source) throw new Error(`Ya existe una hoja llamada ${nextName}`);
    if (sheetTabName(source) === nextName) {
      return { name: sheetTabName(source), gid: sheetTabGid(source) };
    }
    await openSheetAction(source, "rename");
    const editor = await waitForElement(renameEditor, "Sheets no abrió el editor del nombre de la hoja");
    setEditorValue(editor, nextName);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await wait(120);
    if (!findSheetTab(nextName)) {
      const confirm = confirmationButton("rename");
      if (confirm) clickElement(confirm);
    }
    const renamed = await waitForElement(() => findSheetTab(nextName), "Sheets no confirmó el nuevo nombre de la hoja");
    return { name: sheetTabName(renamed), gid: sheetTabGid(renamed) };
  }

  async function createSheet(nameValue) {
    const name = validateSheetName(nameValue);
    if (findSheetTab(name)) throw new Error(`Ya existe una hoja llamada ${name}`);
    const before = new Set(sheetTabs().map((tab) => normalizedSheetName(sheetTabName(tab))));
    const add = document.querySelector([
      "#docs-sheet-add-button",
      "[aria-label='Añadir hoja']",
      "[aria-label='Agregar hoja']",
      "[aria-label='Add sheet']",
      "[data-tooltip='Añadir hoja']",
      "[data-tooltip='Agregar hoja']",
      "[data-tooltip='Add sheet']"
    ].join(","));
    if (add) clickElement(add);
    else {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", code: "F11", shiftKey: true, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "F11", code: "F11", shiftKey: true, bubbles: true, cancelable: true }));
    }
    const created = await waitForElement(
      () => sheetTabs().find((tab) => !before.has(normalizedSheetName(sheetTabName(tab)))),
      "Sheets no creó la hoja"
    );
    return renameSheet(sheetTabName(created), name);
  }

  async function deleteSheet(nameValue) {
    const name = validateSheetName(nameValue);
    const tab = findSheetTab(name);
    if (!tab) throw new Error(`No se encontró la hoja ${name}`);
    if (sheetTabs().length <= 1) throw new Error("No se puede eliminar la única hoja del documento");
    const gid = sheetTabGid(tab);
    await openSheetAction(tab, "delete");
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && findSheetTab(name)) {
      const confirm = confirmationButton("delete");
      if (confirm) clickElement(confirm);
      await wait(80);
    }
    if (findSheetTab(name)) throw new Error("Sheets no confirmó la eliminación de la hoja");
    return { name, gid };
  }

  async function runSheetOperation(operation) {
    const action = String(operation?.action || "");
    if (action === "create_sheet") return { action, ...(await createSheet(operation.name)) };
    if (action === "rename_sheet") return { action, previousName: String(operation.sheet || "").trim(), ...(await renameSheet(operation.sheet, operation.name)) };
    if (action === "delete_sheet") return { action, ...(await deleteSheet(operation.sheet)) };
    throw new Error(`Operación de hoja no soportada: ${action}`);
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
        const result = await enqueueBridgeInteraction(() => runSheetOperation(message.operation));
        window.postMessage({ source: SOURCE, type: "sheet-operation-result", requestId: message.requestId, ok: true, result }, location.origin);
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
