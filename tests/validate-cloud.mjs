import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const backgroundSource = await readFile(path.resolve(import.meta.dirname, "..", "background.js"), "utf8");
const stored = new Map();
const requests = [];
let listener;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function fetchMock(url, options = {}) {
  requests.push({ url: String(url), options });
  const pathname = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  const authorization = options.headers?.Authorization || "";

  if (pathname.endsWith("/auth/login")) {
    if (body.email !== "admin@example.com" || body.password !== "password123") return jsonResponse({ message: "Credenciales incorrectas" }, 401);
    return jsonResponse({
      token: "admin-token",
      user: { id: 1, accountId: 1, name: "Admin", email: body.email, role: "superadmin" },
      account: { id: 1, name: "Drawer", status: "active", expired: false }
    });
  }
  if (pathname.endsWith("/auth/me")) {
    if (authorization === "Bearer expired-user-token") return jsonResponse({ message: "Sesión vencida" }, 401);
    const impersonated = authorization === "Bearer user-token";
    return jsonResponse({
      user: impersonated
        ? { id: 2, accountId: 2, name: "Cliente", email: "client@example.com", role: "admin", impersonatedBy: 1 }
        : { id: 1, accountId: 1, name: "Admin", email: "admin@example.com", role: "superadmin" },
      account: { id: impersonated ? 2 : 1, name: impersonated ? "Cliente" : "Drawer", status: "active", expired: false }
    });
  }
  if (pathname.endsWith("/account/data") && options.method === "DELETE") {
    if (body.confirmation !== "ELIMINAR TODO") return jsonResponse({ message: "Confirmación inválida" }, 400);
    return jsonResponse({ ok: true, accountId: 1 });
  }
  if (pathname.endsWith("/workspaces/sheet-123456")) {
    if (options.method === "PUT") return jsonResponse({ ok: true, revision: 4, updatedAt: "2026-10-03T00:00:00Z" });
    return jsonResponse({ workspace: { version: 2, sheets: {}, updatedAt: 10 }, revision: 3, name: "Prueba" });
  }
  if (pathname.endsWith("/admin/users/2/impersonate")) {
    return jsonResponse({
      token: "user-token",
      user: { id: 2, accountId: 2, name: "Cliente", email: "client@example.com", role: "admin", impersonatedBy: 1 },
      account: { id: 2, name: "Cliente", status: "active", expired: false }
    });
  }
  return jsonResponse({ message: `Ruta no simulada: ${pathname}` }, 404);
}

const chrome = {
  runtime: {
    getManifest: () => ({ version: "test" }),
    onMessage: { addListener: callback => { listener = callback; } }
  },
  storage: {
    local: {
      async get(keys) {
        if (keys === null) return Object.fromEntries(stored);
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = stored.get(key);
        return result;
      },
      async set(values) { for (const [key, value] of Object.entries(values)) stored.set(key, value); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) stored.delete(key); }
    }
  }
};

vm.runInNewContext(backgroundSource, {
  AbortController,
  URL,
  clearTimeout,
  fetch: fetchMock,
  globalThis: { chrome },
  setTimeout,
  chrome
}, { filename: "background.js" });

function message(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const accepted = listener({ source: "sheets-row-drawer-cloud", type, payload }, {}, resolve);
    if (!accepted) reject(new Error(`El background rechazó ${type}`));
  });
}

const signedOut = await message("session");
if (!signedOut.ok || signedOut.authenticated) throw new Error("La sesión vacía no fue reconocida.");

const login = await message("login", { email: "admin@example.com", password: "password123" });
if (!login.ok || !login.authenticated || login.user.role !== "superadmin") throw new Error("El inicio de sesión no persistió el usuario.");
if (stored.get("srd:cloud:auth-token") !== "admin-token") throw new Error("El token no quedó en chrome.storage.");

const workspace = await message("workspace.get", { spreadsheetId: "sheet-123456" });
if (!workspace.ok || !workspace.found || workspace.revision !== 3) throw new Error("No se recuperó el workspace autorizado.");
const authorizedRequest = requests.find(request => request.url.endsWith("/workspaces/sheet-123456"));
if (authorizedRequest?.options?.headers?.Authorization !== "Bearer admin-token") throw new Error("El workspace se solicitó sin JWT.");

const saved = await message("workspace.put", { spreadsheetId: "sheet-123456", workspace: { version: 2 }, revision: 3 });
if (!saved.ok || saved.revision !== 4) throw new Error("No se persistió la revisión del workspace.");

const impersonated = await message("admin.impersonate", { userId: 2 });
if (!impersonated.ok || !impersonated.canStopImpersonation || stored.get("srd:cloud:admin-token") !== "admin-token" || stored.get("srd:cloud:auth-token") !== "user-token") {
  throw new Error("La impersonación no conservó la sesión administrativa.");
}

const restored = await message("admin.stopImpersonation");
if (!restored.ok || restored.user.role !== "superadmin" || stored.get("srd:cloud:auth-token") !== "admin-token" || stored.has("srd:cloud:admin-token")) {
  throw new Error("No se restauró la sesión administrativa.");
}

await message("admin.impersonate", { userId: 2 });
stored.set("srd:cloud:auth-token", "expired-user-token");
const automaticallyRestored = await message("session");
if (!automaticallyRestored.ok || automaticallyRestored.user?.role !== "superadmin" || stored.get("srd:cloud:auth-token") !== "admin-token" || stored.has("srd:cloud:admin-token")) {
  throw new Error("La sesión administrativa no se restauró al vencer la impersonación.");
}

stored.set("srd:workspace:v2:account:1:sheet-123456", { version: 2 });
stored.set("srd:workspace:v1:account:1:sheet-old", { version: 1 });
stored.set("srd:workspace:v2:account:2:sheet-other", { version: 2 });
stored.set("srd:workspace:v2:local:sheet-123456", { version: 2, local: true });
stored.set("srd:v2:row:sheet-123456:0:2", { values: ["dato"] });
stored.set("srd:theme-mode", "dark");
const deleted = await message("account.clear", { confirmation: "ELIMINAR TODO" });
const deletionRequest = requests.find(request => request.url.endsWith("/account/data"));
if (!deleted.ok || deletionRequest?.options?.method !== "DELETE" || JSON.parse(deletionRequest.options.body).confirmation !== "ELIMINAR TODO") {
  throw new Error("La limpieza de datos no llegó al servicio con la confirmación requerida.");
}
if (
  stored.get("srd:cloud:auth-token") !== "admin-token"
  || stored.has("srd:cloud:admin-token")
  || stored.has("srd:workspace:v2:account:1:sheet-123456")
  || stored.has("srd:workspace:v1:account:1:sheet-old")
  || stored.has("srd:v2:row:sheet-123456:0:2")
  || !stored.has("srd:workspace:v2:account:2:sheet-other")
  || !stored.has("srd:workspace:v2:local:sheet-123456")
  || stored.get("srd:theme-mode") !== "dark"
) {
  throw new Error("La limpieza no eliminó únicamente los datos locales de la cuenta.");
}

console.log("CLOUD_OK: login, JWT, workspace, impersonación y limpieza completa de datos confirmados.");
