(() => {
  "use strict";

  if (!/\/spreadsheets\/d\/[^/]+\/edit/.test(location.pathname)) return;
  if (window.__sheetsRowDrawerWriteBridge) return;
  window.__sheetsRowDrawerWriteBridge = true;

  const SOURCE = "sheets-row-drawer";
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (event.source !== window || message?.source !== SOURCE) return;

    if (message?.type === "focus-range") {
      try {
        focusCell(String(message.reference || ""));
        await wait(180);
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
      if (message.restoreReference) {
        focusCell(message.restoreReference);
        await wait(180);
      }
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
