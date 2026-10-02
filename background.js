(() => {
  "use strict";

  const BRIDGE_ORIGIN = "http://127.0.0.1:17373";
  const BRIDGE_HEADER = "sheets-row-drawer-v1";

  async function post(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_200);
    try {
      const response = await fetch(`${BRIDGE_ORIGIN}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sheets-Row-Drawer-Bridge": BRIDGE_HEADER
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.source !== "sheets-row-drawer-codex") return false;
    const route = message.type === "poll" ? "/v1/poll" : message.type === "result" ? "/v1/result" : "";
    if (!route) return false;

    void post(route, {
      ...message.payload,
      extensionVersion: chrome.runtime.getManifest().version,
      tabId: sender.tab?.id ?? null,
      tabActive: sender.tab?.active ?? null
    }).then((result) => sendResponse(result || { command: null }));
    return true;
  });
})();
