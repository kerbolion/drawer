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

  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (event.source !== window || message?.source !== SOURCE || message?.type !== "write-range") return;

    try {
      focusCell(message.reference);
      await wait(120);
      paste(String(message.tsv ?? ""));
      await wait(180);
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
