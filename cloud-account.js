function el(document, tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(document, text, className = "secondary-button") {
  const node = el(document, "button", className, text);
  node.type = "button";
  return node;
}

function input(document, { name, label, type = "text", value = "", autocomplete = "off", min = "" }) {
  const item = el(document, "label", "cloud-form-item");
  item.appendChild(el(document, "span", "cloud-form-label", label));
  const control = el(document, "input", "property-input");
  control.name = name;
  control.type = type;
  control.value = value ?? "";
  control.autocomplete = autocomplete;
  if (min !== "") control.min = min;
  item.appendChild(control);
  return { item, control };
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateLabel(value) {
  if (!value) return "Sin vencimiento";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Sin vencimiento" : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function money(plan) {
  return new Intl.NumberFormat("es", {
    style: "currency",
    currency: String(plan.currency || "usd").toUpperCase()
  }).format((Number(plan.amountCents) || 0) / 100);
}

const manageableBillingStatuses = new Set(["active", "trialing", "past_due", "unpaid", "incomplete", "paused"]);

function hasManageableSubscription(account) {
  return Boolean(
    account?.hasBillingPortal &&
    manageableBillingStatuses.has(String(account.billingStatus || "").toLowerCase())
  );
}

export function createCloudAccountUi(options) {
  const {
    document,
    send,
    openExternal,
    onSessionChange,
    onBlockedClose
  } = options;

  const state = {
    session: { authenticated: false },
    mode: "login",
    tab: "profile",
    plans: [],
    adminAccounts: [],
    adminUsers: [],
    adminPlans: [],
    busy: false,
    error: "",
    notice: ""
  };

  const root = el(document, "section", "account-drawer");
  root.hidden = true;
  root.setAttribute("aria-label", "Cuenta de Sheets CRM");
  const header = el(document, "div", "property-header");
  const heading = el(document, "h2", "", "Cuenta");
  const close = button(document, "×", "icon-button");
  close.title = "Cerrar";
  close.setAttribute("aria-label", "Cerrar cuenta");
  header.append(heading, close);
  const body = el(document, "div", "property-body cloud-account-body");
  root.append(header, body);

  function setBusy(value) {
    state.busy = Boolean(value);
    root.setAttribute("aria-busy", String(state.busy));
    for (const control of root.querySelectorAll("button,input,select")) {
      if (state.busy) {
        if (!control.hasAttribute("data-cloud-disabled")) {
          control.setAttribute("data-cloud-disabled", String(control.disabled));
        }
        control.disabled = true;
      } else if (control.hasAttribute("data-cloud-disabled")) {
        control.disabled = control.getAttribute("data-cloud-disabled") === "true";
        control.removeAttribute("data-cloud-disabled");
      }
    }
  }

  function showError(message) {
    state.error = String(message || "No se pudo completar la solicitud.");
    state.notice = "";
    render();
  }

  function showNotice(message) {
    state.notice = String(message || "");
    state.error = "";
    render();
  }

  async function request(type, payload) {
    setBusy(true);
    try {
      const result = await send(type, payload || {});
      if (!result?.ok) throw new Error(result?.error || "No se pudo completar la solicitud.");
      return result;
    } finally {
      setBusy(false);
    }
  }

  function setSession(session) {
    state.session = session?.authenticated ? session : { authenticated: false };
    state.mode = state.session.authenticated ? "profile" : "login";
    state.tab = "profile";
    state.error = "";
    state.notice = "";
    onSessionChange?.(state.session);
    render();
  }

  async function refresh() {
    state.error = "";
    setBusy(true);
    try {
      const result = await send("session", {});
      if (!result?.ok) {
        state.session = { authenticated: false, serviceError: result?.error || "No se pudo conectar con el servicio." };
        state.error = state.session.serviceError;
        onSessionChange?.(state.session);
        render();
        return state.session;
      }
      setSession(result);
      return state.session;
    } finally {
      setBusy(false);
    }
  }

  async function loadPlans() {
    if (state.plans.length) return;
    const result = await request("billing.plans");
    state.plans = result.plans || [];
  }

  function statusMessage() {
    if (state.error) return el(document, "div", "cloud-message error", state.error);
    if (state.notice) return el(document, "div", "cloud-message success", state.notice);
    return null;
  }

  function actionRow(...controls) {
    const row = el(document, "div", "cloud-actions");
    row.append(...controls.filter(Boolean));
    return row;
  }

  function planInput(selectedCode = "") {
    const item = el(document, "label", "cloud-form-item");
    item.appendChild(el(document, "span", "cloud-form-label", "Plan"));
    const control = el(document, "select", "property-input");
    for (const plan of state.plans) {
      const option = el(document, "option", "", `${plan.name} · ${money(plan)} / ${plan.interval === "year" ? "año" : "mes"}`);
      option.value = plan.code;
      control.appendChild(option);
    }
    if (state.plans.some(plan => plan.code === selectedCode)) control.value = selectedCode;
    if (!state.plans.length) {
      const option = el(document, "option", "", "No hay planes disponibles");
      option.value = "";
      control.appendChild(option);
      control.disabled = true;
    }
    item.appendChild(control);
    return { item, control };
  }

  function renderLogin() {
    heading.textContent = "Iniciar sesión";
    const card = el(document, "div", "cloud-card");
    card.appendChild(el(document, "h3", "", "Sheets CRM"));
    card.appendChild(el(document, "p", "cloud-copy", "Inicia sesión para cargar la configuración de este documento y usar el servicio."));
    const email = input(document, { name: "email", label: "Correo", type: "email", autocomplete: "email" });
    const password = input(document, { name: "password", label: "Contraseña", type: "password", autocomplete: "current-password" });
    const login = button(document, "Iniciar sesión", "primary-button");
    const signup = button(document, "Contratar");
    login.addEventListener("click", async () => {
      try {
        const result = await request("login", { email: email.control.value, password: password.control.value });
        setSession(result);
      } catch (error) { showError(error.message); }
    });
    signup.addEventListener("click", async () => {
      try {
        await loadPlans();
        state.mode = "signup";
        state.error = "";
        render();
      } catch (error) { showError(error.message); }
    });
    card.append(email.item, password.item, actionRow(signup, login));
    body.appendChild(card);
  }

  function renderSignup() {
    heading.textContent = "Contratar Sheets CRM";
    const card = el(document, "div", "cloud-card");
    const name = input(document, { name: "name", label: "Nombre", autocomplete: "name" });
    const email = input(document, { name: "email", label: "Correo", type: "email", autocomplete: "email" });
    const password = input(document, { name: "password", label: "Contraseña", type: "password", autocomplete: "new-password" });
    const plan = planInput();
    const back = button(document, "Volver");
    const checkout = button(document, "Ir a pagar", "primary-button");
    checkout.disabled = !state.plans.length;
    back.addEventListener("click", () => { state.mode = "login"; state.error = ""; render(); });
    checkout.addEventListener("click", async () => {
      try {
        const result = await request("billing.checkout", {
          name: name.control.value,
          email: email.control.value,
          password: password.control.value,
          plan: plan.control.value
        });
        openExternal(result.url);
        showNotice("Se abrió Stripe en una pestaña nueva. Al completar el pago, vuelve aquí para iniciar sesión.");
      } catch (error) { showError(error.message); }
    });
    card.append(name.item, email.item, password.item, plan.item, actionRow(back, checkout));
    body.appendChild(card);
  }

  function accountSummary() {
    const { user, account } = state.session;
    const summary = el(document, "div", "cloud-account-summary");
    const avatar = el(document, "span", "cloud-avatar", String(user?.name || user?.email || "U").slice(0, 1).toUpperCase());
    const copy = el(document, "div");
    copy.append(el(document, "strong", "", user?.name || "Usuario"));
    copy.append(el(document, "span", "", user?.email || ""));
    const blocked = account?.status === "suspended" || account?.expired;
    const badge = el(document, "span", `cloud-status ${blocked ? "suspended" : "active"}`, account?.status === "suspended" ? "Suspendida" : account?.expired ? "Expirada" : "Activa");
    summary.append(avatar, copy, badge);
    return summary;
  }

  function renderTabs() {
    const tabs = el(document, "div", "cloud-tabs");
    const definitions = [
      ["profile", "Mi cuenta"],
      ...(state.session.user?.role === "superadmin" ? [["admin", "Administración"], ["plans", "Planes"]] : [])
    ];
    for (const [id, label] of definitions) {
      const active = state.tab === id || (id === "profile" && state.tab === "renew");
      const control = button(document, label, active ? "is-active" : "");
      control.addEventListener("click", async () => {
        state.tab = id;
        state.error = "";
        render();
        try {
          if (id === "admin") await loadAdmin();
          if (id === "plans") await loadAdminPlans();
        } catch (error) { showError(error.message); }
      });
      tabs.appendChild(control);
    }
    body.appendChild(tabs);
  }

  function renderProfile() {
    const { user, account } = state.session;
    heading.textContent = "Mi cuenta";
    const card = el(document, "div", "cloud-card");
    const details = el(document, "dl", "cloud-details");
    for (const [term, value] of [
      ["Cuenta", account?.name || ""],
      ["Rol", user?.role || ""],
      ["Plan", account?.billingPlan || "Sin plan"],
      ["Vencimiento", dateLabel(account?.expiresAt)]
    ]) {
      details.append(el(document, "dt", "", term), el(document, "dd", "", value));
    }
    const name = input(document, { name: "name", label: "Nombre", value: user?.name || "", autocomplete: "name" });
    const email = input(document, { name: "email", label: "Correo", type: "email", value: user?.email || "", autocomplete: "email" });
    const password = input(document, { name: "password", label: "Nueva contraseña", type: "password", autocomplete: "new-password" });
    const save = button(document, "Guardar perfil", "primary-button");
    save.addEventListener("click", async () => {
      try {
        const result = await request("account.update", { name: name.control.value, email: email.control.value, password: password.control.value });
        setSession({ ...state.session, ...result, authenticated: true });
        showNotice("Cuenta actualizada.");
      } catch (error) { showError(error.message); }
    });
    const managesSubscription = hasManageableSubscription(account);
    const billing = button(document, managesSubscription ? "Administrar pago" : account?.billingPlan ? "Renovar" : "Elegir plan");
    billing.addEventListener("click", async () => {
      try {
        if (managesSubscription) {
          const result = await request("billing.portal");
          openExternal(result.url);
          return;
        }
        await loadPlans();
        state.tab = "renew";
        state.error = "";
        render();
      } catch (error) { showError(error.message); }
    });
    const logout = button(document, "Cerrar sesión");
    logout.addEventListener("click", async () => {
      try { setSession(await request("logout")); } catch (error) { showError(error.message); }
    });
    const stop = state.session.canStopImpersonation ? button(document, "Volver a admin") : null;
    stop?.addEventListener("click", async () => {
      try { setSession(await request("admin.stopImpersonation")); } catch (error) { showError(error.message); }
    });
    card.append(details, name.item, email.item, password.item, actionRow(stop, billing, logout, save));
    body.appendChild(card);
  }

  function renderRenewal() {
    const { account } = state.session;
    heading.textContent = "Seleccionar plan";
    const card = el(document, "div", "cloud-card");
    card.appendChild(el(document, "h3", "", "Renovar suscripción"));
    card.appendChild(el(document, "p", "cloud-copy", "Elige el plan que quieres contratar antes de continuar a Stripe."));
    const plan = planInput(account?.billingPlan || "");
    const back = button(document, "Volver");
    const checkout = button(document, "Ir a pagar", "primary-button");
    checkout.disabled = !state.plans.length;
    back.addEventListener("click", () => {
      state.tab = "profile";
      state.error = "";
      render();
    });
    checkout.addEventListener("click", async () => {
      try {
        const result = await request("billing.renew", { plan: plan.control.value });
        openExternal(result.url);
        showNotice("Se abrió Stripe en una pestaña nueva. Al completar el pago, vuelve aquí para actualizar tu cuenta.");
      } catch (error) { showError(error.message); }
    });
    card.append(plan.item, actionRow(back, checkout));
    body.appendChild(card);
  }

  async function loadAdmin() {
    const [accounts, users] = await Promise.all([request("admin.accounts"), request("admin.users")]);
    state.adminAccounts = accounts.accounts || [];
    state.adminUsers = users.users || [];
    render();
  }

  function renderAdmin() {
    heading.textContent = "Administración";
    const create = el(document, "div", "cloud-card");
    create.appendChild(el(document, "h3", "", "Nueva cuenta"));
    const name = input(document, { name: "name", label: "Nombre" });
    const email = input(document, { name: "email", label: "Correo admin", type: "email" });
    const password = input(document, { name: "password", label: "Contraseña", type: "password" });
    const expires = input(document, { name: "expiresAt", label: "Vencimiento", type: "datetime-local" });
    const max = input(document, { name: "maxWorkspaces", label: "Máximo de documentos", type: "number", value: "0", min: "0" });
    const submit = button(document, "Crear cuenta", "primary-button");
    submit.addEventListener("click", async () => {
      try {
        await request("admin.account.create", {
          name: name.control.value,
          email: email.control.value,
          password: password.control.value,
          expiresAt: expires.control.value || null,
          maxWorkspaces: Number(max.control.value) || 0
        });
        await loadAdmin();
        showNotice("Cuenta creada.");
      } catch (error) { showError(error.message); }
    });
    create.append(name.item, email.item, password.item, expires.item, max.item, actionRow(submit));
    body.appendChild(create);

    const list = el(document, "div", "cloud-admin-list");
    for (const account of state.adminAccounts) {
      const card = el(document, "div", "cloud-card cloud-admin-card");
      card.appendChild(el(document, "h3", "", account.name || `Cuenta ${account.id}`));
      card.appendChild(el(document, "p", "cloud-copy", `${account.adminEmail || "Sin correo"} · ${account.workspaceCount || 0} documentos · ${account.userCount || 0} usuarios`));
      const accountName = input(document, { name: "name", label: "Nombre", value: account.name || "" });
      const expiration = input(document, { name: "expiresAt", label: "Vencimiento", type: "datetime-local", value: dateInputValue(account.expiresAt) });
      const limit = input(document, { name: "maxWorkspaces", label: "Máximo de documentos", type: "number", value: String(account.maxWorkspaces || 0), min: "0" });
      const save = button(document, "Guardar", "primary-button");
      const toggle = button(document, account.status === "active" ? "Suspender" : "Activar");
      const targetUser = state.adminUsers.find(user => Number(user.accountId) === Number(account.id));
      const impersonate = targetUser ? button(document, "Impersonar") : null;
      save.addEventListener("click", async () => {
        try {
          await request("admin.account.update", { id: account.id, name: accountName.control.value, status: account.status, expiresAt: expiration.control.value || null, maxWorkspaces: Number(limit.control.value) || 0 });
          await loadAdmin();
          showNotice("Cuenta actualizada.");
        } catch (error) { showError(error.message); }
      });
      toggle.addEventListener("click", async () => {
        try {
          await request("admin.account.update", { id: account.id, name: account.name, status: account.status === "active" ? "suspended" : "active", expiresAt: account.expiresAt, maxWorkspaces: account.maxWorkspaces });
          await loadAdmin();
        } catch (error) { showError(error.message); }
      });
      impersonate?.addEventListener("click", async () => {
        try { setSession(await request("admin.impersonate", { userId: targetUser.id })); } catch (error) { showError(error.message); }
      });
      card.append(accountName.item, expiration.item, limit.item, actionRow(toggle, impersonate, save));
      list.appendChild(card);
    }
    body.appendChild(list);
  }

  async function loadAdminPlans() {
    const result = await request("admin.plans");
    state.adminPlans = result.plans || [];
    render();
  }

  function planForm(plan = null) {
    const card = el(document, "div", "cloud-card");
    card.appendChild(el(document, "h3", "", plan ? plan.name : "Nuevo plan"));
    const code = input(document, { name: "code", label: "Código", value: plan?.code || "" });
    const name = input(document, { name: "name", label: "Nombre", value: plan?.name || "" });
    const amount = input(document, { name: "amountCents", label: "Monto en centavos", type: "number", value: String(plan?.amountCents || ""), min: "0" });
    const currency = input(document, { name: "currency", label: "Moneda", value: plan?.currency || "usd" });
    const max = input(document, { name: "maxWorkspaces", label: "Máximo de documentos", type: "number", value: String(plan?.maxWorkspaces || 0), min: "0" });
    const intervalItem = el(document, "label", "cloud-form-item");
    intervalItem.appendChild(el(document, "span", "cloud-form-label", "Frecuencia"));
    const interval = el(document, "select", "property-input");
    for (const [value, label] of [["month", "Mensual"], ["year", "Anual"]]) {
      const option = el(document, "option", "", label);
      option.value = value;
      option.selected = (plan?.interval || "month") === value;
      interval.appendChild(option);
    }
    intervalItem.appendChild(interval);
    const save = button(document, plan ? "Guardar" : "Crear plan", "primary-button");
    save.addEventListener("click", async () => {
      try {
        const payload = { id: plan?.id, code: code.control.value, name: name.control.value, amountCents: Number(amount.control.value), currency: currency.control.value, interval: interval.value, maxWorkspaces: Number(max.control.value), active: plan?.active ?? true, public: plan?.public ?? true, sortOrder: plan?.sortOrder || 0 };
        await request(plan ? "admin.plan.update" : "admin.plan.create", payload);
        await loadAdminPlans();
        showNotice(plan ? "Plan actualizado." : "Plan creado.");
      } catch (error) { showError(error.message); }
    });
    const remove = plan ? button(document, "Eliminar") : null;
    remove?.addEventListener("click", async () => {
      try { await request("admin.plan.delete", { id: plan.id }); await loadAdminPlans(); } catch (error) { showError(error.message); }
    });
    if (plan) code.control.disabled = true;
    card.append(code.item, name.item, amount.item, currency.item, intervalItem, max.item, actionRow(remove, save));
    return card;
  }

  function renderPlans() {
    heading.textContent = "Planes";
    body.appendChild(planForm());
    const list = el(document, "div", "cloud-admin-list");
    for (const plan of state.adminPlans) list.appendChild(planForm(plan));
    body.appendChild(list);
  }

  function renderAuthenticated() {
    body.appendChild(accountSummary());
    renderTabs();
    if (state.tab === "admin") renderAdmin();
    else if (state.tab === "plans") renderPlans();
    else if (state.tab === "renew") renderRenewal();
    else renderProfile();
  }

  function render() {
    body.replaceChildren();
    const message = statusMessage();
    if (message) body.appendChild(message);
    if (!state.session.authenticated) {
      if (state.mode === "signup") renderSignup();
      else renderLogin();
    } else renderAuthenticated();
    setBusy(state.busy);
  }

  close.addEventListener("click", () => {
    if (!state.session.authenticated) onBlockedClose?.();
    else root.hidden = true;
  });

  render();

  return {
    element: root,
    get session() { return state.session; },
    open() { root.hidden = false; render(); },
    close() { if (state.session.authenticated) root.hidden = true; },
    refresh,
    setSession
  };
}
