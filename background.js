(() => {
  "use strict";

  const BRIDGE_ORIGIN = "http://127.0.0.1:17373";
  const BRIDGE_HEADER = "sheets-row-drawer-v1";
  const CLOUD_SOURCE = "sheets-row-drawer-cloud";
  const API_BASE_DEFAULT = "https://abrircrm.com/api/sheets-drawer";
  const STORAGE_KEYS = {
    apiBase: "srd:cloud:api-base",
    token: "srd:cloud:auth-token",
    adminToken: "srd:cloud:admin-token"
  };

  function storageArea() {
    return globalThis.chrome?.storage?.local || null;
  }

  async function storageGet(keys) {
    const area = storageArea();
    return area ? area.get(keys) : {};
  }

  async function storageSet(values) {
    const area = storageArea();
    if (area) await area.set(values);
  }

  async function storageRemove(keys) {
    const area = storageArea();
    if (area) await area.remove(keys);
  }

  async function clearAccountDataStorage(accountId) {
    const stored = await storageGet(null);
    const accountMarker = `:account:${encodeURIComponent(String(accountId))}:`;
    const keys = Object.keys(stored).filter((key) => (
      (key.startsWith("srd:workspace:") && key.includes(accountMarker)) || key.startsWith("srd:v2:")
    ));
    await storageRemove([...new Set(keys)]);
  }

  async function apiBase() {
    const stored = await storageGet(STORAGE_KEYS.apiBase);
    return String(stored[STORAGE_KEYS.apiBase] || API_BASE_DEFAULT).replace(/\/$/, "");
  }

  async function bridgePost(path, body) {
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

  function bridgeAccessAllowed(session) {
    if (!session?.ok || !session.authenticated || !session.user || session.user.active === false) return false;
    if (session.user.role === "superadmin") return true;
    return session.account?.status === "active" && !session.account?.expired;
  }

  function bridgeAccessError(session) {
    if (!session?.ok) return session?.error || "No se pudo validar la sesión de Abrir CRM.";
    if (!session.authenticated || !session.user) return "Inicia sesión en Abrir CRM para usar el acceso de IA.";
    if (session.user.active === false) return "El usuario de Abrir CRM está inactivo.";
    if (session.account?.status !== "active") return "La cuenta de Abrir CRM está suspendida.";
    if (session.account?.expired) return "La suscripción de Abrir CRM está vencida.";
    return "La cuenta no tiene acceso al servicio.";
  }

  function bridgeSessionPayload(session, error) {
    if (session?.ok && session.authenticated) return session;
    return { authenticated: false, serviceError: error };
  }

  function isSheetsSender(sender) {
    const senderUrl = String(sender?.url || sender?.tab?.url || "");
    return /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(senderUrl);
  }

  async function cloudRequest(path, options = {}) {
    const stored = await storageGet(STORAGE_KEYS.token);
    const token = stored[STORAGE_KEYS.token] || "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeout || 15_000));
    try {
      const response = await fetch(`${await apiBase()}${path}`, {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && options.clearInvalidSession !== false) {
          await storageRemove(STORAGE_KEYS.token);
        }
        return {
          ok: false,
          status: response.status,
          code: data.code || "",
          error: data.message || `Solicitud rechazada (${response.status}).`,
          data
        };
      }
      return { ok: true, status: response.status, data };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        code: error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
        error: error?.name === "AbortError" ? "El servidor tardó demasiado en responder." : "No se pudo conectar con el servicio."
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function cloudCommand(type, payload = {}) {
    switch (type) {
      case "session": {
        const stored = await storageGet([STORAGE_KEYS.token, STORAGE_KEYS.adminToken]);
        if (!stored[STORAGE_KEYS.token] && stored[STORAGE_KEYS.adminToken]) {
          await storageSet({ [STORAGE_KEYS.token]: stored[STORAGE_KEYS.adminToken] });
          await storageRemove(STORAGE_KEYS.adminToken);
          stored[STORAGE_KEYS.token] = stored[STORAGE_KEYS.adminToken];
          stored[STORAGE_KEYS.adminToken] = "";
        }
        if (!stored[STORAGE_KEYS.token]) return { ok: true, authenticated: false };
        let result = await cloudRequest("/auth/me", { clearInvalidSession: true });
        if (!result.ok && result.status === 401 && stored[STORAGE_KEYS.adminToken]) {
          await storageSet({ [STORAGE_KEYS.token]: stored[STORAGE_KEYS.adminToken] });
          await storageRemove(STORAGE_KEYS.adminToken);
          stored[STORAGE_KEYS.adminToken] = "";
          result = await cloudRequest("/auth/me", { clearInvalidSession: true });
        }
        if (!result.ok) {
          if (result.status === 401) return { ok: true, authenticated: false };
          return result;
        }
        return {
          ok: true,
          authenticated: true,
          user: result.data.user,
          account: result.data.account,
          canStopImpersonation: Boolean(stored[STORAGE_KEYS.adminToken])
        };
      }
      case "login": {
        const result = await cloudRequest("/auth/login", {
          method: "POST",
          body: { email: payload.email, password: payload.password },
          clearInvalidSession: false
        });
        if (!result.ok) return result;
        await storageSet({ [STORAGE_KEYS.token]: result.data.token });
        await storageRemove(STORAGE_KEYS.adminToken);
        return {
          ok: true,
          authenticated: true,
          user: result.data.user,
          account: result.data.account,
          canStopImpersonation: false
        };
      }
      case "logout":
        await storageRemove([STORAGE_KEYS.token, STORAGE_KEYS.adminToken]);
        return { ok: true, authenticated: false };
      case "account.update": {
        const result = await cloudRequest("/auth/me", { method: "PUT", body: payload });
        return result.ok ? { ok: true, ...result.data } : result;
      }
      case "account.clear": {
        const result = await cloudRequest("/account/data", {
          method: "DELETE",
          body: { confirmation: payload.confirmation }
        });
        if (!result.ok) return result;
        await clearAccountDataStorage(result.data.accountId);
        return { ok: true, ...result.data };
      }
      case "billing.plans": {
        const result = await cloudRequest("/billing/plans", { clearInvalidSession: false });
        return result.ok ? { ok: true, plans: result.data.plans || [] } : result;
      }
      case "billing.checkout": {
        const result = await cloudRequest("/billing/checkout", { method: "POST", body: payload, clearInvalidSession: false });
        return result.ok ? { ok: true, url: result.data.url } : result;
      }
      case "billing.renew": {
        const result = await cloudRequest("/billing/renew-checkout", { method: "POST", body: payload, clearInvalidSession: false });
        return result.ok ? { ok: true, url: result.data.url } : result;
      }
      case "billing.portal": {
        const result = await cloudRequest("/billing/portal", { method: "POST", body: {}, clearInvalidSession: false });
        return result.ok ? { ok: true, url: result.data.url } : result;
      }
      case "workspace.get": {
        const id = encodeURIComponent(String(payload.spreadsheetId || ""));
        const result = await cloudRequest(`/workspaces/${id}`);
        if (!result.ok && result.status === 404 && result.code === "WORKSPACE_NOT_FOUND") {
          return { ok: true, found: false };
        }
        return result.ok ? { ok: true, found: true, ...result.data } : result;
      }
      case "workspace.put": {
        const id = encodeURIComponent(String(payload.spreadsheetId || ""));
        const result = await cloudRequest(`/workspaces/${id}`, {
          method: "PUT",
          body: {
            workspace: payload.workspace,
            revision: payload.revision || 0,
            name: payload.name || ""
          }
        });
        return result.ok ? { ok: true, ...result.data } : result;
      }
      case "workspace.list": {
        const result = await cloudRequest("/workspaces");
        return result.ok ? { ok: true, workspaces: result.data.workspaces || [] } : result;
      }
      case "admin.accounts": {
        const result = await cloudRequest("/admin/accounts");
        return result.ok ? { ok: true, accounts: result.data.accounts || [] } : result;
      }
      case "admin.account.create": {
        const result = await cloudRequest("/admin/accounts", { method: "POST", body: payload });
        return result.ok ? { ok: true, ...result.data } : result;
      }
      case "admin.account.update": {
        const result = await cloudRequest(`/admin/accounts/${encodeURIComponent(payload.id)}`, { method: "PUT", body: payload });
        return result.ok ? { ok: true, ...result.data } : result;
      }
      case "admin.users": {
        const result = await cloudRequest("/admin/users");
        return result.ok ? { ok: true, users: result.data.users || [] } : result;
      }
      case "admin.impersonate": {
        const stored = await storageGet(STORAGE_KEYS.token);
        const currentToken = stored[STORAGE_KEYS.token] || "";
        const result = await cloudRequest(`/admin/users/${encodeURIComponent(payload.userId)}/impersonate`, { method: "POST", body: {} });
        if (!result.ok) return result;
        await storageSet({
          [STORAGE_KEYS.adminToken]: currentToken,
          [STORAGE_KEYS.token]: result.data.token
        });
        return {
          ok: true,
          authenticated: true,
          user: result.data.user,
          account: result.data.account,
          canStopImpersonation: true
        };
      }
      case "admin.stopImpersonation": {
        const stored = await storageGet(STORAGE_KEYS.adminToken);
        const adminToken = stored[STORAGE_KEYS.adminToken] || "";
        if (!adminToken) return { ok: false, status: 400, error: "No hay una sesión administrativa para restaurar." };
        await storageSet({ [STORAGE_KEYS.token]: adminToken });
        await storageRemove(STORAGE_KEYS.adminToken);
        const result = await cloudRequest("/auth/me");
        return result.ok ? {
          ok: true,
          authenticated: true,
          user: result.data.user,
          account: result.data.account,
          canStopImpersonation: false
        } : result;
      }
      case "admin.plans": {
        const result = await cloudRequest("/admin/billing-plans");
        return result.ok ? { ok: true, plans: result.data.plans || [] } : result;
      }
      case "admin.plan.create": {
        const result = await cloudRequest("/admin/billing-plans", { method: "POST", body: payload });
        return result.ok ? { ok: true, ...result.data } : result;
      }
      case "admin.plan.update": {
        const result = await cloudRequest(`/admin/billing-plans/${encodeURIComponent(payload.id)}`, { method: "PUT", body: payload });
        return result.ok ? { ok: true, ...result.data } : result;
      }
      case "admin.plan.delete": {
        const result = await cloudRequest(`/admin/billing-plans/${encodeURIComponent(payload.id)}`, { method: "DELETE" });
        return result.ok ? { ok: true, ...result.data } : result;
      }
      default:
        return { ok: false, status: 400, error: "Comando del servicio no reconocido." };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.source === "sheets-row-drawer-codex") {
      if (!isSheetsSender(sender)) {
        sendResponse({ command: null, accessBlocked: true, error: "Origen del puente no permitido." });
        return false;
      }
      const route = message.type === "poll" ? "/v1/poll" : message.type === "result" ? "/v1/result" : "";
      if (!route) return false;
      void (async () => {
        const bridgePayload = {
          ...message.payload,
          extensionVersion: chrome.runtime.getManifest().version
        };
        const result = await bridgePost(route, bridgePayload);
        if (message.type !== "poll" || !result?.command) {
          sendResponse(result || { command: null });
          return;
        }

        const session = await cloudCommand("session");
        if (bridgeAccessAllowed(session)) {
          sendResponse(result);
          return;
        }

        const error = bridgeAccessError(session);
        await bridgePost("/v1/result", {
          id: result.command.id,
          ok: false,
          error,
          code: "CLOUD_ACCESS_REQUIRED",
          extensionVersion: chrome.runtime.getManifest().version
        });
        sendResponse({
          command: null,
          accessBlocked: true,
          error,
          session: bridgeSessionPayload(session, error)
        });
      })().catch(error => sendResponse({
        command: null,
        accessBlocked: true,
        error: error?.message || "No se pudo validar el acceso del puente."
      }));
      return true;
    }

    if (message?.source === CLOUD_SOURCE) {
      void cloudCommand(message.type, message.payload || {})
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, status: 0, error: error?.message || "Error del servicio." }));
      return true;
    }

    return false;
  });
})();
