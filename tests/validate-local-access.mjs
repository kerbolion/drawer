import { createCloudAccountUi } from "../cloud-account.js";

class FakeNode {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.parentNode = null;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  closest(selector) {
    const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
    for (let node = this; node; node = node.parentNode) {
      if (attribute && node.hasAttribute(attribute)) return node;
    }
    return null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type) {
    const event = { preventDefault() {} };
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }

  querySelectorAll(selector) {
    const tags = new Set(selector.split(",").map(tag => tag.trim().toUpperCase()));
    const result = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (tags.has(child.tagName)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
}

const document = { createElement: tagName => new FakeNode(tagName) };
let continued = 0;
let blockedClose = 0;
const ui = createCloudAccountUi({
  document,
  send: async () => ({ ok: true, authenticated: false }),
  openExternal() {},
  onSessionChange() {},
  async onContinueWithoutAccount() { continued += 1; },
  onAccountDataCleared() {},
  onBlockedClose() { blockedClose += 1; },
  createFormControl(config) {
    const element = new FakeNode(config.type === "select" ? "select" : "input");
    let value = String(config.value ?? "");
    return {
      element,
      get value() { return value; },
      set value(nextValue) { value = String(nextValue ?? ""); },
      setBusy(nextBusy) { element.disabled = Boolean(nextBusy); },
      destroy() {}
    };
  }
});

function buttonByText(text) {
  return ui.element.querySelectorAll("button").find(button => button.textContent === text);
}

ui.open();
const local = buttonByText("Continuar sin cuenta");
if (!local) throw new Error("No se mostró la opción para continuar sin cuenta.");
await local.dispatch("click");
if (continued !== 1 || !ui.element.hidden) throw new Error("El modo local no cerró correctamente el acceso de cuenta.");

ui.element.hidden = false;
ui.close();
if (!ui.element.hidden) throw new Error("El panel de cuenta no puede cerrarse durante el modo local.");

ui.setSession({ authenticated: false });
ui.open();
await buttonByText("×").dispatch("click");
if (blockedClose !== 1) throw new Error("El acceso sin sesión se cerró sin elegir cuenta o modo local.");

console.log("LOCAL_ACCESS_OK: acceso sin cuenta y bloqueo de sesión confirmados.");
