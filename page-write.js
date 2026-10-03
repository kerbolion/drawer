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

  function notifySheetChange(reason) {
    if (bridgeInteractionDepth > 0) return;
    clearTimeout(sheetChangeTimer);
    sheetChangeTimer = setTimeout(() => {
      sheetChangeTimer = null;
      if (bridgeInteractionDepth > 0) return;
      window.postMessage({ source: SOURCE, type: "sheet-change", reason }, location.origin);
    }, reason === "input" || reason === "composition" ? 160 : 60);
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
    if (key === "delete" || key === "backspace" || (command && (key === "z" || key === "y")) || (editable && (key === "enter" || key === "tab"))) {
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
