import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { StyleProvider } from "@ant-design/cssinjs";
import Button from "antd/es/button/index.js";
import Card from "antd/es/card/index.js";
import Checkbox from "antd/es/checkbox/index.js";
import ConfigProvider from "antd/es/config-provider/index.js";
import DatePicker from "antd/es/date-picker/index.js";
import Drawer from "antd/es/drawer/index.js";
import Empty from "antd/es/empty/index.js";
import Input from "antd/es/input/index.js";
import InputNumber from "antd/es/input-number/index.js";
import Pagination from "antd/es/pagination/index.js";
import Segmented from "antd/es/segmented/index.js";
import Select from "antd/es/select/index.js";
import Space from "antd/es/space/index.js";
import Spin from "antd/es/spin/index.js";
import Tag from "antd/es/tag/index.js";
import TimePicker from "antd/es/time-picker/index.js";
import {
  CalculatorOutlined,
  AppstoreOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  DownOutlined,
  DragOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  LeftOutlined,
  LinkOutlined,
  MailOutlined,
  PhoneOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  TableOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import esES from "antd/es/locale/es_ES.js";
import dayjs from "dayjs";
import "dayjs/locale/es.js";
import { CircleDollarSign, Clock3, Hash, ListChecks, Type } from "lucide-react";
import { antdTokens, workspaceThemeConfig, workspaceTokens } from "./theme.js";

(() => {
  "use strict";

  dayjs.locale("es");

  function installTrustedHtmlBridge(view) {
    const factory = view?.trustedTypes;
    const prototype = view?.Element?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "innerHTML");
    if (!factory || !descriptor?.get || !descriptor?.set || !descriptor.configurable) return;
    let policy = null;
    for (const name of ["goog#html", "default", "sheets-row-drawer#html"]) {
      try {
        policy = factory.createPolicy(name, { createHTML: (value) => value });
        if (policy) break;
      } catch {}
    }
    if (!policy) return;
    try {
      Object.defineProperty(prototype, "innerHTML", {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          descriptor.set.call(this, typeof value === "string" ? policy.createHTML(value) : value);
        }
      });
    } catch {}
    return policy;
  }

  const trustedHtmlPolicy = installTrustedHtmlBridge(window);

  if (!/\/spreadsheets\/d\/[^/]+\/edit/.test(location.pathname)) return;
  if (document.getElementById("sheets-session-probe")) return;

  const MAX_COLUMN = "ZZ";
  const POLL_MS = 250;
  const CODEX_BRIDGE_POLL_MS = 1_500;
  const CACHE_PREFIX = "srd:v1";
  const CACHE_INDEX_KEY = `${CACHE_PREFIX}:index`;
  const WORKSPACE_PREFIX = "srd:workspace:v1";
  const MAX_PERSISTENT_ENTRIES = 120;
  const SHEET_MEMORY_TTL = 5_000;
  const FIELD_TYPES = [
    { value: "text", label: "Texto" },
    { value: "longText", label: "Área de texto" },
    { value: "number", label: "Número" },
    { value: "currency", label: "Monto" },
    { value: "date", label: "Fecha" },
    { value: "datetime", label: "Fecha y hora" },
    { value: "time", label: "Hora" },
    { value: "select", label: "Seleccionar" },
    { value: "multiSelect", label: "Selección múltiple" },
    { value: "status", label: "Estado" },
    { value: "checkbox", label: "Casilla" },
    { value: "url", label: "URL" },
    { value: "phone", label: "Teléfono" },
    { value: "email", label: "Correo electrónico" }
  ];
  const FIELD_TYPE_VALUES = new Set(FIELD_TYPES.map((type) => type.value));
  const OPTION_PALETTE = [
    "#91caff",
    "#87e8de",
    "#b7eb8f",
    "#ffe58f",
    "#ffc069",
    "#ffadd2",
    "#d3adf7",
    "#d9d9d9"
  ];
  const state = {
    row: null,
    gid: null,
    sheetName: "",
    viewRow: null,
    viewGid: null,
    values: [],
    fields: [],
    loading: false,
    saving: false,
    request: null,
    writeRequest: 0,
    lastSelection: "",
    headerCache: new Map(),
    sheetCache: new Map(),
    relationRequest: null,
    persistentFallback: new Map(),
    cacheWriteQueue: Promise.resolve(),
    workspace: null,
    workspacePromise: null,
    workspaceWriteQueue: Promise.resolve(),
    propertyColumn: null,
    pendingWrites: new Map(),
    sheetViewWrites: new Map(),
    relations: [],
    relatedDrafts: new Map(),
    relatedDraftListeners: new Set(),
    relatedDraftVersion: 0,
    activity: { row: false, relations: false, config: false },
    indicatorError: false
  };

  const host = document.createElement("div");
  host.id = "sheets-session-probe";
  host.dataset.status = "starting";
  host.dataset.themeSource = "workspace-antd";
  host.dataset.writeVerification = "idle";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const shellStyles = new CSSStyleSheet();
  shellStyles.replaceSync(`
    :host { all: initial; }
    .panel-frame {
      position: fixed; inset: 0 0 0 auto; z-index: 2147483647;
      width: min(720px, 94vw); height: 100vh; border: 0; background: ${antdTokens.colorBgElevated};
      box-shadow: ${antdTokens.boxShadowSecondary};
      transition: width 180ms cubic-bezier(.2, 0, 0, 1);
    }
    .panel-frame.is-sheet-view-expanded { width: 100vw; }
    .panel-frame[hidden], .reopen[hidden] { display: none; }
    .reopen {
      box-sizing: border-box; position: fixed; z-index: 2147483646;
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; min-width: 40px; min-height: 40px;
      margin: 0; padding: 0; border: 0; border-radius: 50%;
      background: #e6f4ea; color: #0b8043; box-shadow: none;
      cursor: pointer; user-select: none;
      transition: background-color 120ms ease, transform 120ms ease;
    }
    .reopen:hover { background: #ceead6; }
    .reopen:active { transform: scale(.94); }
    .reopen:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
    .reopen svg { display: block; width: 20px; height: 20px; pointer-events: none; }
  `);
  shadow.adoptedStyleSheets = [shellStyles];

  const panelFrame = document.createElement("iframe");
  panelFrame.className = "panel-frame";
  panelFrame.title = "Detalles de la fila";
  panelFrame.hidden = true;
  shadow.appendChild(panelFrame);

  const reopen = document.createElement("button");
  reopen.className = "reopen";
  reopen.type = "button";
  reopen.setAttribute("aria-label", "Abrir formulario de Sheets CRM");
  reopen.title = "Abrir formulario";
  reopen.hidden = true;
  const launcherIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  launcherIcon.setAttribute("viewBox", "0 0 24 24");
  launcherIcon.setAttribute("fill", "none");
  launcherIcon.setAttribute("stroke", "currentColor");
  launcherIcon.setAttribute("stroke-width", "2");
  launcherIcon.setAttribute("stroke-linecap", "round");
  launcherIcon.setAttribute("stroke-linejoin", "round");
  launcherIcon.setAttribute("aria-hidden", "true");
  const launcherRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  launcherRect.setAttribute("x", "5");
  launcherRect.setAttribute("y", "3");
  launcherRect.setAttribute("width", "14");
  launcherRect.setAttribute("height", "18");
  launcherRect.setAttribute("rx", "2");
  launcherIcon.appendChild(launcherRect);
  for (const pathData of ["M8 8h8", "M8 12h8", "M8 16h5"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    launcherIcon.appendChild(path);
  }
  reopen.appendChild(launcherIcon);
  shadow.appendChild(reopen);

  function companionSwitcher() {
    return document.querySelector(".companion-app-switcher-container .companion-guest-app-switcher");
  }

  function companionAddButton(switcher) {
    return Array.from(switcher?.children || []).find((candidate) => {
      const label = String(candidate.getAttribute("aria-label") || "").toLowerCase();
      const icon = candidate.querySelector(".app-switcher-button-icon-container");
      const iconSource = String(icon?.style.backgroundImage || icon?.getAttribute("style") || "").toLowerCase();
      return iconSource.includes("materialicons/add/")
        || iconSource.includes("gm_add_")
        || label.includes("complementos")
        || label.includes("add-ons");
    }) || null;
  }

  const LAUNCHER_SIZE = 40;
  const LAUNCHER_GAP = 8;
  let launcherPositioned = false;
  let launcherAnchor = null;
  let launcherSwitcher = null;
  const launcherResizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => scheduleLauncherPlacement())
    : null;

  function watchLauncherAnchor(switcher, addButton) {
    if (launcherAnchor === addButton && launcherSwitcher === switcher) return;
    launcherResizeObserver?.disconnect();
    launcherAnchor = addButton;
    launcherSwitcher = switcher;
    if (switcher) launcherResizeObserver?.observe(switcher);
    if (addButton && addButton !== switcher) launcherResizeObserver?.observe(addButton);
  }

  function placeLauncher() {
    const switcher = companionSwitcher();
    const addButton = companionAddButton(switcher);
    watchLauncherAnchor(switcher, addButton);
    if (!switcher || !addButton) {
      host.dataset.launcherAnchor = "missing";
      if (!launcherPositioned) reopen.hidden = true;
      return;
    }

    const rect = addButton.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      host.dataset.launcherAnchor = "hidden";
      if (!launcherPositioned) reopen.hidden = true;
      return;
    }

    const maxLeft = Math.max(4, window.innerWidth - LAUNCHER_SIZE - 4);
    const maxTop = Math.max(4, window.innerHeight - LAUNCHER_SIZE - 4);
    const left = Math.min(maxLeft, Math.max(4, rect.left + (rect.width - LAUNCHER_SIZE) / 2));
    const top = Math.min(maxTop, Math.max(4, rect.bottom + LAUNCHER_GAP));
    reopen.style.left = `${Math.round(left)}px`;
    reopen.style.top = `${Math.round(top)}px`;
    launcherPositioned = true;
    reopen.hidden = false;
    host.dataset.launcherAnchor = "ready";
    launcherDiscoveryObserver.disconnect();
  }

  let launcherPlacementFrame = 0;
  function scheduleLauncherPlacement() {
    if (launcherPlacementFrame) return;
    launcherPlacementFrame = requestAnimationFrame(() => {
      launcherPlacementFrame = 0;
      placeLauncher();
    });
  }

  const launcherDiscoveryObserver = new MutationObserver(scheduleLauncherPlacement);
  launcherDiscoveryObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleLauncherPlacement, { passive: true });
  window.addEventListener("scroll", scheduleLauncherPlacement, { capture: true, passive: true });
  scheduleLauncherPlacement();

  const panelDocument = panelFrame.contentDocument;
  installTrustedHtmlBridge(panelFrame.contentWindow);
  panelDocument.documentElement.lang = "es";
  panelDocument.body.replaceChildren();
  const panelStyles = panelDocument.createElement("style");
  panelStyles.textContent = `
    :root {
      color-scheme: light;
      --workspace-bg: ${workspaceTokens.bg};
      --workspace-surface: ${workspaceTokens.surface};
      --workspace-surface-muted: ${workspaceTokens.surfaceMuted};
      --workspace-surface-subtle: ${workspaceTokens.surfaceSubtle};
      --workspace-surface-raised: ${workspaceTokens.surfaceRaised};
      --workspace-border: ${workspaceTokens.border};
      --workspace-border-soft: ${workspaceTokens.borderSoft};
      --workspace-border-subtle: ${workspaceTokens.borderSubtle};
      --workspace-text: ${workspaceTokens.text};
      --workspace-text-body: ${workspaceTokens.textBody};
      --workspace-text-secondary: ${workspaceTokens.textSecondary};
      --workspace-text-muted: ${workspaceTokens.textMuted};
      --workspace-text-disabled: ${workspaceTokens.textDisabled};
      --workspace-primary: ${workspaceTokens.primary};
      --workspace-primary-border: ${workspaceTokens.primaryBorder};
      --workspace-primary-soft: ${workspaceTokens.primarySoft};
      --workspace-primary-hover: ${workspaceTokens.primaryHover};
      --workspace-shadow: ${workspaceTokens.shadow};
      --workspace-shadow-soft: ${workspaceTokens.shadowSoft};
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%; margin: 0; overflow: hidden;
      background: ${antdTokens.colorBgContainer}; color: ${antdTokens.colorText};
      font: ${antdTokens.fontSize}px/${antdTokens.lineHeight} ${antdTokens.fontFamily};
    }
    button, input, textarea, select { font: inherit; }
    .drawer {
      width: 100%; height: 100%; background: ${antdTokens.colorBgContainer}; color: ${antdTokens.colorText};
      border-left: 1px solid ${antdTokens.colorBorder};
      display: flex; flex-direction: column;
    }
    .drawer > header { padding: 16px 24px; border-bottom: 1px solid ${antdTokens.colorBorderSecondary}; }
    .eyebrow { color: ${antdTokens.colorTextTertiary}; font-size: 11px; font-weight: 600; letter-spacing: .08em; }
    .title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .sheet-view-actions { display: inline-flex; align-items: center; gap: 2px; }
    .sheet-view-actions .ant-btn { color: var(--workspace-text-muted); }
    .sheet-view-actions .ant-btn:hover { color: var(--workspace-primary); }
    .drawer h1 { margin: 6px 0 0; color: ${antdTokens.colorTextHeading}; font-size: 18px; line-height: 1.35; }
    .icon-button {
      width: ${antdTokens.controlHeight}px; height: ${antdTokens.controlHeight}px;
      border: 0; border-radius: ${antdTokens.borderRadius}px; background: transparent;
      color: ${antdTokens.colorTextSecondary}; font-size: 20px; cursor: pointer;
    }
    .icon-button:hover { background: ${antdTokens.colorFillTertiary}; color: ${antdTokens.colorText}; }
    .save-state {
      align-items: center; display: inline-flex; width: 28px; height: 28px; justify-content: center;
      font-size: 17px; line-height: 1; transition: color ${antdTokens.motionDurationMid};
    }
    .save-state.is-saving { color: ${antdTokens.colorPrimary}; }
    .save-state.is-saved { color: #22c55e; }
    .save-state.is-error { color: ${antdTokens.colorError}; }
    .save-state-check, .save-state-spinner, .save-state-error { display: none; }
    .save-state.is-saving .save-state-spinner {
      display: block; width: 16px; height: 16px; border: 2px solid currentColor;
      border-right-color: transparent; border-radius: 50%; animation: save-state-spin .8s linear infinite;
    }
    .save-state.is-saved .save-state-check {
      display: inline-flex; animation: save-state-confirm .42s cubic-bezier(.2, .9, .25, 1.35);
    }
    .save-state.is-error .save-state-error { display: inline-flex; font-weight: 800; }
    .save-state svg { display: block; width: 1em; height: 1em; fill: currentColor; }
    @keyframes save-state-spin { to { transform: rotate(360deg); } }
    @keyframes save-state-confirm {
      0% { opacity: 0; transform: scale(.55); }
      65% { opacity: 1; transform: scale(1.18); }
      100% { transform: scale(1); }
    }
    .drawer > main {
      flex: 1; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto;
      padding: 20px 28px 32px; background: var(--workspace-bg);
    }
    .status {
      margin-bottom: 14px; padding: 9px 12px; border: 1px solid ${antdTokens.colorSuccessBorder};
      border-radius: ${antdTokens.borderRadiusLG}px; background: ${antdTokens.colorSuccessBg}; color: ${antdTokens.colorSuccessText};
      font-size: 12px;
    }
    .status.error { border-color: ${antdTokens.colorErrorBorder}; background: ${antdTokens.colorErrorBg}; color: ${antdTokens.colorErrorText}; }
    .status.busy { border-color: ${antdTokens.colorInfoBorder}; background: ${antdTokens.colorInfoBg}; color: ${antdTokens.colorInfoText}; }
    .status[hidden], .related-status[hidden] { display: none; }
    .empty-state {
      min-height: 340px; padding: 64px 20px; display: flex; align-items: center; justify-content: center;
      border: 1px solid var(--workspace-border); border-radius: 8px;
      background: var(--workspace-surface); box-shadow: 0 8px 24px var(--workspace-shadow-soft);
    }
    .empty-state[hidden] { display: none; }
    .empty-state .ant-empty-description { color: var(--workspace-text-muted); }
    .fields {
      min-width: 0; max-width: 100%; overflow: hidden; padding: 4px 14px;
      border: 1px solid var(--workspace-border); border-radius: 8px;
      background: var(--workspace-surface); box-shadow: 0 8px 24px var(--workspace-shadow-soft);
    }
    .field {
      display: grid; grid-template-columns: 190px minmax(0, 1fr); align-items: flex-start; gap: 18px;
      min-height: 57px; padding: 12px 0; border-bottom: 1px solid var(--workspace-border-subtle);
    }
    .field:last-child { border-bottom: 0; }
    .field-label {
      display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: flex-start; gap: 8px;
      min-width: 0; min-height: 32px; padding: 4px 0; color: var(--workspace-text-secondary);
    }
    .field-label-copy { display: grid; gap: 3px; min-width: 0; }
    .field-label-text {
      display: inline-flex; justify-self: start; max-width: 100%; min-width: 0; overflow: hidden;
      border: 0; padding: 0; background: transparent; color: var(--workspace-text-secondary);
      font: inherit; font-size: 13px; font-weight: 700; text-align: left; text-overflow: ellipsis;
      white-space: nowrap; cursor: pointer;
    }
    .field-label-text:hover, .field-label-text:focus-visible { color: var(--workspace-primary); outline: 0; }
    .field-type-name { color: var(--workspace-text-muted); font-size: 11px; line-height: 1.2; }
    .field-configure {
      display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center;
      width: 30px; height: 30px; border: 0; border-radius: 999px;
      background: ${antdTokens.colorPrimaryBg}; color: ${antdTokens.colorPrimary}; cursor: pointer;
      line-height: 1; opacity: 1; transition: color ${antdTokens.motionDurationMid}, background ${antdTokens.motionDurationMid};
    }
    .field-configure svg { display: block; width: 14px; height: 14px; }
    .field-configure:hover, .field-configure:focus-visible { background: ${antdTokens.colorPrimaryBgHover}; color: ${antdTokens.colorPrimaryHover}; }
    .header-type { display: inline-flex; align-items: center; justify-content: center; }
    .field-editor { min-width: 0; padding-top: 0; }
    .antd-field-control { width: 100%; min-width: 0; }
    .antd-field-control > .ant-input-number,
    .antd-field-control > .ant-picker,
    .antd-field-control > .ant-select,
    .antd-field-control > .ant-input,
    .antd-field-control > .ant-space-compact { width: 100%; }
    .fields[aria-busy="true"] { cursor: progress; }
    .property-drawer {
      position: fixed; inset: 0; z-index: 20; display: flex; flex-direction: column;
      background: ${antdTokens.colorBgContainer}; animation: property-enter ${antdTokens.motionDurationMid} ease-out;
    }
    .property-drawer[hidden] { display: none; }
    .property-header {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 16px 24px; border-bottom: 1px solid ${antdTokens.colorBorderSecondary};
    }
    .property-header h2 { margin: 0; font-size: 16px; }
    .property-actions { display: flex; gap: 8px; }
    .secondary-button, .primary-button {
      min-height: ${antdTokens.controlHeight}px; border-radius: ${antdTokens.borderRadius}px;
      padding: 4px 15px; font-weight: 500; cursor: pointer;
    }
    .secondary-button { border: 1px solid ${antdTokens.colorBorder}; background: ${antdTokens.colorBgContainer}; color: ${antdTokens.colorText}; }
    .secondary-button:hover { border-color: ${antdTokens.colorPrimary}; color: ${antdTokens.colorPrimary}; }
    .primary-button { border: 1px solid ${antdTokens.colorPrimary}; background: ${antdTokens.colorPrimary}; color: ${antdTokens.colorWhite}; }
    .primary-button:hover { border-color: ${antdTokens.colorPrimaryHover}; background: ${antdTokens.colorPrimaryHover}; }
    .property-body { flex: 1; overflow: auto; padding: 24px; background: ${antdTokens.colorBgContainer}; }
    .property-form-item { margin-bottom: 22px; }
    .property-form-item > label { display: block; margin-bottom: 8px; color: ${antdTokens.colorText}; font-weight: 600; }
    .property-input {
      width: 100%; min-height: ${antdTokens.controlHeightLG}px; border: 1px solid ${antdTokens.colorBorder};
      border-radius: ${antdTokens.borderRadius}px; padding: 7px 11px; background: ${antdTokens.colorBgContainer};
      color: ${antdTokens.colorText};
    }
    textarea.property-input { min-height: 116px; resize: vertical; line-height: 1.5; }
    .property-input:hover { border-color: ${antdTokens.colorPrimaryHover}; }
    .property-input:focus { border-color: ${antdTokens.colorPrimary}; outline: 0; box-shadow: 0 0 0 ${antdTokens.controlOutlineWidth}px ${antdTokens.controlOutline}; }
    .property-type-host { width: 100%; }
    .property-type-option { display: inline-flex; align-items: center; gap: 8px; }
    .property-type-option-icon {
      display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
      border-radius: 50%; background: ${antdTokens.colorPrimaryBg}; color: ${antdTokens.colorPrimary};
    }
    .property-type-option-icon svg { display: block; width: 14px; height: 14px; }
    .property-help { margin-top: 6px; color: ${antdTokens.colorTextTertiary}; font-size: 12px; }
    .property-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .option-editor { border: 1px solid ${antdTokens.colorBorder}; border-radius: ${antdTokens.borderRadius}px; padding: 10px; }
    .option-editor-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 700;
    }
    .option-row { display: flex; width: 100%; margin-bottom: 8px; }
    .option-row:last-of-type { margin-bottom: 0; }
    .option-row .ant-space-item:nth-child(2) { flex: 1; min-width: 0; }
    .option-row .ant-input { min-width: 0; }
    .color-swatch { display: block; width: 42px; height: 18px; border-radius: 999px; }
    .color-select .ant-select-selection-item {
      display: flex; align-items: center; justify-content: center; padding-inline-end: 0;
    }
    .color-select .ant-select-selection-item-content { display: flex; max-width: none; overflow: visible; }
    .option-tag.ant-tag { margin-inline-end: 0; }
    .property-source {
      margin-bottom: 22px; border-radius: ${antdTokens.borderRadius}px; padding: 10px 12px;
      background: ${antdTokens.colorFillQuaternary}; color: ${antdTokens.colorTextSecondary}; font-size: 12px;
    }
    @keyframes property-enter { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: translateX(0); } }
    .related { min-width: 0; max-width: 100%; margin-top: 14px; }
    .related > h2 { margin: 0 0 10px; color: var(--workspace-text); font-size: 14px; line-height: 22px; }
    .related-status { padding: 3px 0 10px; color: var(--workspace-text-muted); font-size: 12px; }
    .related-list { display: grid; min-width: 0; max-width: 100%; gap: 14px; }
    .relation-host { min-width: 0; max-width: 100%; overflow: hidden; }
    .relation {
      min-width: 0; max-width: 100%; overflow: hidden; padding-bottom: 14px; border: 1px solid var(--workspace-border);
      border-radius: 8px; background: var(--workspace-surface); box-shadow: 0 8px 24px var(--workspace-shadow-soft);
    }
    .relation-head {
      display: flex; align-items: center; justify-content: flex-start; gap: 8px; min-height: 46px;
      padding: 10px 14px; border-bottom: 1px solid var(--workspace-border-soft);
      background: var(--workspace-surface-raised);
    }
    .relation-toggle {
      display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: 0; padding: 0; background: transparent;
      color: var(--workspace-text-muted); cursor: pointer;
    }
    .relation-toggle:hover, .relation-toggle:focus-visible { color: var(--workspace-primary); outline: 0; }
    .relation-heading-copy { display: grid; flex: 1 1 auto; min-width: 0; gap: 2px; }
    .relation-title { overflow: hidden; color: var(--workspace-text); font-size: 14px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .relation-kind { overflow: hidden; color: var(--workspace-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .relation-actions { display: flex; flex: 0 0 auto; align-items: center; justify-content: flex-end; gap: 8px; }
    .relation-actions .ant-segmented { max-width: 100%; }
    .relation-count.ant-tag { min-width: 24px; margin-inline-end: 0; text-align: center; }
    .relation-empty { padding: 18px 14px 4px; color: var(--workspace-text-muted); font-size: 12px; text-align: center; }
    .related-record-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px; padding: 10px 14px 0;
    }
    .related-record-card {
      min-width: 0; border: 1px solid var(--workspace-border); border-radius: 8px; padding: 12px;
      background: var(--workspace-surface); box-shadow: 0 6px 18px var(--workspace-shadow-soft); cursor: pointer;
    }
    .related-record-card:hover, .related-record-card:focus-visible {
      border-color: var(--workspace-primary-border); outline: 0; box-shadow: 0 8px 22px var(--workspace-shadow);
    }
    .related-record-title {
      overflow: hidden; color: var(--workspace-text); font-size: 14px; font-weight: 700;
      text-overflow: ellipsis; white-space: nowrap;
    }
    .related-record-fields { display: grid; gap: 7px; margin-top: 10px; }
    .related-record-field {
      display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center;
      gap: 2px 10px; min-width: 0;
    }
    .property-type-icon {
      display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
      background: ${antdTokens.colorPrimaryBg}; color: ${antdTokens.colorPrimary};
    }
    .related-record-field-icon { grid-row: 1 / span 2; width: 34px; min-height: 34px; }
    .related-record-field-icon svg { width: 12px; height: 12px; }
    .related-record-field > span:not(.property-type-icon) { color: var(--workspace-text-muted); font-size: 11px; }
    .related-record-field strong {
      overflow: hidden; color: var(--workspace-text); font-size: 13px; font-weight: 600;
      text-overflow: ellipsis; white-space: nowrap;
    }
    .related-table-scroll { min-width: 0; max-width: calc(100% - 28px); margin: 10px 14px 0; overflow-x: auto; overflow-y: hidden; }
    .relation-table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; }
    .relation-table th { padding: 8px; border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface-muted); color: var(--workspace-text-secondary); font-weight: 700; text-align: left; white-space: nowrap; }
    .relation-table td { min-width: 180px; padding: 8px; border-bottom: 1px solid var(--workspace-border-subtle); text-align: left; vertical-align: top; }
    .relation-table tr:last-child td { border-bottom: 0; }
    .related-cell-editor { min-width: 0; width: 100%; }
    .related-cell-editor > .ant-input-number,
    .related-cell-editor > .ant-picker,
    .related-cell-editor > .ant-select,
    .related-cell-editor > .ant-input,
    .related-cell-editor > .ant-space-compact { width: 100%; }
    .related-record-drawer-root .ant-drawer-content-wrapper { width: min(720px, 100%) !important; }
    .related-record-drawer .ant-drawer-header { background: var(--workspace-surface); border-bottom-color: var(--workspace-border-soft); }
    .related-record-drawer .ant-drawer-body { padding: 8px 28px 32px; background: var(--workspace-bg); }
    .related-record-drawer .ant-drawer-footer { padding: 12px 24px 16px; background: var(--workspace-surface); border-top-color: var(--workspace-border-soft); }
    .related-record-page { max-width: 760px; margin: 0 auto; }
    .related-drawer-title { margin: 12px 0 22px; color: var(--workspace-text); font-size: 28px; line-height: 1.15; overflow-wrap: anywhere; }
    .related-drawer-fields { width: 100%; }
    .related-field-icon { cursor: default; }
    .related-field-icon:hover { background: ${antdTokens.colorPrimaryBg}; color: ${antdTokens.colorPrimary}; }
    .related-drawer-footer { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; }
    .related-drawer-footer .ant-btn { min-height: ${antdTokens.controlHeightLG}px; font-weight: 600; }
    .relation-pagination { display: flex; justify-content: center; padding: 12px 14px 0; }
    .sheet-view-drawer-root .ant-drawer-content-wrapper { width: min(720px, 100%) !important; }
    .sheet-view-drawer-root.is-expanded .ant-drawer-content-wrapper { width: 100% !important; }
    .sheet-view-drawer .ant-drawer-header { background: var(--workspace-surface); border-bottom-color: var(--workspace-border-soft); }
    .sheet-view-drawer .ant-drawer-body {
      min-width: 0; min-height: 0; overflow: hidden; padding: 0; background: var(--workspace-bg);
    }
    .sheet-view-surface { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; flex-direction: column; }
    .sheet-view-loading, .sheet-view-empty {
      display: flex; flex: 1; min-height: 320px; align-items: center; justify-content: center; padding: 32px;
      background: var(--workspace-surface);
    }
    .view-controls {
      display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px; border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface);
    }
    .view-controls .view-search { width: min(280px, 100%); }
    .kanban-view, .calendar-view { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
    .kanban-board {
      display: grid; flex: 1; min-height: 0; grid-auto-columns: minmax(260px, 1fr); grid-auto-flow: column;
      gap: 12px; overflow: auto; padding: 12px; background: var(--workspace-surface-muted);
    }
    .kanban-column {
      display: flex; min-height: 390px; flex-direction: column; padding: 10px; border: 1px solid var(--workspace-border);
      border-radius: 6px; background: var(--workspace-surface);
    }
    .kanban-column.is-drag-over { border-color: var(--workspace-primary); box-shadow: 0 0 0 2px var(--workspace-primary-soft); }
    .kanban-column-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .kanban-column-title { display: flex; min-width: 0; align-items: center; gap: 6px; color: var(--workspace-text); font-weight: 700; }
    .kanban-column-title .ant-tag { max-width: 190px; margin-inline-end: 0; overflow: hidden; text-overflow: ellipsis; }
    .kanban-count { color: var(--workspace-text-muted); font-size: 12px; }
    .kanban-cards { display: flex; flex-direction: column; gap: 8px; }
    .kanban-card-shell {
      cursor: grab; touch-action: none; user-select: none;
    }
    .kanban-card-shell:active { cursor: grabbing; }
    .kanban-card-shell.is-dragging { opacity: .28; }
    .kanban-card-shell.is-moving { opacity: .55; pointer-events: none; }
    .kanban-card-shell.is-moving:not(.is-dragging) { animation: kanban-card-settle 180ms cubic-bezier(.2, 0, 0, 1); }
    .kanban-card { border-color: var(--workspace-border); background: var(--workspace-surface); transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
    .kanban-card:hover { border-color: var(--workspace-primary-border); box-shadow: 0 8px 22px var(--workspace-shadow); }
    .kanban-card-overlay { cursor: grabbing; animation: kanban-card-lift 140ms cubic-bezier(.2, 0, 0, 1); }
    .kanban-card-overlay .kanban-card {
      border-color: var(--workspace-primary-border); box-shadow: 0 18px 42px rgba(15, 23, 42, .22);
      transform: rotate(.35deg) scale(1.015);
    }
    .kanban-card .ant-card-head { min-height: 38px; padding: 0 10px; }
    .kanban-card .ant-card-head-title { padding: 8px 0; }
    .kanban-card .ant-card-body { padding: 10px; }
    .kanban-card-title { display: flex; min-width: 0; align-items: center; gap: 6px; color: var(--workspace-text); font-weight: 700; }
    .kanban-card-title > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kanban-card-drag { display: inline-flex; color: var(--workspace-text-muted); pointer-events: none; }
    .kanban-field {
      display: grid; min-width: 0; grid-template-columns: auto minmax(0, 1fr); align-items: center;
      gap: 2px 8px; margin-top: 8px;
    }
    .kanban-field .property-type-icon { grid-row: 1 / span 2; width: 28px; min-height: 28px; }
    .kanban-field > span:not(.property-type-icon) { color: var(--workspace-text-muted); font-size: 11px; }
    .kanban-field strong { overflow: hidden; color: var(--workspace-text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
    .kanban-empty-drop {
      display: flex; min-height: 80px; align-items: center; justify-content: center; padding: 12px;
      border: 1px dashed var(--workspace-border-soft); border-radius: 6px; color: var(--workspace-text-muted); font-size: 12px;
    }
    @keyframes kanban-card-lift {
      from { opacity: .75; transform: scale(.97); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes kanban-card-settle {
      from { transform: scale(.98); }
      to { transform: scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .panel-frame, .kanban-card, .kanban-card-overlay, .kanban-card-shell.is-moving { animation: none !important; transition: none !important; }
    }
    .kanban-footer { display: flex; flex: 0 0 auto; justify-content: flex-end; padding: 10px 12px; border-top: 1px solid var(--workspace-border); background: var(--workspace-surface); }
    .month-controls { display: flex; align-items: center; gap: 8px; }
    .month-controls strong { min-width: 140px; color: var(--workspace-text); text-align: center; text-transform: capitalize; }
    .calendar-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; background: var(--workspace-surface); }
    .calendar-grid { display: grid; min-width: 700px; grid-template-columns: repeat(7, minmax(100px, 1fr)); }
    .calendar-weekday {
      position: sticky; z-index: 1; top: 0; padding: 10px; border-right: 1px solid var(--workspace-border);
      border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface-muted);
      color: var(--workspace-text-secondary); font-size: 12px; font-weight: 700; text-align: center;
    }
    .calendar-day { min-height: 116px; padding: 8px; border-right: 1px solid var(--workspace-border); border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface); }
    .calendar-day.is-muted { background: var(--workspace-surface-subtle); color: var(--workspace-text-muted); }
    .calendar-day.is-today .calendar-day-number { background: var(--workspace-primary); color: #fff; }
    .calendar-day-header { display: flex; align-items: center; justify-content: space-between; }
    .calendar-day-number { display: inline-flex; min-width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 999px; font-size: 12px; }
    .calendar-items { display: grid; gap: 6px; margin-top: 8px; }
    .calendar-item {
      width: 100%; overflow: hidden; padding: 5px 7px; border: 1px solid var(--workspace-primary-border);
      border-radius: 5px; background: var(--workspace-primary-soft); color: var(--workspace-text);
      cursor: pointer; font-size: 12px; text-align: left; text-overflow: ellipsis; white-space: nowrap;
    }
    .calendar-item:hover { background: var(--workspace-primary-hover); }
    .workspace-date-picker-popup .ant-picker-panel-container { max-width: calc(100vw - 16px); }
    .drawer > footer { min-width: 0; padding: 12px 24px 16px; border-top: 1px solid ${antdTokens.colorBorderSecondary}; background: ${antdTokens.colorBgContainer}; }
    .meta { margin-bottom: 9px; color: ${antdTokens.colorTextTertiary}; font-size: 11px; }
    .footer-actions { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; }
    .cancel, .save {
      min-height: ${antdTokens.controlHeightLG}px; border-radius: ${antdTokens.borderRadius}px;
      padding: 6px 15px; font-weight: 600; cursor: pointer; transition: color ${antdTokens.motionDurationMid}, border-color ${antdTokens.motionDurationMid}, background ${antdTokens.motionDurationMid};
    }
    .cancel {
      min-width: 112px; border: 1px solid ${antdTokens.colorBorder}; background: ${antdTokens.colorBgContainer};
      color: ${antdTokens.colorText};
    }
    .cancel:hover { border-color: ${antdTokens.colorPrimary}; color: ${antdTokens.colorPrimary}; }
    .save {
      width: 100%; border: 1px solid ${antdTokens.colorPrimary};
      background: ${antdTokens.colorPrimary}; color: ${antdTokens.colorWhite}; box-shadow: ${antdTokens.boxShadowTertiary};
    }
    .save:hover { background: ${antdTokens.colorPrimaryHover}; border-color: ${antdTokens.colorPrimaryHover}; }
    .cancel:disabled, .save:disabled { border-color: ${antdTokens.colorBgContainerDisabled}; background: ${antdTokens.colorBgContainerDisabled}; color: ${antdTokens.colorTextDisabled}; box-shadow: none; cursor: default; }
    @media (max-width: 640px) {
      .drawer > main { padding: 16px 14px 24px; }
      .drawer > header, .drawer > footer { padding-inline: 16px; }
      .field { grid-template-columns: minmax(86px, 34%) minmax(0, 1fr); gap: 10px; }
      .related-record-grid { grid-template-columns: minmax(0, 1fr); padding-inline: 12px; }
      .relation-head { flex-wrap: wrap; padding-inline: 12px; }
      .relation-heading-copy { min-width: calc(100% - 36px); }
      .relation-actions { width: 100%; padding-left: 36px; justify-content: space-between; }
      .related-record-drawer .ant-drawer-body { padding-inline: 14px; }
      .view-controls { align-items: stretch; flex-direction: column; }
      .view-controls .view-search, .view-controls .ant-select { width: 100% !important; }
      .month-controls { justify-content: space-between; }
      .property-header, .property-body { padding-inline: 16px; }
      .property-grid { grid-template-columns: 1fr; gap: 0; }
      .workspace-date-picker-popup {
        top: 50% !important; left: 50% !important; right: auto !important;
        width: auto; transform: translate(-50%, -50%) !important;
      }
      .workspace-date-picker-popup .ant-picker-panel-container {
        max-width: 100%; max-height: calc(100vh - 16px); overflow: auto;
      }
      .workspace-date-picker-popup .ant-picker-panel-layout { width: 100%; }
      .workspace-date-picker-popup .ant-picker-datetime-panel { flex-direction: column; }
    }
    @media (prefers-reduced-motion: reduce) {
      .save-state.is-saving .save-state-spinner, .save-state.is-saved .save-state-check { animation: none; }
    }
  `;
  panelDocument.head.appendChild(panelStyles);

  function element(tag, className, text) {
    const node = panelDocument.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const datePickerLocale = {
    ...esES.DatePicker,
    lang: { ...esES.DatePicker.lang, ok: "OK" }
  };
  const workspaceLocale = { ...esES, DatePicker: datePickerLocale };

  function validOptionColor(value, fallback = "") {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  function propertyOptionEntries(property) {
    return (property.options || []).map((label, index) => ({
      label: String(label),
      color: validOptionColor(property.optionColors?.[label], OPTION_PALETTE[index % OPTION_PALETTE.length])
    }));
  }

  function readableTagTextColor(color) {
    if (!validOptionColor(color)) return undefined;
    const red = parseInt(color.slice(1, 3), 16);
    const green = parseInt(color.slice(3, 5), 16);
    const blue = parseInt(color.slice(5, 7), 16);
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.58 ? "#1f2937" : "#ffffff";
  }

  function optionTag(label, color, extraProps = {}) {
    return React.createElement(Tag, {
      ...extraProps,
      className: `option-tag ${extraProps.className || ""}`.trim(),
      color: validOptionColor(color) || undefined,
      style: {
        borderColor: "transparent",
        ...(validOptionColor(color) ? { color: readableTagTextColor(color) } : {}),
        ...(extraProps.style || {})
      }
    }, label);
  }

  function PropertyOptionsEditor({ property }) {
    const [entries, setEntries] = React.useState(() => propertyOptionEntries(property));
    const updateEntry = (index, patch) => setEntries((current) => current.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, ...patch } : entry
    )));
    const addEntry = () => setEntries((current) => [
      ...current,
      {
        label: `Nueva opción ${current.length + 1}`,
        color: OPTION_PALETTE[current.length % OPTION_PALETTE.length]
      }
    ]);
    const removeEntry = (index) => setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
    const colorOptions = OPTION_PALETTE.map((color) => ({
      value: color,
      label: React.createElement("span", { className: "color-swatch", style: { backgroundColor: color } })
    }));
    const colors = Object.fromEntries(entries.map((entry, index) => [
      entry.label.trim(),
      validOptionColor(entry.color, OPTION_PALETTE[index % OPTION_PALETTE.length])
    ]).filter(([label]) => label));

    return React.createElement(
      "div",
      { className: "option-editor", "data-option-editor": "" },
      React.createElement(
        "div",
        { className: "option-editor-header" },
        React.createElement("span", null, "Opciones"),
        React.createElement(Button, {
          type: "link",
          htmlType: "button",
          icon: React.createElement(PlusOutlined),
          onClick: addEntry
        }, "Agregar")
      ),
      ...entries.map((entry, index) => React.createElement(
        Space,
        { key: index, align: "baseline", className: "option-row", size: 8 },
        React.createElement(Select, {
          className: "color-select",
          popupMatchSelectWidth: false,
          value: entry.color,
          onChange: (color) => updateEntry(index, { color }),
          options: colorOptions,
          style: { width: 82 }
        }),
        React.createElement(Input, {
          value: entry.label,
          placeholder: `Opción ${index + 1}`,
          onChange: (event) => updateEntry(index, { label: event.target.value }),
          style: { flex: 1 }
        }),
        React.createElement(Button, {
          htmlType: "button",
          icon: React.createElement(DeleteOutlined),
          "aria-label": `Eliminar opción ${index + 1}`,
          onClick: () => removeEntry(index)
        })
      )),
      React.createElement("textarea", {
        name: "options",
        value: entries.map((entry) => entry.label).join("\n"),
        readOnly: true,
        hidden: true
      }),
      React.createElement("input", {
        name: "optionColors",
        type: "hidden",
        value: JSON.stringify(colors),
        readOnly: true
      })
    );
  }

  function typeIcon(type, size = 14) {
    const lucideProps = { size, strokeWidth: 2 };
    const icons = {
      text: () => React.createElement(Type, lucideProps),
      longText: () => React.createElement(UnorderedListOutlined),
      number: () => React.createElement(Hash, lucideProps),
      currency: () => React.createElement(CircleDollarSign, lucideProps),
      date: () => React.createElement(CalendarOutlined),
      datetime: () => React.createElement(CalendarOutlined),
      time: () => React.createElement(Clock3, lucideProps),
      select: () => React.createElement(UnorderedListOutlined),
      multiSelect: () => React.createElement(ListChecks, lucideProps),
      status: () => React.createElement(CalculatorOutlined),
      checkbox: () => React.createElement(CheckSquareOutlined),
      url: () => React.createElement(LinkOutlined),
      phone: () => React.createElement(PhoneOutlined),
      email: () => React.createElement(MailOutlined)
    };
    return (icons[type] || icons.text)();
  }

  function typeLabel(type) {
    return FIELD_TYPES.find((fieldType) => fieldType.value === type)?.label || "Texto";
  }

  function typeBadge(type, size = 14) {
    return React.createElement(
      "span",
      { className: "header-type", "aria-label": typeLabel(type), title: typeLabel(type) },
      typeIcon(type, size)
    );
  }

  function antdTree(child) {
    return React.createElement(
      StyleProvider,
      { container: panelDocument.head },
      React.createElement(
        ConfigProvider,
        {
          theme: workspaceThemeConfig,
          locale: workspaceLocale,
          getPopupContainer: () => panelDocument.body
        },
        child
      )
    );
  }

  function renderTypeIcon(button, type) {
    if (!button._iconRoot) button._iconRoot = createRoot(button);
    flushSync(() => button._iconRoot.render(typeBadge(type)));
  }

  function sheetViewRows(table) {
    return (table?.rows || []).filter((row) => row.cells.some((value) => String(value || "").trim()));
  }

  function sheetViewRowTitle(row, columns) {
    const titleColumn = columns.find((column) => column.type === "text" && String(row.cells[column.index] || "").trim())
      || columns.find((column) => String(row.cells[column.index] || "").trim());
    return titleColumn ? String(row.cells[titleColumn.index]).trim() : `Fila ${row.number}`;
  }

  function sheetViewCellLabel(value, property) {
    if (property.type === "checkbox") return checkboxEditorValue(value, property) ? "Sí" : "No";
    return String(value ?? "").trim();
  }

  function SheetViewEmpty({ description }) {
    return React.createElement(
      "div",
      { className: "sheet-view-empty" },
      React.createElement(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description })
    );
  }

  const kanbanCardDragId = (rowNumber) => `sheet-kanban-card:${rowNumber}`;
  const kanbanGroupDropId = (groupId) => `sheet-kanban-group:${groupId}`;

  function kanbanCollisionDetection(args) {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length) return pointerCollisions;
    const intersections = rectIntersection(args);
    return intersections.length ? intersections : closestCorners(args);
  }

  function KanbanCardContent({ columns, row, statusColumn, titleColumn }) {
    const fields = columns.filter((column) => (
      column.index !== statusColumn.index
      && column.index !== titleColumn?.index
      && String(row.cells[column.index] || "").trim()
    )).slice(0, 3);

    return React.createElement(
      Card,
      {
        className: "kanban-card",
        size: "small",
        title: React.createElement(
          "div",
          { className: "kanban-card-title" },
          React.createElement(
            "span",
            { className: "kanban-card-drag", "aria-hidden": "true" },
            React.createElement(DragOutlined)
          ),
          React.createElement("span", null, sheetViewRowTitle(row, columns))
        )
      },
      ...fields.map((column) => React.createElement(
        "div",
        { className: "kanban-field", key: column.id },
        React.createElement("span", { className: "property-type-icon" }, typeBadge(column.type, 12)),
        React.createElement("span", null, column.name),
        React.createElement("strong", null, sheetViewCellLabel(row.cells[column.index], column) || "Sin valor")
      ))
    );
  }

  function SortableKanbanCard({ activeRowNumber, columns, groupId, moving, onOpenRow, row, statusColumn, suppressOpenRef, titleColumn }) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging
    } = useSortable({
      id: kanbanCardDragId(row.number),
      data: { type: "card", row, groupId },
      disabled: moving
    });

    return React.createElement(
      "div",
      {
        ...attributes,
        ...listeners,
        ref: setNodeRef,
        className: ["kanban-card-shell", isDragging || activeRowNumber === row.number ? "is-dragging" : "", moving ? "is-moving" : ""].filter(Boolean).join(" "),
        "data-sheet-row": String(row.number),
        style: { transform: CSS.Transform.toString(transform), transition },
        onClick: () => {
          if (suppressOpenRef.current === row.number) {
            suppressOpenRef.current = null;
            return;
          }
          onOpenRow(row.number);
        },
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") onOpenRow(row.number);
        }
      },
      React.createElement(KanbanCardContent, { columns, row, statusColumn, titleColumn })
    );
  }

  function KanbanColumn({ activeRowNumber, columns, dragOverGroup, group, groupRows, movingRow, onOpenRow, statusColumn, suppressOpenRef, titleColumn, visibleRows }) {
    const { setNodeRef, isOver } = useDroppable({
      id: kanbanGroupDropId(group.id),
      data: { type: "group", groupId: group.id }
    });

    return React.createElement(
      "section",
      {
        ref: setNodeRef,
        className: `kanban-column ${isOver || dragOverGroup === group.id ? "is-drag-over" : ""}`.trim(),
        "data-kanban-group": group.id
      },
      React.createElement(
        "div",
        { className: "kanban-column-header" },
        React.createElement(
          "div",
          { className: "kanban-column-title" },
          group.color ? optionTag(group.label, group.color) : React.createElement("span", null, group.label)
        ),
        React.createElement("span", { className: "kanban-count" }, String(groupRows.length))
      ),
      React.createElement(
        SortableContext,
        { items: visibleRows.map((row) => kanbanCardDragId(row.number)), strategy: verticalListSortingStrategy },
        React.createElement(
          "div",
          { className: "kanban-cards" },
          ...(visibleRows.length ? visibleRows.map((row) => React.createElement(SortableKanbanCard, {
            activeRowNumber,
            columns,
            groupId: group.id,
            key: row.number,
            moving: movingRow === row.number,
            onOpenRow,
            row,
            statusColumn,
            suppressOpenRef,
            titleColumn
          })) : [React.createElement("div", { className: "kanban-empty-drop", key: "empty" }, "Arrastra registros aquí.")])
        )
      )
    );
  }

  function SheetKanban({ table, columns, initialColumnId, movingRow, onColumnChange, onMoveRow, onOpenRow }) {
    const statusColumns = columns.filter((column) => column.type === "status");
    const [columnId, setColumnId] = React.useState(() => (
      statusColumns.some((column) => column.id === initialColumnId) ? initialColumnId : statusColumns[0]?.id || ""
    ));
    const [search, setSearch] = React.useState("");
    const [page, setPage] = React.useState(1);
    const [activeRow, setActiveRow] = React.useState(null);
    const [dragOverGroup, setDragOverGroup] = React.useState("");
    const suppressOpenRef = React.useRef(null);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
    const pageSize = 8;
    const statusColumn = statusColumns.find((column) => column.id === columnId) || statusColumns[0];
    const rows = sheetViewRows(table);

    React.useEffect(() => {
      if (!statusColumns.some((column) => column.id === columnId)) {
        const next = statusColumns[0]?.id || "";
        setColumnId(next);
        if (next) onColumnChange(next);
      }
    }, [columnId, statusColumns.map((column) => column.id).join("|")]);

    React.useEffect(() => setPage(1), [columnId, search]);
    if (!statusColumn) return React.createElement(SheetViewEmpty, { description: "Configura una columna como Estado para usar Kanban" });

    const normalizedSearch = normalizedColumn(search);
    const filteredRows = normalizedSearch
      ? rows.filter((row) => normalizedColumn(row.cells.join(" ")).includes(normalizedSearch))
      : rows;
    const configuredGroups = propertyOptionEntries(statusColumn).map((option) => ({
      id: option.label,
      label: option.label,
      color: option.color
    }));
    const knownGroups = new Set(configuredGroups.map((group) => group.id));
    const inferredGroups = [];
    for (const row of filteredRows) {
      const value = String(row.cells[statusColumn.index] || "").trim();
      if (!value || knownGroups.has(value)) continue;
      knownGroups.add(value);
      inferredGroups.push({ id: value, label: value, color: "" });
    }
    const groups = [
      { id: "__empty__", label: "Sin selección", color: "" },
      ...configuredGroups,
      ...inferredGroups
    ];
    const groupedRows = Object.fromEntries(groups.map((group) => [group.id, []]));
    for (const row of filteredRows) {
      const value = String(row.cells[statusColumn.index] || "").trim();
      const groupId = groupedRows[value] ? value : "__empty__";
      groupedRows[groupId].push(row);
    }
    const longestGroup = Math.max(0, ...Object.values(groupedRows).map((groupRows) => groupRows.length));
    const totalPages = Math.max(1, Math.ceil(longestGroup / pageSize));
    const safePage = Math.min(page, totalPages);
    const titleColumn = columns.find((column) => column.type === "text") || columns[0];

    const selectColumn = (nextColumnId) => {
      setColumnId(nextColumnId);
      onColumnChange(nextColumnId);
    };

    const releaseSuppressedOpen = () => {
      panelDocument.defaultView.setTimeout(() => {
        suppressOpenRef.current = null;
      }, 200);
    };

    const handleDragStart = ({ active }) => {
      const row = active.data.current?.row || null;
      suppressOpenRef.current = row?.number || null;
      setActiveRow(row);
      setDragOverGroup(active.data.current?.groupId || "");
    };

    const handleDragOver = ({ over }) => {
      setDragOverGroup(over?.data.current?.groupId || "");
    };

    const handleDragCancel = () => {
      setActiveRow(null);
      setDragOverGroup("");
      releaseSuppressedOpen();
    };

    const handleDragEnd = ({ active, over }) => {
      const row = active.data.current?.row;
      const groupId = over?.data.current?.groupId || "";
      setActiveRow(null);
      setDragOverGroup("");
      releaseSuppressedOpen();
      if (!row || !groupId) return;
      const group = groups.find((candidate) => candidate.id === groupId);
      if (!group) return;
      const nextValue = group.id === "__empty__" ? "" : group.label;
      if (String(row.cells[statusColumn.index] || "").trim() === nextValue) return;
      void onMoveRow(row, statusColumn, nextValue);
    };

    return React.createElement(
      "div",
      { className: "kanban-view" },
      React.createElement(
        "div",
        { className: "view-controls" },
        React.createElement(Input, {
          allowClear: true,
          className: "view-search",
          prefix: React.createElement(SearchOutlined),
          placeholder: "Buscar",
          value: search,
          onChange: (event) => setSearch(event.target.value)
        }),
        React.createElement(Select, {
          value: statusColumn.id,
          onChange: selectColumn,
          options: statusColumns.map((column) => ({ value: column.id, label: column.name })),
          style: { minWidth: 190 }
        })
      ),
      React.createElement(
        DndContext,
        {
          collisionDetection: kanbanCollisionDetection,
          sensors,
          onDragStart: handleDragStart,
          onDragOver: handleDragOver,
          onDragCancel: handleDragCancel,
          onDragEnd: handleDragEnd
        },
        React.createElement(
          "div",
          { className: "kanban-board" },
          ...groups.map((group) => {
            const groupRows = groupedRows[group.id] || [];
            const visibleRows = groupRows.slice((safePage - 1) * pageSize, safePage * pageSize);
            return React.createElement(KanbanColumn, {
              activeRowNumber: activeRow?.number || null,
              columns,
              dragOverGroup,
              group,
              groupRows,
              key: group.id,
              movingRow,
              onOpenRow,
              statusColumn,
              suppressOpenRef,
              titleColumn,
              visibleRows
            });
          })
        ),
        React.createElement(
          DragOverlay,
          {
            adjustScale: false,
            dropAnimation: { duration: 180, easing: "cubic-bezier(.2, 0, 0, 1)" }
          },
          activeRow
            ? React.createElement(
              "div",
              { className: "kanban-card-shell kanban-card-overlay", "data-drag-overlay": "" },
              React.createElement(KanbanCardContent, {
                columns,
                row: activeRow,
                statusColumn,
                titleColumn
              })
            )
            : null
        )
      ),
      longestGroup > pageSize
        ? React.createElement(
          "div",
          { className: "kanban-footer" },
          React.createElement(Pagination, {
            current: safePage,
            pageSize,
            showSizeChanger: false,
            total: longestGroup,
            onChange: setPage
          })
        )
        : null
    );
  }

  function SheetCalendar({ table, columns, initialColumnId, onColumnChange, onOpenRow }) {
    const dateColumns = columns.filter((column) => column.type === "date");
    const [columnId, setColumnId] = React.useState(() => (
      dateColumns.some((column) => column.id === initialColumnId) ? initialColumnId : dateColumns[0]?.id || ""
    ));
    const [currentMonth, setCurrentMonth] = React.useState(() => dayjs().startOf("month"));
    const dateColumn = dateColumns.find((column) => column.id === columnId) || dateColumns[0];

    React.useEffect(() => {
      if (!dateColumns.some((column) => column.id === columnId)) {
        const next = dateColumns[0]?.id || "";
        setColumnId(next);
        if (next) onColumnChange(next);
      }
    }, [columnId, dateColumns.map((column) => column.id).join("|")]);
    if (!dateColumn) return React.createElement(SheetViewEmpty, { description: "Configura una columna como Fecha para usar Calendario" });

    const start = currentMonth.startOf("month").startOf("week").add(1, "day");
    const end = currentMonth.endOf("month").endOf("week").add(1, "day");
    const days = Array.from({ length: end.diff(start, "day") + 1 }, (_, index) => start.add(index, "day"));
    const rowsByDate = {};
    for (const row of sheetViewRows(table)) {
      const key = dateInputValue(row.cells[dateColumn.index], dateColumn.dateFormat);
      if (!key) continue;
      if (!rowsByDate[key]) rowsByDate[key] = [];
      rowsByDate[key].push(row);
    }
    const selectColumn = (nextColumnId) => {
      setColumnId(nextColumnId);
      onColumnChange(nextColumnId);
    };

    return React.createElement(
      "div",
      { className: "calendar-view" },
      React.createElement(
        "div",
        { className: "view-controls" },
        React.createElement(Select, {
          value: dateColumn.id,
          onChange: selectColumn,
          options: dateColumns.map((column) => ({ value: column.id, label: column.name })),
          style: { minWidth: 220 }
        }),
        React.createElement(
          "div",
          { className: "month-controls" },
          React.createElement(Button, {
            icon: React.createElement(LeftOutlined),
            "aria-label": "Mes anterior",
            onClick: () => setCurrentMonth((month) => month.subtract(1, "month"))
          }),
          React.createElement("strong", null, currentMonth.format("MMMM YYYY")),
          React.createElement(Button, {
            icon: React.createElement(RightOutlined),
            "aria-label": "Mes siguiente",
            onClick: () => setCurrentMonth((month) => month.add(1, "month"))
          })
        )
      ),
      React.createElement(
        "div",
        { className: "calendar-scroll" },
        React.createElement(
          "div",
          { className: "calendar-grid" },
          ...["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => React.createElement(
            "div",
            { className: "calendar-weekday", key: day },
            day
          )),
          ...days.map((day) => {
            const key = day.format("YYYY-MM-DD");
            const rows = rowsByDate[key] || [];
            const className = [
              "calendar-day",
              day.month() !== currentMonth.month() ? "is-muted" : "",
              day.isSame(dayjs(), "day") ? "is-today" : ""
            ].filter(Boolean).join(" ");
            return React.createElement(
              "section",
              { className, key },
              React.createElement(
                "div",
                { className: "calendar-day-header" },
                React.createElement("span", { className: "calendar-day-number" }, String(day.date()))
              ),
              React.createElement(
                "div",
                { className: "calendar-items" },
                ...rows.map((row) => React.createElement(
                  "button",
                  {
                    className: "calendar-item",
                    "data-sheet-row": String(row.number),
                    key: row.number,
                    type: "button",
                    onClick: () => onOpenRow(row.number)
                  },
                  sheetViewRowTitle(row, columns)
                ))
              )
            );
          })
        )
      )
    );
  }

  function SheetViewActions({ sheetKey, sheetName, columns, settings }) {
    const [view, setView] = React.useState("");
    const [table, setTable] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState("");
    const [movingRow, setMovingRow] = React.useState(null);
    const [kanbanExpanded, setKanbanExpanded] = React.useState(() => settings.kanbanExpanded === true);
    const activeSheetKey = React.useRef(sheetKey);
    activeSheetKey.current = sheetKey;
    const statusColumns = columns.filter((column) => column.type === "status");
    const dateColumns = columns.filter((column) => column.type === "date");

    React.useEffect(() => {
      setView("");
      setTable(null);
      setError("");
      setMovingRow(null);
      setKanbanExpanded(settings.kanbanExpanded === true);
    }, [sheetKey]);

    const expandedKanban = view === "kanban" && kanbanExpanded;

    React.useEffect(() => {
      panelFrame.classList.toggle("is-sheet-view-expanded", expandedKanban);
      return () => panelFrame.classList.remove("is-sheet-view-expanded");
    }, [expandedKanban]);

    React.useEffect(() => {
      if (!view) return undefined;
      const controller = new AbortController();
      let active = true;
      setLoading(true);
      setError("");
      setActivity("views", true);
      cachedSheetTable(sheetName, true, controller.signal).then((nextTable) => {
        if (active) setTable(nextTable);
      }).catch((loadError) => {
        if (active && loadError.name !== "AbortError") setError(loadError.message);
      }).finally(() => {
        if (active) {
          setLoading(false);
          setActivity("views", false);
        }
      });
      return () => {
        active = false;
        controller.abort();
        setActivity("views", false);
      };
    }, [view, sheetKey]);

    React.useEffect(() => {
      if (view === "kanban" && !statusColumns.length) setView("");
      if (view === "calendar" && !dateColumns.length) setView("");
    }, [view, statusColumns.length, dateColumns.length]);

    const toggleKanbanExpanded = () => {
      const next = !kanbanExpanded;
      setKanbanExpanded(next);
      setCurrentSheetViewSetting("kanbanExpanded", next);
    };

    const openRow = async (rowNumber) => {
      if (collectPendingChanges().length || state.relatedDrafts.size) {
        setError("Guarda o cancela los cambios pendientes antes de abrir otra fila.");
        return;
      }
      try {
        await focusSheetRange(`A${rowNumber}`);
        setView("");
      } catch (focusError) {
        setError(focusError.message);
      }
    };

    const moveRow = async (row, property, nextValue) => {
      if (movingRow !== null) return;
      if (collectPendingChanges().length || state.relatedDrafts.size) {
        setError("Guarda o cancela los cambios pendientes antes de mover una ficha.");
        return;
      }
      const previousValue = String(row.cells[property.index] || "");
      setMovingRow(row.number);
      setError("");
      setTable((current) => ({
        ...current,
        rows: current.rows.map((item) => item.number === row.number
          ? { ...item, cells: item.cells.map((value, index) => index === property.index ? nextValue : value) }
          : item)
      }));
      try {
        await writeSheetViewValue(row.number, property, nextValue, previousValue, {
          onRevert: () => {
            if (activeSheetKey.current !== sheetKey) return;
            setTable((current) => ({
              ...current,
              rows: current.rows.map((item) => item.number === row.number
                ? { ...item, cells: item.cells.map((value, index) => index === property.index ? previousValue : value) }
                : item)
            }));
          },
          onError: (message) => {
            if (activeSheetKey.current === sheetKey) setError(message);
          }
        });
      } catch (writeError) {
        setTable((current) => ({
          ...current,
          rows: current.rows.map((item) => item.number === row.number
            ? { ...item, cells: item.cells.map((value, index) => index === property.index ? previousValue : value) }
            : item)
        }));
        setError(writeError.message);
      } finally {
        setMovingRow(null);
      }
    };

    const content = loading
      ? React.createElement("div", { className: "sheet-view-loading" }, React.createElement(Spin, { size: "large" }))
      : error && !table
        ? React.createElement(SheetViewEmpty, { description: error })
        : view === "kanban"
          ? React.createElement(SheetKanban, {
            table,
            columns,
            initialColumnId: settings.kanbanColumnId,
            movingRow,
            onColumnChange: (columnId) => setCurrentSheetViewSetting("kanbanColumnId", columnId),
            onMoveRow: moveRow,
            onOpenRow: openRow
          })
          : view === "calendar"
            ? React.createElement(SheetCalendar, {
              table,
              columns,
              initialColumnId: settings.calendarColumnId,
              onColumnChange: (columnId) => setCurrentSheetViewSetting("calendarColumnId", columnId),
              onOpenRow: openRow
            })
            : null;

    return React.createElement(
      React.Fragment,
      null,
      statusColumns.length ? React.createElement(Button, {
        type: "text",
        shape: "circle",
        size: "small",
        icon: React.createElement(AppstoreOutlined),
        title: "Abrir vista Kanban",
        "aria-label": "Abrir vista Kanban",
        "data-sheet-view": "kanban",
        onClick: () => setView("kanban")
      }) : null,
      dateColumns.length ? React.createElement(Button, {
        type: "text",
        shape: "circle",
        size: "small",
        icon: React.createElement(CalendarOutlined),
        title: "Abrir vista Calendario",
        "aria-label": "Abrir vista Calendario",
        "data-sheet-view": "calendar",
        onClick: () => setView("calendar")
      }) : null,
      React.createElement(
        Drawer,
        {
          open: Boolean(view),
          onClose: () => setView(""),
          width: expandedKanban ? "100%" : 720,
          destroyOnClose: true,
          className: "sheet-view-drawer",
          rootClassName: `sheet-view-drawer-root ${expandedKanban ? "is-expanded" : ""}`.trim(),
          getContainer: () => panelDocument.body,
          title: `${view === "kanban" ? "Kanban" : "Calendario"} · ${sheetName}`,
          extra: view === "kanban" ? React.createElement(Button, {
            type: "default",
            shape: "circle",
            size: "small",
            icon: React.createElement(expandedKanban ? FullscreenExitOutlined : FullscreenOutlined),
            title: expandedKanban ? "Restaurar" : "Ampliar",
            "aria-label": expandedKanban ? "Restaurar" : "Ampliar",
            "data-kanban-expand": expandedKanban ? "expanded" : "compact",
            onClick: toggleKanbanExpanded
          }) : null
        },
        React.createElement(
          "div",
          { className: "sheet-view-surface", "data-active-sheet-view": view },
          error && table ? React.createElement("div", { className: "status error" }, error) : null,
          content
        )
      )
    );
  }

  function renderSheetViewActions() {
    if (!ui.sheetViewActions?._reactRoot) return;
    const sheet = currentSheetConfiguration();
    const columns = (sheet?.columns || []).filter((column) => String(column.sourceHeader || "").trim());
    flushSync(() => ui.sheetViewActions._reactRoot.render(antdTree(React.createElement(SheetViewActions, {
      sheetKey: `${currentGid()}:${sheet?.updatedAt || 0}`,
      sheetName: sheet?.name || activeSheetName() || `Hoja ${currentGid()}`,
      columns,
      settings: { ...currentSheetViewSettings() }
    }))));
  }

  function updateAntdControl(host, property, nextValue, refresh) {
    host._editorValue = nextValue;
    host._value = serializeEditorValue(nextValue, property);
    host.dataset.serializedValue = host._value;
    refresh();
    syncPendingActions();
  }

  class FieldErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
      return { error };
    }

    componentDidCatch(error) {
      this.props.host.dataset.renderError = error?.message || String(error);
    }

    render() {
      if (this.state.error) return React.createElement("span", { className: "field-render-error" }, "No se pudo mostrar este campo");
      return this.props.children;
    }
  }

  function PropertyEditorControl({ property, value, onChange }) {
    const update = onChange;
    const fullWidth = { width: "100%" };

    if (property.type === "longText") {
      return React.createElement(Input.TextArea, {
        value: String(value ?? ""),
        autoSize: { minRows: 2, maxRows: 6 },
        onChange: (event) => update(event.target.value)
      });
    }

    if (property.type === "number") {
      return React.createElement(InputNumber, {
        value: value === "" ? null : value,
        controls: true,
        onChange: update,
        style: fullWidth
      });
    }

    if (property.type === "currency") {
      return React.createElement(InputNumber, {
        value: value === "" ? null : value,
        prefix: property.currencySymbol || "$",
        precision: Number(property.currencyDecimals ?? 2),
        controls: true,
        onChange: update,
        style: fullWidth
      });
    }

    if (["select", "status"].includes(property.type)) {
      const entries = propertyOptionEntries(property);
      if (value && !entries.some((entry) => entry.label === String(value))) {
        entries.push({ label: String(value), color: "" });
      }
      return React.createElement(Select, {
        allowClear: true,
        value: value || undefined,
        onChange: (nextValue) => update(nextValue || ""),
        options: entries.map((entry) => ({
          value: entry.label,
          title: entry.label,
          label: optionTag(entry.label, entry.color)
        })),
        style: fullWidth
      });
    }

    if (property.type === "multiSelect") {
      const selected = Array.isArray(value) ? value : [];
      const entries = propertyOptionEntries(property);
      for (const selectedValue of selected) {
        if (!entries.some((entry) => entry.label === selectedValue)) entries.push({ label: selectedValue, color: "" });
      }
      return React.createElement(Select, {
        mode: "multiple",
        allowClear: true,
        value: selected,
        onChange: update,
        options: entries.map((entry) => ({ value: entry.label, label: entry.label, title: entry.label })),
        tagRender: ({ value: selectedValue, label, closable, onClose }) => {
          const entry = entries.find((item) => item.label === selectedValue);
          return optionTag(label || selectedValue, entry?.color, { closable, onClose });
        },
        style: fullWidth
      });
    }

    if (["date", "datetime"].includes(property.type)) {
      const usesTime = property.type === "datetime";
      const uses12Hours = property.timeFormat === "12";
      const timeFormat = uses12Hours ? "h:mm A" : "HH:mm";
      const format = usesTime ? `${property.dateFormat} ${timeFormat}` : property.dateFormat;
      const pickerValue = value && dayjs(value).isValid() ? dayjs(value) : null;
      return React.createElement(DatePicker, {
        value: pickerValue,
        locale: datePickerLocale,
        popupClassName: "workspace-date-picker-popup",
        placement: "bottomRight",
        showTime: usesTime ? { format: timeFormat, use12Hours: uses12Hours } : false,
        format,
        onChange: (date) => update(date ? date.format(usesTime ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD") : ""),
        style: fullWidth
      });
    }

    if (property.type === "time") {
      const uses12Hours = property.timeFormat === "12";
      const timeFormat = uses12Hours ? "h:mm A" : "HH:mm";
      const pickerValue = value && dayjs(`2000-01-01T${value}`).isValid() ? dayjs(`2000-01-01T${value}`) : null;
      return React.createElement(TimePicker, {
        value: pickerValue,
        locale: datePickerLocale,
        format: timeFormat,
        use12Hours: uses12Hours,
        onChange: (time) => update(time ? time.format("HH:mm") : ""),
        style: fullWidth
      });
    }

    if (property.type === "checkbox") {
      return React.createElement(Checkbox, {
        checked: Boolean(value),
        onChange: (event) => update(event.target.checked)
      });
    }

    const textValue = String(value ?? "");
    const input = React.createElement(Input, {
      value: textValue,
      type: property.type === "email" ? "email" : property.type === "phone" ? "tel" : "text",
      placeholder: property.type === "url" ? "https://" : property.type === "email" ? "correo@dominio.com" : property.type === "phone" ? "+506" : undefined,
      onChange: (event) => update(event.target.value)
    });

    if (!["url", "phone", "email"].includes(property.type)) return input;
    const action = {
      url: { label: "Abrir", icon: React.createElement(LinkOutlined), href: /^https?:\/\//i.test(textValue) ? textValue : `https://${textValue}` },
      phone: { label: "Llamar", icon: React.createElement(PhoneOutlined), href: `tel:${textValue}` },
      email: { label: "Enviar", icon: React.createElement(MailOutlined), href: `mailto:${textValue}` }
    }[property.type];
    return React.createElement(
      Space.Compact,
      { block: true },
      input,
      React.createElement(Button, {
        disabled: !textValue.trim(),
        icon: action.icon,
        onClick: () => panelFrame.contentWindow.open(action.href, property.type === "url" ? "_blank" : "_self", "noopener,noreferrer")
      }, action.label)
    );
  }

  function AntFieldControl({ host, property }) {
    const [, refresh] = React.useReducer((value) => value + 1, 0);
    return React.createElement(PropertyEditorControl, {
      property,
      value: host._editorValue,
      onChange: (nextValue) => updateAntdControl(host, property, nextValue, refresh)
    });
  }

  const drawer = element("aside", "drawer");
  drawer.setAttribute("aria-label", "Detalles de la fila");
  const panelHeader = element("header");
  const eyebrow = element("div", "eyebrow", "PRUEBA LOCAL · SESIÓN DE GOOGLE");
  const titleRow = element("div", "title-row");
  const title = element("h1", "", "Detalles de la fila");
  const headerActions = element("div", "header-actions");
  const sheetViewActions = element("div", "sheet-view-actions");
  const saveState = element("span", "save-state is-saving");
  saveState.title = "Cargando";
  saveState.setAttribute("role", "status");
  saveState.setAttribute("aria-label", "Cargando");
  saveState.setAttribute("aria-live", "polite");
  const saveStateSpinner = element("span", "save-state-spinner");
  saveStateSpinner.setAttribute("aria-hidden", "true");
  const saveStateCheck = element("span", "anticon anticon-check-circle save-state-check");
  saveStateCheck.setAttribute("aria-hidden", "true");
  const svgNamespace = "http://www.w3.org/2000/svg";
  const checkSvg = panelDocument.createElementNS(svgNamespace, "svg");
  checkSvg.setAttribute("viewBox", "64 64 896 896");
  checkSvg.setAttribute("focusable", "false");
  checkSvg.setAttribute("data-icon", "check-circle");
  checkSvg.setAttribute("width", "1em");
  checkSvg.setAttribute("height", "1em");
  checkSvg.setAttribute("fill", "currentColor");
  for (const pathData of [
    "M699 353h-46.9c-10.2 0-19.9 4.9-25.9 13.3L469 584.3l-71.2-98.8c-6-8.3-15.6-13.3-25.9-13.3H325c-6.5 0-10.3 7.4-6.5 12.7l124.6 172.8a31.8 31.8 0 0051.7 0l210.6-292c3.9-5.3.1-12.7-6.4-12.7z",
    "M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z"
  ]) {
    const path = panelDocument.createElementNS(svgNamespace, "path");
    path.setAttribute("d", pathData);
    checkSvg.appendChild(path);
  }
  saveStateCheck.appendChild(checkSvg);
  const saveStateError = element("span", "save-state-error", "!");
  saveStateError.setAttribute("aria-hidden", "true");
  saveState.append(saveStateSpinner, saveStateCheck, saveStateError);
  const close = element("button", "icon-button close", "×");
  close.type = "button";
  close.title = "Cerrar";
  close.setAttribute("aria-label", "Cerrar");
  headerActions.append(sheetViewActions, saveState, close);
  titleRow.append(title, headerActions);
  panelHeader.append(eyebrow, titleRow);

  const main = element("main");
  const status = element("div", "status busy", "Esperando una celda…");
  status.hidden = true;
  const emptyState = element("div", "empty-state");
  emptyState.hidden = true;
  emptyState.setAttribute("role", "status");
  emptyState.setAttribute("aria-live", "polite");
  const fields = element("div", "fields");
  const related = element("section", "related");
  const relatedTitle = element("h2", "", "Relacionados");
  const relatedStatus = element("div", "related-status", "Selecciona una fila para buscar relaciones.");
  const relatedList = element("div", "related-list");
  related.append(relatedTitle, relatedStatus, relatedList);
  main.append(status, emptyState, fields, related);

  const footer = element("footer");
  const meta = element("div", "meta", "Sin fila seleccionada");
  const footerActions = element("div", "footer-actions");
  const cancel = element("button", "cancel", "Cancelar");
  cancel.type = "button";
  cancel.disabled = true;
  const save = element("button", "save", "Guardar cambios");
  save.type = "button";
  save.disabled = true;
  footerActions.append(cancel, save);
  footer.append(meta, footerActions);
  drawer.append(panelHeader, main, footer);

  const propertyDrawer = element("section", "property-drawer");
  propertyDrawer.hidden = true;
  propertyDrawer.setAttribute("aria-label", "Editar propiedad");
  const propertyHeader = element("div", "property-header");
  const propertyTitle = element("h2", "", "Editar propiedad");
  const propertyActions = element("div", "property-actions");
  const propertyCancel = element("button", "secondary-button", "Cancelar");
  propertyCancel.type = "button";
  const propertySave = element("button", "primary-button", "Guardar");
  propertySave.type = "submit";
  propertySave.setAttribute("form", "srd-property-form");
  propertyActions.append(propertyCancel, propertySave);
  propertyHeader.append(propertyTitle, propertyActions);
  const propertyBody = element("div", "property-body");
  const propertyForm = element("form");
  propertyForm.id = "srd-property-form";
  const propertySource = element("div", "property-source");
  const propertyNameItem = element("div", "property-form-item");
  const propertyNameLabel = element("label", "", "Nombre");
  propertyNameLabel.htmlFor = "srd-property-name";
  const propertyName = element("input", "property-input");
  propertyName.id = "srd-property-name";
  propertyName.name = "name";
  propertyName.required = true;
  propertyName.autocomplete = "off";
  propertyNameItem.append(propertyNameLabel, propertyName);
  const propertyTypeItem = element("div", "property-form-item");
  const propertyTypeLabel = element("label", "", "Tipo");
  propertyTypeLabel.htmlFor = "srd-property-type-select";
  const propertyType = element("input");
  propertyType.id = "srd-property-type";
  propertyType.name = "type";
  propertyType.type = "hidden";
  const propertyTypeHost = element("div", "property-type-host");
  propertyTypeHost.id = "srd-property-type-select";
  propertyTypeItem.append(propertyTypeLabel, propertyType, propertyTypeHost);
  const propertySettings = element("div", "property-settings");
  propertyForm.append(propertySource, propertyNameItem, propertyTypeItem, propertySettings);
  propertyBody.appendChild(propertyForm);
  propertyDrawer.append(propertyHeader, propertyBody);
  panelDocument.body.append(drawer, propertyDrawer);

  const ui = {
    frame: panelFrame,
    drawer,
    close,
    reopen,
    sheetViewActions,
    saveState,
    status,
    emptyState,
    fields,
    related,
    relatedStatus,
    relatedList,
    meta,
    cancel,
    save,
    propertyDrawer,
    propertyForm,
    propertySource,
    propertyName,
    propertyType,
    propertyTypeHost,
    propertySettings,
    propertyCancel,
    propertySave
  };

  emptyState._reactRoot = createRoot(emptyState);
  flushSync(() => emptyState._reactRoot.render(antdTree(
    React.createElement(Empty, {
      image: Empty.PRESENTED_IMAGE_SIMPLE,
      description: "Nada para mostrar"
    })
  )));
  sheetViewActions._reactRoot = createRoot(sheetViewActions);

  ui.close.addEventListener("click", () => {
    ui.frame.hidden = true;
  });
  ui.reopen.addEventListener("click", () => {
    ui.frame.hidden = false;
  });
  ui.cancel.addEventListener("click", cancelChanges);
  ui.save.addEventListener("click", saveChanges);
  ui.propertyCancel.addEventListener("click", closePropertyEditor);
  ui.propertyType.addEventListener("change", () => {
    renderPropertyTypeSelect();
    renderPropertySettings();
  });
  ui.propertyForm.addEventListener("submit", savePropertyConfiguration);

  function spreadsheetId() {
    return location.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] || "";
  }

  function currentGid() {
    const searchGid = new URLSearchParams(location.search).get("gid");
    const hashGid = new URLSearchParams(location.hash.slice(1)).get("gid");
    return hashGid || searchGid || "0";
  }

  function activeSheetName() {
    return document.querySelector(".docs-sheet-active-tab .docs-sheet-tab-name")?.textContent.trim() || "";
  }

  function visibleSheetNames() {
    return Array.from(document.querySelectorAll(".docs-sheet-tab-name"), (tab) => tab.textContent.trim())
      .filter((name, index, names) => name && names.indexOf(name) === index);
  }

  function selectedRow(reference) {
    const ref = String(reference || "").trim().split("!").pop().replace(/\$/g, "");
    const rowRange = ref.match(/^(\d+):(\d+)$/);
    if (rowRange) return Number(rowRange[1]);
    const cell = ref.match(/[A-Z]+(\d+)/i);
    return cell ? Number(cell[1]) : null;
  }

  function nameBoxValue() {
    const box = document.getElementById("t-name-box");
    return box ? String(box.value || box.textContent || "").trim() : "";
  }

  function columnName(index) {
    let value = index;
    let result = "";
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  function normalizedWords(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function normalizedColumn(value) {
    return normalizedWords(value).join("");
  }

  function entityNames(sheetName) {
    const words = normalizedWords(sheetName);
    const candidates = [];
    for (const word of [...words, words.join("")]) {
      if (!word) continue;
      candidates.push(word);
      if (word.endsWith("s") && word.length > 2) candidates.push(word.slice(0, -1));
      if (word.endsWith("es") && word.length > 3) candidates.push(word.slice(0, -2));
    }
    return [...new Set(candidates)];
  }

  function primaryKeyIndex(sheetName, headers) {
    const normalized = headers.map(normalizedColumn);
    for (const entity of entityNames(sheetName)) {
      const index = normalized.findIndex((header) => header === `id${entity}` || header === `${entity}id`);
      if (index >= 0) return index;
    }
    const plainId = normalized.indexOf("id");
    if (plainId >= 0) return plainId;
    return normalized.findIndex((header) => /^id[a-z0-9]+$/.test(header));
  }

  function matchingColumn(headers, targetHeader) {
    const target = normalizedColumn(targetHeader);
    return headers.findIndex((header) => normalizedColumn(header) === target);
  }

  function comparable(value) {
    return String(value ?? "").trim();
  }

  function normalizedCheckboxConfiguredValue(value, checked) {
    const fallback = checked ? "TRUE" : "FALSE";
    const text = comparable(value) || fallback;
    const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    if (checked && ["TRUE", "VERDADERO"].includes(normalized)) return "TRUE";
    if (!checked && ["FALSE", "FALSO"].includes(normalized)) return "FALSE";
    return text;
  }

  function cacheKey(kind, gid, row) {
    return `${CACHE_PREFIX}:${kind}:${encodeURIComponent(spreadsheetId())}:${encodeURIComponent(gid)}:${row}`;
  }

  function workspaceKey() {
    return `${WORKSPACE_PREFIX}:${encodeURIComponent(spreadsheetId())}`;
  }

  function storageArea() {
    try {
      return globalThis.chrome?.storage?.local || null;
    } catch {
      return null;
    }
  }

  async function readPersistentCache(key) {
    if (state.persistentFallback.has(key)) return state.persistentFallback.get(key);
    const area = storageArea();
    if (!area) return null;
    try {
      const result = await area.get(key);
      const value = result[key] || null;
      if (value) state.persistentFallback.set(key, value);
      return value;
    } catch {
      return null;
    }
  }

  function writePersistentCache(key, value) {
    state.persistentFallback.set(key, value);
    const area = storageArea();
    if (!area) return Promise.resolve();

    state.cacheWriteQueue = state.cacheWriteQueue.then(async () => {
      const stored = await area.get(CACHE_INDEX_KEY);
      const previous = Array.isArray(stored[CACHE_INDEX_KEY]) ? stored[CACHE_INDEX_KEY] : [];
      const index = [key, ...previous.filter((item) => item !== key)];
      const expired = index.splice(MAX_PERSISTENT_ENTRIES);
      await area.set({ [key]: value, [CACHE_INDEX_KEY]: index });
      if (expired.length) await area.remove(expired);
    }).catch(() => {});
    return state.cacheWriteQueue;
  }

  function createWorkspace() {
    return {
      version: 1,
      spreadsheetId: spreadsheetId(),
      sheets: {},
      relationViews: {},
      sheetViews: {},
      updatedAt: Date.now()
    };
  }

  function defaultProperty(index, header = "") {
    return {
      id: `column-${index + 1}`,
      index,
      sourceHeader: header,
      name: header || `Columna ${columnName(index + 1)}`,
      customName: false,
      type: "text",
      options: [],
      optionColors: {},
      currencySymbol: "$",
      currencyDecimals: 2,
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24",
      checkedValue: "TRUE",
      uncheckedValue: "FALSE"
    };
  }

  function normalizeProperty(property, index, header = "") {
    const fallback = defaultProperty(index, header);
    const source = property && typeof property === "object" ? property : {};
    const options = [];
    const optionColors = {};
    for (const [optionIndex, rawOption] of (Array.isArray(source.options) ? source.options : []).entries()) {
      const label = String(typeof rawOption === "string" ? rawOption : rawOption?.label || rawOption?.value || "").trim();
      if (!label || options.includes(label)) continue;
      options.push(label);
      optionColors[label] = validOptionColor(
        typeof rawOption === "object" ? rawOption?.color : source.optionColors?.[label],
        OPTION_PALETTE[optionIndex % OPTION_PALETTE.length]
      );
    }
    return {
      ...fallback,
      ...source,
      id: String(source.id || fallback.id),
      index,
      sourceHeader: String(header || source.sourceHeader || ""),
      name: String(source.name || header || fallback.name),
      customName: Boolean(source.customName),
      type: FIELD_TYPE_VALUES.has(source.type) ? source.type : "text",
      options,
      optionColors,
      currencySymbol: String(source.currencySymbol || "$"),
      currencyDecimals: Math.min(6, Math.max(0, Number(source.currencyDecimals ?? 2) || 0)),
      dateFormat: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(source.dateFormat)
        ? source.dateFormat
        : "DD/MM/YYYY",
      timeFormat: source.timeFormat === "12" ? "12" : "24",
      checkedValue: normalizedCheckboxConfiguredValue(source.checkedValue, true),
      uncheckedValue: normalizedCheckboxConfiguredValue(source.uncheckedValue, false)
    };
  }

  function normalizeWorkspace(workspace) {
    const clean = createWorkspace();
    if (!workspace || typeof workspace !== "object") return clean;
    clean.updatedAt = Number(workspace.updatedAt || Date.now());
    for (const [key, view] of Object.entries(workspace.relationViews || {})) {
      if (view === "deck" || view === "table") clean.relationViews[String(key)] = view;
    }
    for (const [key, view] of Object.entries(workspace.sheetViews || {})) {
      if (!view || typeof view !== "object") continue;
      clean.sheetViews[String(key)] = {
        calendarColumnId: String(view.calendarColumnId || ""),
        kanbanColumnId: String(view.kanbanColumnId || ""),
        kanbanExpanded: view.kanbanExpanded === true
      };
    }
    for (const [gid, sheet] of Object.entries(workspace.sheets || {})) {
      if (!sheet || typeof sheet !== "object") continue;
      const columns = Array.isArray(sheet.columns)
        ? sheet.columns.map((column, index) => normalizeProperty(column, index, column?.sourceHeader || ""))
        : [];
      clean.sheets[String(gid)] = {
        name: String(sheet.name || ""),
        columns,
        updatedAt: Number(sheet.updatedAt || clean.updatedAt)
      };
    }
    return clean;
  }

  async function ensureWorkspaceLoaded() {
    if (state.workspace) return state.workspace;
    if (state.workspacePromise) return state.workspacePromise;
    state.workspacePromise = (async () => {
      const area = storageArea();
      if (!area) {
        state.workspace = createWorkspace();
        return state.workspace;
      }
      try {
        const key = workspaceKey();
        const result = await area.get(key);
        state.workspace = normalizeWorkspace(result[key]);
      } catch {
        state.workspace = createWorkspace();
      }
      return state.workspace;
    })();
    return state.workspacePromise;
  }

  function writeWorkspace() {
    if (!state.workspace) return Promise.resolve();
    state.workspace.updatedAt = Date.now();
    const area = storageArea();
    if (!area) return Promise.resolve();
    const key = workspaceKey();
    state.workspaceWriteQueue = state.workspaceWriteQueue
      .then(() => area.set({ [key]: state.workspace }))
      .catch(() => {});
    return state.workspaceWriteQueue;
  }

  function reconcileSheetConfiguration(gid, sheetName, headers) {
    if (!state.workspace) state.workspace = createWorkspace();
    const key = String(gid);
    const previous = state.workspace.sheets[key];
    const available = [...(previous?.columns || [])];
    const used = new Set();
    const columns = headers.map((header, index) => {
      const cleanHeader = String(header || "");
      const matchingHeader = available.findIndex((column, candidateIndex) =>
        !used.has(candidateIndex) && cleanHeader && normalizedColumn(column.sourceHeader) === normalizedColumn(cleanHeader)
      );
      const samePosition = available.findIndex((column, candidateIndex) =>
        !used.has(candidateIndex) && Number(column.index) === index
      );
      const candidateIndex = matchingHeader >= 0 ? matchingHeader : samePosition;
      if (candidateIndex < 0) return defaultProperty(index, cleanHeader);
      used.add(candidateIndex);
      const candidate = available[candidateIndex];
      const normalized = normalizeProperty(candidate, index, cleanHeader);
      if (!normalized.customName) normalized.name = cleanHeader || defaultProperty(index).name;
      return normalized;
    });
    const changed = !previous || previous.name !== sheetName || !sameValues(previous.columns, columns);
    const next = {
      name: sheetName,
      columns,
      updatedAt: changed ? Date.now() : Number(previous.updatedAt || Date.now())
    };
    state.workspace.sheets[key] = next;
    if (changed) void writeWorkspace();
    return next;
  }

  function currentSheetConfiguration() {
    return state.workspace?.sheets?.[String(currentGid())] || null;
  }

  function currentSheetViewSettings() {
    return state.workspace?.sheetViews?.[String(currentGid())] || {};
  }

  function setCurrentSheetViewSetting(name, value) {
    if (!state.workspace) state.workspace = createWorkspace();
    if (!state.workspace.sheetViews) state.workspace.sheetViews = {};
    const key = String(currentGid());
    const previous = state.workspace.sheetViews[key] || {};
    if (previous[name] === value) return;
    state.workspace.sheetViews[key] = {
      ...previous,
      [name]: typeof value === "boolean" ? value : String(value || "")
    };
    void writeWorkspace();
  }

  function sheetConfigurationByName(sheetName) {
    const target = normalizedColumn(sheetName);
    return Object.values(state.workspace?.sheets || {}).find((sheet) => normalizedColumn(sheet.name) === target) || null;
  }

  function relationViewKey(sheetName) {
    return `${currentGid()}:${normalizedColumn(sheetName)}`;
  }

  function relationView(sheetName) {
    return state.workspace?.relationViews?.[relationViewKey(sheetName)] === "table" ? "table" : "deck";
  }

  function setRelationView(sheetName, view) {
    if (view !== "deck" && view !== "table") return;
    if (!state.workspace) state.workspace = createWorkspace();
    if (!state.workspace.relationViews) state.workspace.relationViews = {};
    const key = relationViewKey(sheetName);
    if (state.workspace.relationViews[key] === view) return;
    state.workspace.relationViews[key] = view;
    void writeWorkspace();
  }

  function propertyForColumn(index) {
    return currentSheetConfiguration()?.columns?.[index] || defaultProperty(index, state.fields[index] || "");
  }

  function sameValues(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function syncSaveState() {
    let mode = "saved";
    let label = "Guardado";
    if (state.indicatorError) {
      mode = "error";
      label = "Error";
    } else if (state.saving || Object.values(state.activity).some(Boolean)) {
      mode = "saving";
      label = state.saving ? "Guardando" : "Actualizando";
    }
    ui.saveState.className = `save-state is-${mode}`;
    ui.saveState.title = label;
    ui.saveState.setAttribute("aria-label", label);
    host.dataset.saveState = mode;
  }

  function setActivity(name, active) {
    state.activity[name] = active;
    syncSaveState();
  }

  function setStatus(message, kind = "ok") {
    ui.status.textContent = message;
    ui.status.className = `status ${kind === "ok" ? "" : kind}`.trim();
    ui.status.hidden = kind !== "error";
    state.indicatorError = kind === "error";
    host.dataset.status = kind;
    syncSaveState();
  }

  function embedUrl(range, gid = currentGid()) {
    const url = new URL(`/spreadsheets/d/${spreadsheetId()}/htmlembed/sheet`, location.origin);
    url.searchParams.set("gid", gid);
    url.searchParams.set("range", range);
    url.searchParams.set("_", Date.now().toString());
    return url;
  }

  function booleanMarker(value) {
    const normalized = String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
    if (!normalized) return null;
    if (["TRUE", "VERDADERO", "YES", "SI", "CHECKED", "MARCADO", "MARCADA", "ACTIVADO", "ACTIVADA", "ON"].includes(normalized)) return true;
    if (["FALSE", "FALSO", "NO", "UNCHECKED", "DESMARCADO", "DESMARCADA", "DESACTIVADO", "DESACTIVADA", "OFF"].includes(normalized)) return false;
    if (/\b(UNCHECKED|DESMARCADA?|DESACTIVADA?|FALSE|FALSO|OFF)\b/.test(normalized)) return false;
    if (/\b(CHECKED|MARCADA?|ACTIVADA?|TRUE|VERDADERO|ON)\b/.test(normalized)) return true;
    return null;
  }

  function booleanFromStructuredValue(rawValue) {
    const direct = booleanMarker(rawValue);
    if (direct !== null) return direct;
    try {
      const parsed = JSON.parse(rawValue);
      const pending = [parsed];
      while (pending.length) {
        const value = pending.shift();
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
          const marker = booleanMarker(value);
          if (marker !== null) return marker;
        } else if (value && typeof value === "object") {
          pending.push(...Object.values(value));
        }
      }
    } catch {}
    return null;
  }

  function checkboxStateFromCell(cell) {
    const input = cell.querySelector('input[type="checkbox"]');
    if (input) return input.checked || input.hasAttribute("checked");

    for (const use of cell.querySelectorAll("svg use")) {
      const reference = use.getAttribute("href")
        || use.getAttribute("xlink:href")
        || use.getAttributeNS("http://www.w3.org/1999/xlink", "href")
        || "";
      const symbolId = reference.split("#").pop().trim().toLowerCase();
      if (symbolId === "unchecked-checkbox-id") return false;
      if (symbolId === "checked-checkbox-id") return true;
    }

    const semanticCheckbox = cell.matches('[role="checkbox"], [aria-checked]')
      ? cell
      : cell.querySelector('[role="checkbox"], [aria-checked]');
    if (semanticCheckbox) {
      const stateValue = booleanMarker(semanticCheckbox.getAttribute("aria-checked"));
      if (stateValue !== null) return stateValue;
    }

    for (const node of [cell, ...cell.querySelectorAll("*")]) {
      for (const attribute of ["data-checked", "aria-label", "title"]) {
        if (!node.hasAttribute(attribute)) continue;
        const stateValue = booleanMarker(node.getAttribute(attribute));
        if (stateValue !== null) return stateValue;
      }
    }

    for (const attribute of ["data-sheets-value", "data-value", "data-raw-value"]) {
      if (!cell.hasAttribute(attribute)) continue;
      const stateValue = booleanFromStructuredValue(cell.getAttribute(attribute));
      if (stateValue !== null) return stateValue;
    }

    const classNames = [cell, ...cell.querySelectorAll("*")]
      .map((node) => String(node.getAttribute("class") || ""))
      .join(" ")
      .toLowerCase();
    if (!/(checkbox|checkmark|check-box)/.test(classNames)) return null;
    if (/(unchecked|unselected|checkbox[-_ ]?(?:off|false|empty))/.test(classNames)) return false;
    if (/(checked|selected|checkbox[-_ ]?(?:on|true|checked))/.test(classNames)) return true;
    return null;
  }

  function readableCellText(cell) {
    const checkboxState = checkboxStateFromCell(cell);
    if (checkboxState !== null) return checkboxState ? "TRUE" : "FALSE";
    const clone = cell.cloneNode(true);
    for (const lineBreak of clone.querySelectorAll("br")) {
      lineBreak.replaceWith(clone.ownerDocument.createTextNode("\n"));
    }
    return String(clone.textContent || "").trim();
  }

  async function fetchResourceText(url, signal, timeoutMessage, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(signal?.reason || new DOMException("Lectura cancelada", "AbortError"));
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await fetch(url.href, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Google respondió ${response.status}`);
      return response.text();
    } catch (error) {
      if (timedOut) throw new Error(timeoutMessage);
      if (signal?.aborted) throw new DOMException("Lectura cancelada", "AbortError");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function fetchHtmlDocument(url, signal, timeoutMessage, timeoutMs) {
    const html = await fetchResourceText(url, signal, timeoutMessage, timeoutMs);
    const trustedHtml = trustedHtmlPolicy ? trustedHtmlPolicy.createHTML(html) : html;
    return new DOMParser().parseFromString(trustedHtml, "text/html");
  }

  async function readRange(range, signal, gid = currentGid(), options = {}) {
    const doc = await fetchHtmlDocument(embedUrl(range, gid), signal, "La vista HTML tardó demasiado en responder", 12_000);
    const rows = Array.from(doc.querySelectorAll("tbody tr")).flatMap((tr) => {
      const rowHeader = tr.querySelector("th.row-headers-background");
      if (!rowHeader) return [];
      const number = Number(rowHeader.textContent.trim());
      const cells = Array.from(tr.querySelectorAll("td:not(.freezebar-cell)"), readableCellText);
      return Number.isFinite(number) ? [{ number, cells }] : [];
    });
    if (!rows.length && !options.allowEmpty) {
      throw new Error("La vista HTML no devolvió filas; revisa que tu sesión tenga acceso");
    }
    return rows;
  }

  function sheetQueryUrl(sheetName, range) {
    const url = new URL(`/spreadsheets/d/${spreadsheetId()}/gviz/tq`, location.origin);
    url.searchParams.set("tqx", "out:html");
    url.searchParams.set("sheet", sheetName);
    url.searchParams.set("range", range);
    url.searchParams.set("headers", "1");
    url.searchParams.set("_", Date.now().toString());
    return url;
  }

  function sheetValueQueryUrl(sheetName, range) {
    const url = new URL(`/spreadsheets/d/${spreadsheetId()}/gviz/tq`, location.origin);
    url.searchParams.set("tqx", "out:json");
    url.searchParams.set("sheet", sheetName);
    url.searchParams.set("range", range);
    url.searchParams.set("headers", "0");
    url.searchParams.set("_", Date.now().toString());
    return url;
  }

  function parseVisualizationResponse(source) {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Google devolvió una respuesta de datos no válida");
    const response = JSON.parse(source.slice(start, end + 1));
    if (response.status !== "ok" || !response.table) {
      const detail = response.errors?.map((error) => error.detailed_message || error.message).filter(Boolean).join(" · ");
      throw new Error(detail || "Google no devolvió los valores solicitados");
    }
    return response.table;
  }

  async function readVisualizationRange(sheetName, range, signal) {
    const source = await fetchResourceText(
      sheetValueQueryUrl(sheetName, range),
      signal,
      `El rango ${range} de ${sheetName} tardó demasiado en responder`,
      12_000
    );
    return parseVisualizationResponse(source);
  }

  async function readNamedSheetRow(sheetName, rowNumber, signal) {
    const table = await readSheetTable(sheetName, `A${rowNumber}:${MAX_COLUMN}${rowNumber}`, signal);
    return table.headers;
  }

  async function readSheetTable(sheetName, range, signal) {
    const doc = await fetchHtmlDocument(
      sheetQueryUrl(sheetName, range),
      signal,
      `La hoja ${sheetName} tardó demasiado en responder`,
      15_000
    );
    const table = doc.querySelector("table");
    if (!table) throw new Error(`Google no devolvió datos para la hoja ${sheetName}`);
    const rows = Array.from(table.querySelectorAll("tr"), (tr) =>
      Array.from(tr.querySelectorAll("td, th"), readableCellText)
    ).filter((cells) => cells.length);
    const headers = rows[0] || [];
    return {
      name: sheetName,
      headers,
      rows: rows.slice(1).map((cells, index) => ({ number: index + 2, cells }))
    };
  }

  async function cachedSheetTable(sheetName, full, signal) {
    const range = full ? `A1:${MAX_COLUMN}` : `A1:${MAX_COLUMN}2`;
    const key = `${spreadsheetId()}:${sheetName}:${full ? "full" : "header"}`;
    const cached = state.sheetCache.get(key);
    if (cached && Date.now() - cached.loadedAt < SHEET_MEMORY_TTL) return cached.table;
    const table = await readSheetTable(sheetName, range, signal);
    if (!signal?.aborted) state.sheetCache.set(key, { loadedAt: Date.now(), table });
    return table;
  }

  function setRelatedStatus(message, transient = false) {
    ui.relatedStatus.hidden = transient;
    ui.relatedStatus.textContent = message;
  }

  function relationColumns(headers) {
    return headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => String(header || "").trim());
  }

  function displayRelationColumns(relation) {
    return relationColumns(relation.headers).map((column, position) => ({
      ...column,
      propertyIndex: Number(relation.columnIndexes?.[position] ?? column.index)
    }));
  }

  function relatedProperty(sheetName, column) {
    return sheetConfigurationByName(sheetName)?.columns?.[column.propertyIndex]
      || defaultProperty(column.propertyIndex, column.header);
  }

  function relatedDraftKey(sheetName, rowNumber, columnIndex) {
    return `${encodeURIComponent(sheetName)}:${rowNumber}:${columnIndex}`;
  }

  function relatedDraftSnapshot() {
    return state.relatedDraftVersion;
  }

  function subscribeRelatedDrafts(listener) {
    state.relatedDraftListeners.add(listener);
    return () => state.relatedDraftListeners.delete(listener);
  }

  function notifyRelatedDrafts() {
    state.relatedDraftVersion += 1;
    for (const listener of state.relatedDraftListeners) listener();
    syncPendingActions();
  }

  function useRelatedDraftVersion() {
    return React.useSyncExternalStore(subscribeRelatedDrafts, relatedDraftSnapshot, relatedDraftSnapshot);
  }

  function relatedDraftValue(relation, row, column) {
    const key = relatedDraftKey(relation.sheetName, row.number, column.propertyIndex);
    return state.relatedDrafts.get(key)?.value ?? String(row.cells[column.index] ?? "");
  }

  function setRelatedDraft(relation, row, column, editorValue) {
    const property = relatedProperty(relation.sheetName, column);
    const key = relatedDraftKey(relation.sheetName, row.number, column.propertyIndex);
    const existing = state.relatedDrafts.get(key);
    const previousValue = existing?.previousValue ?? String(row.cells[column.index] ?? "");
    const value = serializeEditorValue(editorValue, property);
    if (valuesEqualForProperty(value, previousValue, property)) {
      state.relatedDrafts.delete(key);
    } else {
      state.relatedDrafts.set(key, {
        key,
        sheetName: relation.sheetName,
        rowNumber: row.number,
        columnIndex: column.propertyIndex,
        cellIndex: column.index,
        value,
        previousValue,
        property,
        relation,
        row
      });
    }
    notifyRelatedDrafts();
  }

  function relatedDraftsForRow(sheetName, rowNumber) {
    return [...state.relatedDrafts.values()].filter((draft) =>
      draft.sheetName === sheetName && draft.rowNumber === rowNumber
    );
  }

  function discardRelatedDrafts(predicate = () => true) {
    let changed = false;
    for (const [key, draft] of state.relatedDrafts) {
      if (!predicate(draft)) continue;
      state.relatedDrafts.delete(key);
      changed = true;
    }
    if (changed) notifyRelatedDrafts();
  }

  function RelatedCellEditor({ relation, row, column }) {
    useRelatedDraftVersion();
    const property = relatedProperty(relation.sheetName, column);
    const rawValue = relatedDraftValue(relation, row, column);
    return React.createElement(
      "div",
      {
        className: "related-cell-editor",
        "data-related-sheet": relation.sheetName,
        "data-related-row": String(row.number),
        "data-related-column": String(column.propertyIndex + 1)
      },
      React.createElement(PropertyEditorControl, {
        property,
        value: editorValueFromRaw(rawValue, property),
        onChange: (nextValue) => setRelatedDraft(relation, row, column, nextValue)
      })
    );
  }

  function RelatedRecordCard({ relation, columns, row, onOpen }) {
    useRelatedDraftVersion();
    const titleColumn = columns[0];
    const title = titleColumn ? String(relatedDraftValue(relation, row, titleColumn) || "").trim() : "";
    const previewColumns = columns.slice(1, 4).filter((column) => String(relatedDraftValue(relation, row, column) || "").trim());
    return React.createElement(
      "div",
      {
        className: "related-record-card",
        role: "button",
        tabIndex: 0,
        onClick: (event) => {
          if (event.detail === 0 || panelFrame.contentWindow.matchMedia("(pointer: coarse)").matches) onOpen();
        },
        onDoubleClick: onOpen,
        onKeyDown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onOpen();
        }
      },
      React.createElement(
        "div",
        { className: "related-record-title", title: title || `Fila ${row.number}`, "data-relation-cell": "" },
        title || `Fila ${row.number}`
      ),
      previewColumns.length ? React.createElement(
        "div",
        { className: "related-record-fields" },
        ...previewColumns.map((column) => {
          const property = relatedProperty(relation.sheetName, column);
          const value = String(relatedDraftValue(relation, row, column) || "");
          return React.createElement(
            "div",
            { className: "related-record-field", key: `${column.index}:${column.header}` },
            React.createElement(
              "span",
              { className: "property-type-icon related-record-field-icon" },
              typeBadge(property.type, 12)
            ),
            React.createElement("span", null, property.name || column.header),
            React.createElement("strong", { title: value, "data-relation-cell": "" }, value)
          );
        })
      ) : null
    );
  }

  function RelatedRecordsTable({ relation, columns, rows }) {
    return React.createElement(
      "div",
      { className: "related-table-scroll" },
      React.createElement(
        "table",
        { className: "relation-table related-inline-table", "aria-label": `Registros relacionados de ${relation.sheetName}` },
        React.createElement(
          "thead",
          null,
          React.createElement(
            "tr",
            null,
            ...columns.map((column) => React.createElement("th", { key: `${column.index}:${column.header}` }, column.header))
          )
        ),
        React.createElement(
          "tbody",
          null,
          ...rows.map((row, rowIndex) => React.createElement(
            "tr",
            { key: row.number || rowIndex },
            ...columns.map((column) => React.createElement(
              "td",
              { key: `${column.index}:${column.header}` },
              React.createElement(RelatedCellEditor, { relation, row, column })
            ))
          ))
        )
      )
    );
  }

  function RelatedRecordDrawer({ relation, columns, row, open, onClose }) {
    useRelatedDraftVersion();
    if (!row) return null;
    const titleColumn = columns[0];
    const recordTitle = titleColumn
      ? String(relatedDraftValue(relation, row, titleColumn) || "").trim()
      : "";
    const rowDrafts = relatedDraftsForRow(relation.sheetName, row.number);
    const discard = () => {
      discardRelatedDrafts((draft) => draft.sheetName === relation.sheetName && draft.rowNumber === row.number);
      onClose();
    };

    return React.createElement(
      Drawer,
      {
        open,
        onClose,
        width: 720,
        destroyOnClose: true,
        className: "record-drawer related-record-drawer",
        rootClassName: "related-record-drawer-root",
        getContainer: () => panelDocument.body,
        title: `${relation.sheetName} · fila ${row.number}`,
        footer: React.createElement(
          "div",
          { className: "related-drawer-footer" },
          React.createElement(Button, { onClick: discard, disabled: state.saving || !rowDrafts.length }, "Cancelar"),
          React.createElement(Button, {
            type: "primary",
            disabled: state.saving || !rowDrafts.length,
            onClick: () => void saveRelatedChanges(rowDrafts)
          }, "Guardar cambios")
        )
      },
      React.createElement(
        "div",
        { className: "record-page related-record-page" },
        React.createElement("h2", { className: "related-drawer-title" }, recordTitle || `Fila ${row.number}`),
        React.createElement(
          "div",
          { className: "fields related-drawer-fields" },
          ...columns.map((column) => {
            const property = relatedProperty(relation.sheetName, column);
            return React.createElement(
              "div",
              { className: "field", key: `${column.propertyIndex}:${column.header}` },
              React.createElement(
                "div",
                { className: "field-label" },
                React.createElement(
                  "span",
                  { className: "field-configure property-type-icon related-field-icon" },
                  typeBadge(property.type)
                ),
                React.createElement(
                  "div",
                  { className: "field-label-copy" },
                  React.createElement("span", { className: "field-label-text" }, property.name || column.header),
                  React.createElement("small", { className: "field-type-name" }, property.type)
                )
              ),
              React.createElement(
                "div",
                { className: "field-editor" },
                React.createElement(RelatedCellEditor, { relation, row, column })
              )
            );
          })
        )
      )
    );
  }

  function RelationSection({ relation, initialView }) {
    const [expanded, setExpanded] = React.useState(true);
    const [view, setView] = React.useState(initialView);
    const [page, setPage] = React.useState(1);
    const [openRow, setOpenRow] = React.useState(null);
    const columns = displayRelationColumns(relation);
    const pageSize = view === "table" ? 10 : 4;
    const totalCount = relation.totalCount ?? relation.rows.length;
    const availableCount = relation.rows.length;
    const maxPage = Math.max(1, Math.ceil(availableCount / pageSize));
    const currentPage = Math.min(page, maxPage);
    const visibleRows = relation.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const changeView = (nextView) => {
      setView(nextView);
      setPage(1);
      setRelationView(relation.sheetName, nextView);
    };

    return React.createElement(
      "section",
      { className: "relation record-section-card relation-section-card", "data-relation-view": view },
      React.createElement(
        "div",
        { className: "relation-head record-section-header" },
        React.createElement(
          "button",
          {
            className: "relation-toggle record-section-toggle",
            type: "button",
            "aria-label": expanded ? "Colapsar relacionados" : "Expandir relacionados",
            "aria-expanded": expanded,
            onClick: () => setExpanded((current) => !current)
          },
          React.createElement(expanded ? DownOutlined : RightOutlined)
        ),
        React.createElement(
          "div",
          { className: "relation-heading-copy record-section-title" },
          React.createElement("div", { className: "relation-title" }, relation.sheetName),
          React.createElement("div", { className: "relation-kind", title: relation.description }, relation.description)
        ),
        React.createElement(
          "div",
          { className: "relation-actions relation-section-actions" },
          React.createElement(Segmented, {
            size: "small",
            value: view,
            onChange: changeView,
            options: [
              { value: "deck", icon: React.createElement(AppstoreOutlined), label: "Deck" },
              { value: "table", icon: React.createElement(TableOutlined), label: "Tabla" }
            ]
          }),
          React.createElement(Tag, { className: "relation-count" }, String(totalCount))
        )
      ),
      expanded && !totalCount
        ? React.createElement("div", { className: "relation-empty" }, "No hay registros relacionados.")
        : null,
      expanded && totalCount && view === "table"
        ? React.createElement(RelatedRecordsTable, { relation, columns, rows: visibleRows })
        : null,
      expanded && totalCount && view === "deck"
        ? React.createElement(
          "div",
          { className: "related-record-grid" },
          ...visibleRows.map((row, rowIndex) => React.createElement(RelatedRecordCard, {
            relation,
            columns,
            row,
            onOpen: () => setOpenRow(row),
            key: row.number || rowIndex
          }))
        )
        : null,
      expanded && availableCount > pageSize
        ? React.createElement(Pagination, {
          className: "relation-pagination record-section-pagination",
          current: currentPage,
          pageSize,
          total: availableCount,
          showSizeChanger: false,
          size: "small",
          onChange: setPage
        })
        : null,
      React.createElement(RelatedRecordDrawer, {
        relation,
        columns,
        row: openRow,
        open: Boolean(openRow),
        onClose: () => setOpenRow(null)
      })
    );
  }

  function renderRelation(relation) {
    const relationHost = element("div", "relation-host");
    relationHost._reactRoot = createRoot(relationHost);
    ui.relatedList.appendChild(relationHost);
    flushSync(() => relationHost._reactRoot.render(antdTree(React.createElement(RelationSection, {
      relation,
      initialView: relationView(relation.sheetName)
    }))));
  }

  function storedRelations(relations) {
    return relations.map((relation) => {
      const columns = relationColumns(relation.headers);
      return {
        sheetName: relation.sheetName,
        description: relation.description,
        headers: columns.map((column) => column.header),
        columnIndexes: columns.map((column, position) => Number(relation.columnIndexes?.[position] ?? column.index)),
        totalCount: relation.totalCount ?? relation.rows.length,
        rows: relation.rows.slice(0, 50).map((row) => ({
          number: row.number,
          cells: columns.map((column) => row.cells[column.index] || "")
        }))
      };
    });
  }

  function showRelations(relations) {
    state.relations = relations;
    const signature = JSON.stringify(storedRelations(relations));
    if (ui.relatedList.dataset.signature === signature) return;
    unmountRelations();
    ui.relatedList.replaceChildren();
    for (const relation of relations) renderRelation(relation);
    ui.relatedList.dataset.signature = signature;
  }

  function unmountRelations() {
    for (const relationHost of ui.relatedList.querySelectorAll(":scope > .relation-host")) {
      relationHost._reactRoot?.unmount();
    }
  }

  function clearRelations() {
    state.relations = [];
    unmountRelations();
    ui.relatedList.replaceChildren();
    delete ui.relatedList.dataset.signature;
  }

  function startRelationships(currentHeaders, currentValues, parentSignal, silent = false) {
    state.relationRequest?.abort();
    const controller = new AbortController();
    state.relationRequest = controller;
    if (!silent) setActivity("relations", true);
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", () => controller.abort(), { once: true });
    void loadRelationships(currentHeaders, currentValues, controller.signal).finally(() => {
      if (state.relationRequest === controller) setActivity("relations", false);
    });
  }

  async function loadRelationships(currentHeaders, currentValues, signal) {
    const currentSheet = activeSheetName();
    const persistentKey = cacheKey("relations", currentGid(), state.row);
    const cached = await readPersistentCache(persistentKey);
    if (signal?.aborted) return;
    const usableCache = cached?.currentSheet === currentSheet && Array.isArray(cached.relations);
    if (usableCache) {
      showRelations(cached.relations);
      setRelatedStatus("Mostrando relacionados guardados · comprobando cambios…", true);
    } else {
      setRelatedStatus("Detectando relaciones por columnas ID…", true);
    }

    const otherSheets = visibleSheetNames().filter((name) => name !== currentSheet);
    if (!otherSheets.length) {
      showRelations([]);
      setRelatedStatus("No hay otras hojas visibles en este documento.");
      void writePersistentCache(persistentKey, { currentSheet, relations: [], updatedAt: Date.now() });
      return;
    }

    try {
      const metadataResults = await Promise.allSettled(
        otherSheets.map((name) => cachedSheetTable(name, false, signal))
      );
      if (signal?.aborted) return;
      const metadata = metadataResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const currentPrimary = primaryKeyIndex(currentSheet, currentHeaders);
      const descriptors = [];

      for (const table of metadata) {
        const otherPrimary = primaryKeyIndex(table.name, table.headers);

        if (currentPrimary >= 0) {
          const foreignIndex = matchingColumn(table.headers, currentHeaders[currentPrimary]);
          const keyValue = comparable(currentValues[currentPrimary]);
          if (foreignIndex >= 0 && keyValue) {
            descriptors.push({
              sheetName: table.name,
              matchIndex: foreignIndex,
              matchValue: keyValue,
              description: `Lista relacionada por ${currentHeaders[currentPrimary]}`
            });
          }
        }

        if (otherPrimary >= 0) {
          const localForeignIndex = matchingColumn(currentHeaders, table.headers[otherPrimary]);
          const keyValue = comparable(currentValues[localForeignIndex]);
          const duplicatesExisting = descriptors.some((item) =>
            item.sheetName === table.name &&
            normalizedColumn(table.headers[item.matchIndex]) === normalizedColumn(table.headers[otherPrimary])
          );
          if (localForeignIndex >= 0 && keyValue && !duplicatesExisting) {
            descriptors.push({
              sheetName: table.name,
              matchIndex: otherPrimary,
              matchValue: keyValue,
              description: `Registro referenciado por ${table.headers[otherPrimary]}`
            });
          }
        }
      }

      if (!descriptors.length) {
        showRelations([]);
        setRelatedStatus("No encontré columnas ID compartidas con las otras hojas.");
        void writePersistentCache(persistentKey, { currentSheet, relations: [], updatedAt: Date.now() });
        return;
      }

      const relationResults = await Promise.allSettled(descriptors.map(async (descriptor) => {
        const table = await cachedSheetTable(descriptor.sheetName, true, signal);
        const rows = table.rows.filter((row) => comparable(row.cells[descriptor.matchIndex]) === descriptor.matchValue);
        return { ...descriptor, headers: table.headers, rows, totalCount: rows.length };
      }));
      if (signal?.aborted) return;

      const relations = relationResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const persistentRelations = storedRelations(relations);
      if (!usableCache || !sameValues(cached.relations, persistentRelations)) showRelations(relations);
      void writePersistentCache(persistentKey, {
        currentSheet,
        relations: persistentRelations,
        updatedAt: Date.now()
      });
      ui.relatedStatus.hidden = relations.length > 0;
      const failures = relationResults.length - relations.length;
      if (!relations.length) setRelatedStatus("No pude leer las hojas relacionadas con la sesión actual.");
      else if (failures) setRelatedStatus(`Se cargaron relaciones, pero ${failures} hoja(s) no respondieron.`);
    } catch (error) {
      if (error.name !== "AbortError") setRelatedStatus(error.message);
    }
  }

  async function headers(signal, force = false) {
    const key = `${spreadsheetId()}:${currentGid()}`;
    if (!force && state.headerCache.has(key)) return state.headerCache.get(key);
    const rows = await readRange(`A1:${MAX_COLUMN}1`, signal);
    const labels = rows.find((row) => row.number === 1)?.cells || [];
    state.headerCache.set(key, labels);
    return labels;
  }

  function parseNumber(value, property) {
    let text = String(value ?? "").trim();
    if (!text) return null;
    if (property?.currencySymbol) text = text.replaceAll(property.currencySymbol, "");
    text = text.replace(/\s/g, "");
    if (text.includes(",") && text.includes(".")) {
      if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replaceAll(".", "").replace(",", ".");
      else text = text.replaceAll(",", "");
    } else if (text.includes(",")) {
      text = /^-?\d+,\d+$/.test(text) ? text.replace(",", ".") : text.replaceAll(",", "");
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function validDateParts(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function dateInputValue(value, format = "DD/MM/YYYY") {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    let year;
    let month;
    let day;
    if (iso) {
      [, year, month, day] = iso.map(Number);
    } else {
      const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
      if (!match) return "";
      if (format === "MM/DD/YYYY") [, month, day, year] = match.map(Number);
      else [, day, month, year] = match.map(Number);
    }
    if (!validDateParts(year, month, day)) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function formattedDate(value, format = "DD/MM/YYYY") {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return String(value || "");
    const [, year, month, day] = match;
    if (format === "YYYY-MM-DD") return `${year}-${month}-${day}`;
    if (format === "MM/DD/YYYY") return `${month}/${day}/${year}`;
    return `${day}/${month}/${year}`;
  }

  function timeInputValue(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const match = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
    if (!match) return "";
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3]?.toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function formattedTime(value, format = "24") {
    const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
    if (!match || format !== "12") return String(value || "");
    const hour = Number(match[1]);
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
  }

  function datetimeInputValue(value, property) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const match = text.match(/^(.+?)(?:T|\s+)(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)$/i);
    if (!match) return "";
    const date = dateInputValue(match[1], property.dateFormat);
    const time = timeInputValue(match[2]);
    return date && time ? `${date}T${time}` : "";
  }

  function splitMultipleValues(value) {
    return String(value ?? "")
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function checkboxEditorValue(rawValue, property) {
    const text = comparable(rawValue);
    if (text.toLowerCase() === comparable(property.checkedValue).toLowerCase()) return true;
    if (text.toLowerCase() === comparable(property.uncheckedValue).toLowerCase()) return false;
    const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    return ["TRUE", "VERDADERO", "SI", "YES", "1"].includes(normalized);
  }

  function createFieldControl(property, index) {
    const control = element("div", "antd-field-control");
    control.dataset.column = String(index + 1);
    control.dataset.fieldType = property.type;
    control.dataset.fieldHost = "";
    control.setAttribute("aria-label", property.name);
    return control;
  }

  function editorValueFromRaw(rawValue, property) {
    const text = String(rawValue ?? "");
    if (property.type === "checkbox") {
      return checkboxEditorValue(text, property);
    }
    if (property.type === "multiSelect") return splitMultipleValues(text);
    if (property.type === "date") return dateInputValue(text, property.dateFormat);
    if (property.type === "datetime") return datetimeInputValue(text, property);
    if (property.type === "time") return timeInputValue(text);
    if (["number", "currency"].includes(property.type)) {
      const number = parseNumber(text, property);
      return number === null ? "" : number;
    }
    return text;
  }

  function serializeEditorValue(value, property) {
    if (property.type === "checkbox") return value ? property.checkedValue : property.uncheckedValue;
    if (property.type === "multiSelect") return (Array.isArray(value) ? value : []).join(", ");
    if (property.type === "date") return formattedDate(value, property.dateFormat);
    if (property.type === "datetime") {
      const [date, time] = String(value || "").split("T");
      return date && time ? `${formattedDate(date, property.dateFormat)} ${formattedTime(time, property.timeFormat)}` : "";
    }
    if (property.type === "time") return formattedTime(value, property.timeFormat);
    return String(value ?? "");
  }

  function setControlValue(control, rawValue, property) {
    control.setAttribute("aria-label", property.name);
    control._editorValue = editorValueFromRaw(rawValue, property);
    control._value = serializeEditorValue(control._editorValue, property);
    control.dataset.serializedValue = control._value;
    if (!control._reactRoot) control._reactRoot = createRoot(control);
    const editor = React.createElement(
      FieldErrorBoundary,
      { host: control },
      React.createElement(AntFieldControl, { host: control, property })
    );
    flushSync(() => control._reactRoot.render(antdTree(editor)));
  }

  function controlValue(control) {
    return String(control._value ?? "");
  }

  function valuesEqualForProperty(left, right, property) {
    if (["number", "currency"].includes(property.type)) {
      const leftNumber = parseNumber(left, property);
      const rightNumber = parseNumber(right, property);
      if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber;
    }
    if (property.type === "date") {
      const leftDate = dateInputValue(left, property.dateFormat);
      const rightDate = dateInputValue(right, property.dateFormat);
      if (leftDate && rightDate) return leftDate === rightDate;
    }
    if (property.type === "datetime") {
      const leftDate = datetimeInputValue(left, property);
      const rightDate = datetimeInputValue(right, property);
      if (leftDate && rightDate) return leftDate === rightDate;
    }
    if (property.type === "time") {
      const leftTime = timeInputValue(left);
      const rightTime = timeInputValue(right);
      if (leftTime && rightTime) return leftTime === rightTime;
    }
    if (property.type === "multiSelect") {
      return sameValues(splitMultipleValues(left), splitMultipleValues(right));
    }
    if (property.type === "checkbox") {
      return checkboxEditorValue(left, property) === checkboxEditorValue(right, property);
    }
    return String(left ?? "") === String(right ?? "");
  }

  function currentControls() {
    return Array.from(ui.fields.querySelectorAll("[data-column]"))
      .sort((left, right) => Number(left.dataset.column) - Number(right.dataset.column));
  }

  function currentInputValues() {
    return currentControls().map((control) => {
      const index = Number(control.dataset.column) - 1;
      return controlValue(control, propertyForColumn(index));
    });
  }

  function collectPendingChanges(controls = currentControls()) {
    return controls.flatMap((control) => {
      const index = Number(control.dataset.column) - 1;
      const property = propertyForColumn(index);
      const value = controlValue(control, property);
      return valuesEqualForProperty(value, state.values[index], property) ? [] : [{ index, value }];
    });
  }

  function syncPendingActions() {
    const ready = Boolean(state.row && state.viewRow === state.row && state.viewGid === state.gid);
    const hasChanges = ready && (collectPendingChanges().length > 0 || state.relatedDrafts.size > 0);
    const disabled = state.saving || !hasChanges;
    ui.save.disabled = disabled;
    ui.cancel.disabled = disabled;
    host.dataset.hasPendingChanges = hasChanges ? "true" : "false";
  }

  function cancelChanges() {
    if (state.saving || state.viewRow !== state.row || state.viewGid !== state.gid) return;
    renderFields();
    discardRelatedDrafts();
    setStatus(`Cambios descartados · fila ${state.row}`);
    syncPendingActions();
  }

  function applyRowData(labels, values, row, signal, drafts = []) {
    const width = Math.max(labels.length, values.length);
    state.values = Array.from({ length: width }, (_, index) => values[index] || "");
    state.fields = Array.from({ length: width }, (_, index) => labels[index] || `Columna ${columnName(index + 1)}`);
    reconcileSheetConfiguration(currentGid(), activeSheetName() || `Hoja ${currentGid()}`, state.fields);
    renderSheetViewActions();
    setEmptyState(false);
    renderFields(new Map(drafts.map((draft) => [draft.index, draft.value])));
    state.viewRow = row;
    state.viewGid = currentGid();
    host.dataset.row = String(row);
    ui.fields.inert = false;
    ui.fields.removeAttribute("aria-busy");
    syncPendingActions();
    startRelationships(labels, state.values, signal);
  }

  function clearRenderedFields() {
    for (const wrapper of ui.fields.children) {
      const control = wrapper.querySelector?.("[data-column]");
      const configure = wrapper.querySelector?.(".field-configure");
      if (control?._reactRoot) flushSync(() => control._reactRoot.unmount());
      if (configure?._iconRoot) flushSync(() => configure._iconRoot.unmount());
    }
    ui.fields.replaceChildren();
  }

  function setEmptyState(empty) {
    ui.emptyState.hidden = !empty;
    ui.fields.hidden = empty;
    ui.related.hidden = empty;
    host.dataset.empty = empty ? "true" : "false";
  }

  function applyEmptyRow(labels, row) {
    state.relationRequest?.abort();
    state.relationRequest = null;
    setActivity("relations", false);
    state.fields = [...labels];
    state.values = Array.from({ length: labels.length }, () => "");
    reconcileSheetConfiguration(currentGid(), activeSheetName() || `Hoja ${currentGid()}`, state.fields);
    renderSheetViewActions();
    state.viewRow = row;
    state.viewGid = currentGid();
    host.dataset.row = String(row);
    clearRenderedFields();
    clearRelations();
    setRelatedStatus("", true);
    setEmptyState(true);
    ui.fields.inert = false;
    ui.fields.removeAttribute("aria-busy");
    syncPendingActions();
  }

  async function loadRow(row, force = false) {
    const gid = currentGid();
    if (!force && state.loading && row === state.row && gid === state.gid) return;
    if (state.gid !== null && gid !== state.gid) state.sheetCache.clear();
    state.request?.abort();
    const request = new AbortController();
    state.request = request;
    state.loading = true;
    setActivity("row", true);
    state.row = row;
    state.gid = gid;
    state.sheetName = activeSheetName() || `Hoja ${gid}`;
    renderSheetViewActions();
    syncPendingActions();
    ui.fields.inert = true;
    ui.fields.setAttribute("aria-busy", "true");
    setRelatedStatus("Detectando hojas y relaciones…", true);
    ui.meta.textContent = `${activeSheetName() || `Hoja ${gid}`} · fila ${row}`;
    const persistentKey = cacheKey("row", gid, row);
    let cached = null;

    if (!force) {
      cached = await readPersistentCache(persistentKey);
      if (request.signal.aborted || state.request !== request) return;
    }

    if (cached?.empty && cached?.labels) {
      applyEmptyRow(cached.labels, row);
      setStatus(`Fila ${row} vacía`, "empty");
    } else if (cached?.labels && cached?.values) {
      applyRowData(cached.labels, cached.values, row, request.signal);
      setStatus(`Fila ${row} cargada desde caché · comprobando cambios…`);
    } else {
      syncPendingActions();
      setStatus(`Leyendo la fila ${row} desde tu sesión de Google…`, "busy");
    }

    try {
      const [labels, rows] = await Promise.all([
        headers(request.signal, true),
        readRange(`A${row}:${MAX_COLUMN}${row}`, request.signal, gid, { allowEmpty: true })
      ]);
      const values = rows.find((item) => item.number === row)?.cells || [];
      const rowIsEmpty = !values.some((value) => String(value ?? "").trim());
      if (rowIsEmpty) {
        void writePersistentCache(persistentKey, {
          labels: [...labels],
          values: [],
          empty: true,
          updatedAt: Date.now()
        });
        applyEmptyRow(labels, row);
        setStatus(`Fila ${row} vacía`, "empty");
        return;
      }
      const width = Math.max(labels.length, values.length, cached?.values?.length || 0);
      const freshValues = Array.from({ length: width }, (_, index) => values[index] || "");
      const freshLabels = Array.from({ length: width }, (_, index) => labels[index] || "");
      const cachedPendingChanges = Array.isArray(cached?.pendingChanges) ? cached.pendingChanges : [];
      const pendingSince = Number(cached?.pendingSince || cached?.updatedAt || 0);
      const pendingChanges = Date.now() - pendingSince < 20_000 ? cachedPendingChanges : [];
      const pendingByIndex = new Map(pendingChanges.map((change) => [change.index, change]));
      const pendingConfirmed = pendingChanges.length > 0 && pendingChanges.every(({ index, value }) =>
        valuesEqualForProperty(freshValues[index], value, propertyForColumn(index))
      );
      const effectiveValues = pendingChanges.length > 0
        ? freshValues.map((value, index) => {
          const pending = pendingByIndex.get(index);
          return pending ? String(pending.value ?? "") : value;
        })
        : freshValues;
      const nextCache = {
        labels: freshLabels,
        values: effectiveValues,
        updatedAt: Date.now(),
        ...(pendingChanges.length > 0 && !pendingConfirmed ? { pendingChanges, pendingSince } : {})
      };
      const changed = !cached || !sameValues(cached.labels, freshLabels) || !sameValues(cached.values, effectiveValues);
      void writePersistentCache(persistentKey, nextCache);

      if (!cached) {
        applyRowData(freshLabels, effectiveValues, row, request.signal);
        setStatus(`Lectura automática confirmada · fila ${row}`);
      } else if (!changed) {
        setStatus(pendingChanges.length > 0 && !pendingConfirmed
          ? `Fila ${row} guardada localmente · esperando confirmación de Sheets`
          : `Fila ${row} actualizada · sin cambios nuevos`
        );
      } else {
        const draftValues = currentInputValues();
        const dirty = draftValues.flatMap((value, index) =>
          valuesEqualForProperty(value, state.values[index], propertyForColumn(index)) ? [] : [{ index, value }]
        );
        applyRowData(freshLabels, effectiveValues, row, request.signal, dirty);
        setStatus(dirty.length
          ? `Datos actualizados en segundo plano · ${dirty.length} cambio(s) tuyos conservados`
          : `Datos actualizados en segundo plano · fila ${row}`
        );
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        if (cached) {
          setStatus(`Mostrando caché · no se pudo comprobar: ${error.message}`, "error");
        } else {
          ui.fields.inert = false;
          ui.fields.removeAttribute("aria-busy");
          clearRelations();
          setRelatedStatus("No se pudieron buscar relaciones para esta fila.");
          setStatus(error.message, "error");
        }
      }
    } finally {
      if (state.request === request) {
        state.loading = false;
        setActivity("row", false);
        syncPendingActions();
      }
    }
  }

  function renderFields(drafts = new Map()) {
    const existing = Array.from(ui.fields.children);
    state.fields.forEach((sourceLabel, index) => {
      const property = propertyForColumn(index);
      let wrapper = existing[index];
      let heading = wrapper?.querySelector(":scope > .field-label");
      let title = heading?.querySelector(".field-label-text");
      let configure = heading?.querySelector(".field-configure");
      let labelCopy = heading?.querySelector(".field-label-copy");
      let typeName = heading?.querySelector(".field-type-name");
      let editor = wrapper?.querySelector(":scope > .field-editor");

      if (!wrapper?.classList.contains("field") || !heading || !title || !configure || !labelCopy || !typeName || !editor) {
        const previousControl = editor?.querySelector("[data-column]");
        if (previousControl?._reactRoot) flushSync(() => previousControl._reactRoot.unmount());
        if (configure?._iconRoot) flushSync(() => configure._iconRoot.unmount());
        wrapper = wrapper || element("div");
        wrapper.className = "field";
        wrapper.replaceChildren();
        heading = element("div", "field-label");
        configure = element("button", "field-configure property-type-icon");
        configure.type = "button";
        configure.addEventListener("click", () => openPropertyEditor(Number(configure.dataset.configureColumn) - 1));
        labelCopy = element("div", "field-label-copy");
        title = element("button", "field-label-text");
        title.type = "button";
        title.addEventListener("click", () => openPropertyEditor(Number(configure.dataset.configureColumn) - 1));
        typeName = element("small", "field-type-name");
        labelCopy.append(title, typeName);
        heading.append(configure, labelCopy);
        editor = element("div", "field-editor");
        wrapper.append(heading, editor);
        if (!existing[index]) ui.fields.appendChild(wrapper);
      }

      title.textContent = property.name || sourceLabel;
      title.title = property.name || sourceLabel;
      typeName.textContent = property.type;
      configure.dataset.configureColumn = String(index + 1);
      configure.title = `Configurar ${property.name || sourceLabel}`;
      configure.setAttribute("aria-label", `Configurar ${property.name || sourceLabel}`);
      renderTypeIcon(configure, property.type);
      wrapper.dataset.fieldType = property.type;
      let control = editor.querySelector("[data-column]");
      if (!control || control.dataset.fieldType !== property.type) {
        if (control?._reactRoot) flushSync(() => control._reactRoot.unmount());
        control = createFieldControl(property, index);
        editor.replaceChildren(control);
      }
      control.dataset.column = String(index + 1);
      const nextValue = drafts.has(index) ? drafts.get(index) : (state.values[index] || "");
      setControlValue(control, nextValue, property);
    });

    for (let index = existing.length - 1; index >= state.fields.length; index -= 1) {
      const staleControl = existing[index].querySelector("[data-column]");
      const staleConfigure = existing[index].querySelector(".field-configure");
      if (staleControl?._reactRoot) flushSync(() => staleControl._reactRoot.unmount());
      if (staleConfigure?._iconRoot) flushSync(() => staleConfigure._iconRoot.unmount());
      existing[index].remove();
    }
    syncPendingActions();
  }

  function propertyFormItem(name, label, value, options = {}) {
    const item = element("div", "property-form-item");
    const labelNode = element("label", "", label);
    const id = `srd-property-${name}`;
    labelNode.htmlFor = id;
    let control;
    if (options.kind === "select") {
      control = element("select", "property-input");
      for (const choice of options.choices || []) {
        const option = element("option", "", choice.label);
        option.value = choice.value;
        control.appendChild(option);
      }
      control.value = String(value ?? "");
    } else if (options.kind === "textarea") {
      control = element("textarea", "property-input");
      control.value = String(value ?? "");
    } else {
      control = element("input", "property-input");
      control.type = options.kind || "text";
      control.value = String(value ?? "");
      if (options.min !== undefined) control.min = String(options.min);
      if (options.max !== undefined) control.max = String(options.max);
    }
    control.id = id;
    control.name = name;
    control.autocomplete = "off";
    item.append(labelNode, control);
    if (options.help) item.appendChild(element("div", "property-help", options.help));
    return item;
  }

  function PropertyTypeControl({ initialValue }) {
    const [value, setValue] = React.useState(initialValue);
    return React.createElement(Select, {
      id: "srd-property-type-picker",
      value,
      onChange: (nextValue) => {
        setValue(nextValue);
        ui.propertyType.value = nextValue;
        renderPropertySettings();
      },
      options: FIELD_TYPES.map((item) => ({
        value: item.value,
        label: React.createElement(
          "span",
          { className: "property-type-option" },
          React.createElement("span", { className: "property-type-option-icon" }, typeIcon(item.value, 15)),
          React.createElement("span", null, item.label)
        )
      })),
      style: { width: "100%" }
    });
  }

  function renderPropertyTypeSelect() {
    if (!ui.propertyTypeHost._reactRoot) ui.propertyTypeHost._reactRoot = createRoot(ui.propertyTypeHost);
    const selector = React.createElement(PropertyTypeControl, {
      key: `${state.propertyColumn}:${ui.propertyType.value}`,
      initialValue: ui.propertyType.value
    });
    flushSync(() => ui.propertyTypeHost._reactRoot.render(antdTree(selector)));
  }

  function renderPropertySettings() {
    const index = state.propertyColumn;
    if (index === null) return;
    const property = propertyForColumn(index);
    const type = ui.propertyType.value;
    ui.propertySettings._optionsRoot?.unmount();
    delete ui.propertySettings._optionsRoot;
    ui.propertySettings.replaceChildren();

    if (["select", "multiSelect", "status"].includes(type)) {
      const optionsHost = element("div", "property-form-item");
      const editorHost = element("div");
      optionsHost.append(editorHost, element(
        "div",
        "property-help",
        "Cada opción conserva su texto en Sheets y su color en este workspace local."
      ));
      ui.propertySettings.appendChild(optionsHost);
      ui.propertySettings._optionsRoot = createRoot(editorHost);
      flushSync(() => ui.propertySettings._optionsRoot.render(antdTree(
        React.createElement(PropertyOptionsEditor, { property })
      )));
    }

    if (type === "currency") {
      const grid = element("div", "property-grid");
      grid.append(
        propertyFormItem("currencySymbol", "Símbolo", property.currencySymbol || "$"),
        propertyFormItem("currencyDecimals", "Decimales", property.currencyDecimals ?? 2, { kind: "number", min: 0, max: 6 })
      );
      ui.propertySettings.appendChild(grid);
    }

    if (["date", "datetime"].includes(type)) {
      ui.propertySettings.appendChild(propertyFormItem("dateFormat", "Formato de fecha", property.dateFormat, {
        kind: "select",
        choices: [
          { value: "DD/MM/YYYY", label: "DD/MM/AAAA" },
          { value: "MM/DD/YYYY", label: "MM/DD/AAAA" },
          { value: "YYYY-MM-DD", label: "AAAA-MM-DD" }
        ]
      }));
    }

    if (["time", "datetime"].includes(type)) {
      ui.propertySettings.appendChild(propertyFormItem("timeFormat", "Formato de hora", property.timeFormat, {
        kind: "select",
        choices: [
          { value: "24", label: "24 horas" },
          { value: "12", label: "12 horas (AM/PM)" }
        ]
      }));
    }

    if (type === "checkbox") {
      const grid = element("div", "property-grid");
      grid.append(
        propertyFormItem("checkedValue", "Valor activado", property.checkedValue),
        propertyFormItem("uncheckedValue", "Valor desactivado", property.uncheckedValue)
      );
      ui.propertySettings.appendChild(grid);
    }
  }

  function openPropertyEditor(index) {
    const property = propertyForColumn(index);
    state.propertyColumn = index;
    ui.propertySource.textContent = `Columna ${columnName(index + 1)} · encabezado en Sheets: ${property.sourceHeader || "sin encabezado"}`;
    ui.propertyName.value = property.name;
    ui.propertyType.value = property.type;
    renderPropertyTypeSelect();
    renderPropertySettings();
    ui.propertyDrawer.hidden = false;
    requestAnimationFrame(() => ui.propertyName.focus());
  }

  function closePropertyEditor() {
    ui.propertyDrawer.hidden = true;
    state.propertyColumn = null;
  }

  async function savePropertyConfiguration(event) {
    event.preventDefault();
    const index = state.propertyColumn;
    const sheet = currentSheetConfiguration();
    if (index === null || !sheet?.columns?.[index]) return;
    const formData = new FormData(ui.propertyForm);
    const previous = sheet.columns[index];
    const name = String(formData.get("name") || "").trim() || previous.sourceHeader || `Columna ${columnName(index + 1)}`;
    const type = String(formData.get("type") || "text");
    const optionsField = ui.propertyForm.elements.namedItem("options");
    const options = optionsField
      ? [...new Set(String(optionsField.value || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean))]
      : previous.options;
    let submittedColors = previous.optionColors || {};
    try {
      submittedColors = JSON.parse(String(formData.get("optionColors") || "{}"));
    } catch {}
    const optionColors = Object.fromEntries(options.map((label, optionIndex) => [
      label,
      validOptionColor(
        submittedColors?.[label] || previous.optionColors?.[label],
        OPTION_PALETTE[optionIndex % OPTION_PALETTE.length]
      )
    ]));
    const next = normalizeProperty({
      ...previous,
      name,
      customName: name !== previous.sourceHeader,
      type,
      options,
      optionColors,
      currencySymbol: formData.get("currencySymbol") ?? previous.currencySymbol,
      currencyDecimals: formData.get("currencyDecimals") ?? previous.currencyDecimals,
      dateFormat: formData.get("dateFormat") ?? previous.dateFormat,
      timeFormat: formData.get("timeFormat") ?? previous.timeFormat,
      checkedValue: formData.get("checkedValue") ?? previous.checkedValue,
      uncheckedValue: formData.get("uncheckedValue") ?? previous.uncheckedValue
    }, index, previous.sourceHeader);
    const drafts = new Map(currentInputValues().map((value, columnIndex) => [columnIndex, value]));
    sheet.columns[index] = next;
    sheet.updatedAt = Date.now();
    state.activity.config = true;
    syncSaveState();
    renderFields(drafts);
    renderSheetViewActions();
    closePropertyEditor();
    try {
      await writeWorkspace();
    } finally {
      state.activity.config = false;
      syncSaveState();
    }
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function tsvValue(value) {
    const text = String(value ?? "");
    return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function qualifiedReference(sheetName, reference) {
    const escapedName = String(sheetName || "").replace(/'/g, "''");
    return escapedName ? `'${escapedName}'!${reference}` : reference;
  }

  function focusSheetRange(reference) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${++state.writeRequest}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", receive);
        reject(new Error("Sheets no respondió al intentar abrir la fila"));
      }, 4_000);

      function receive(event) {
        const message = event.data;
        if (event.source !== window || message?.source !== "sheets-row-drawer" || message?.type !== "focus-result" || message.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener("message", receive);
        if (message.ok) resolve();
        else reject(new Error(message.error || "No se pudo abrir la fila"));
      }

      window.addEventListener("message", receive);
      window.postMessage({
        source: "sheets-row-drawer",
        type: "focus-range",
        requestId,
        reference
      }, location.origin);
    });
  }

  function writeRanges(operations, restoreReference = "") {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${++state.writeRequest}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", receive);
        reject(new Error("Sheets no respondió al intento de escritura"));
      }, Math.max(4_000, operations.length * 700 + 2_000));

      function receive(event) {
        const message = event.data;
        if (event.source !== window || message?.source !== "sheets-row-drawer" || message?.type !== "write-result" || message.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener("message", receive);
        if (message.ok) resolve();
        else reject(new Error(message.error || "No se pudo escribir la celda"));
      }

      window.addEventListener("message", receive);
      window.postMessage({
        source: "sheets-row-drawer",
        type: "write-range",
        requestId,
        operations: operations.map((operation) => ({
          action: operation.action || "write",
          reference: operation.reference,
          tsv: operation.action === "clear" ? "" : operation.tsv ?? (operation.rows
            ? operation.rows.map((row) => row.map(tsvValue).join("\t")).join("\n")
            : operation.values.map(tsvValue).join("\t"))
        })),
        restoreReference
      }, location.origin);
    });
  }

  function hasPendingWriteVerification() {
    return state.pendingWrites.size > 0 || state.sheetViewWrites.size > 0;
  }

  async function verifySheetViewWrite(entry) {
    let verificationError = null;
    try {
      for (const delay of [600, 1_200, 2_200, 4_000]) {
        await wait(delay);
        if (entry.controller.signal.aborted || state.sheetViewWrites.get(entry.key) !== entry) return;
        try {
          const rows = await readRange(`A${entry.row}:${MAX_COLUMN}${entry.row}`, entry.controller.signal, entry.gid);
          const values = rows.find((row) => row.number === entry.row)?.cells || [];
          if (!valuesEqualForProperty(values[entry.property.index], entry.value, entry.property)) continue;
          state.sheetViewWrites.delete(entry.key);
          state.sheetCache.clear();
          if (state.gid === entry.gid && state.row === entry.row) {
            const confirmedValues = Array.from(
              { length: Math.max(state.fields.length, values.length) },
              (_, index) => index === entry.property.index ? entry.value : String(values[index] ?? state.values[index] ?? "")
            );
            state.values = confirmedValues;
            void writePersistentCache(cacheKey("row", entry.gid, entry.row), {
              labels: [...state.fields],
              values: confirmedValues,
              updatedAt: Date.now()
            });
          }
          host.dataset.writeVerification = hasPendingWriteVerification() ? "pending" : "verified";
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
          verificationError = error;
        }
      }

      if (state.sheetViewWrites.get(entry.key) !== entry) return;
      state.sheetViewWrites.delete(entry.key);
      state.sheetCache.clear();
      if (state.gid === entry.gid && state.row === entry.row) {
        const drafts = currentInputValues().flatMap((value, index) => (
          index !== entry.property.index && !valuesEqualForProperty(value, state.values[index], propertyForColumn(index))
            ? [{ index, value }]
            : []
        ));
        state.values[entry.property.index] = entry.previousValue;
        void writePersistentCache(cacheKey("row", entry.gid, entry.row), {
          labels: [...state.fields],
          values: [...state.values],
          updatedAt: Date.now()
        });
        renderFields(new Map(drafts.map((draft) => [draft.index, draft.value])));
      }
      const message = verificationError?.message || `Sheets no confirmó el cambio en la fila ${entry.row}`;
      host.dataset.writeVerification = "failed";
      setStatus(message, "error");
      entry.onRevert?.();
      entry.onError?.(message);
    } finally {
      if (state.sheetViewWrites.get(entry.key) === entry && entry.controller.signal.aborted) {
        state.sheetViewWrites.delete(entry.key);
      }
    }
  }

  async function writeSheetViewValue(row, property, value, previousValue, callbacks = {}) {
    if (state.saving) throw new Error("Espera a que termine el guardado actual");
    const gid = currentGid();
    const sheetName = activeSheetName() || state.sheetName || `Hoja ${gid}`;
    const selectedReference = nameBoxValue().split("!").pop() || `A${state.row || row}`;
    const restoreReference = qualifiedReference(sheetName, selectedReference);
    state.saving = true;
    syncSaveState();
    try {
      await writeRanges([{
        reference: qualifiedReference(sheetName, `${columnName(property.index + 1)}${row}`),
        values: [value]
      }], restoreReference);
      const key = `sheet-view:${gid}:${row}:${property.index}`;
      state.sheetViewWrites.get(key)?.controller.abort();
      const entry = {
        key,
        gid,
        row,
        property,
        value: String(value ?? ""),
        previousValue: String(previousValue ?? ""),
        controller: new AbortController(),
        onRevert: callbacks.onRevert,
        onError: callbacks.onError
      };
      state.sheetViewWrites.set(key, entry);
      state.sheetCache.clear();
      host.dataset.writeVerification = "pending";
      if (state.gid === gid && state.row === row) {
        state.values[property.index] = entry.value;
        const writtenCells = [{ index: property.index, value: entry.value }];
        void writePersistentCache(cacheKey("row", gid, row), {
          labels: [...state.fields],
          values: [...state.values],
          updatedAt: Date.now(),
          pendingChanges: writtenCells,
          pendingSince: Date.now()
        });
        renderFields();
      }
      void verifySheetViewWrite(entry);
    } finally {
      state.saving = false;
      syncSaveState();
      syncPendingActions();
    }
  }

  async function verifyPendingWrite(entry) {
    const verificationDelays = [600, 1_200, 2_200, 4_000];
    let verificationError = null;
    try {
      for (const delay of verificationDelays) {
        await wait(delay);
        if (entry.controller.signal.aborted || state.pendingWrites.get(entry.key) !== entry) return;
        try {
          const rows = await readRange(`A${entry.row}:${MAX_COLUMN}${entry.row}`, entry.controller.signal, entry.gid);
          const values = rows.find((item) => item.number === entry.row)?.cells || [];
          const width = Math.max(entry.labels.length, values.length);
          const freshValues = Array.from({ length: width }, (_, index) => values[index] || "");
          const verified = entry.writtenCells.every(({ index, value }) =>
            valuesEqualForProperty(freshValues[index], value, entry.properties[index])
          );
          if (!verified) continue;
          const writtenByIndex = new Map(entry.writtenCells.map((cell) => [cell.index, cell.value]));
          const confirmedValues = freshValues.map((value, index) =>
            writtenByIndex.has(index) ? String(writtenByIndex.get(index) ?? "") : value
          );

          state.pendingWrites.delete(entry.key);
          void writePersistentCache(entry.cacheKey, {
            labels: [...entry.labels],
            values: confirmedValues,
            updatedAt: Date.now()
          });
          if (state.gid === entry.gid && state.row === entry.row) {
            state.values = confirmedValues;
            state.headerCache.delete(`${spreadsheetId()}:${entry.gid}`);
            state.sheetCache.clear();
            host.dataset.writeVerification = hasPendingWriteVerification() ? "pending" : "verified";
            syncPendingActions();
            const relationshipKeyChanged = entry.writtenCells.some(({ index }) => /^id[a-z0-9]*/.test(normalizedColumn(entry.labels[index])));
            if (relationshipKeyChanged) startRelationships(state.fields, state.values, state.request?.signal, true);
          }
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
          verificationError = error;
        }
      }

      if (state.pendingWrites.get(entry.key) !== entry) return;
      state.pendingWrites.delete(entry.key);
      void writePersistentCache(entry.cacheKey, {
        labels: [...entry.labels],
        values: [...entry.previousValues],
        updatedAt: Date.now()
      });
      if (state.gid === entry.gid && state.row === entry.row) {
        state.values = [...entry.previousValues];
        host.dataset.writeVerification = "failed";
        setStatus(verificationError?.message || "Sheets no confirmó los valores guardados; puedes volver a intentarlo", "error");
        syncPendingActions();
      }
    } finally {
      if (state.pendingWrites.get(entry.key) === entry && entry.controller.signal.aborted) {
        state.pendingWrites.delete(entry.key);
      }
    }
  }

  function persistVisibleRelations() {
    if (!state.row || !state.gid || !state.relations.length) return;
    void writePersistentCache(cacheKey("relations", state.gid, state.row), {
      currentSheet: state.sheetName,
      relations: storedRelations(state.relations),
      updatedAt: Date.now()
    });
  }

  function buildRelatedWritePlans(drafts) {
    const groupedRows = new Map();
    for (const requestedDraft of drafts) {
      const draft = state.relatedDrafts.get(requestedDraft.key);
      if (!draft) continue;
      const rowKey = `${encodeURIComponent(draft.sheetName)}:${draft.rowNumber}`;
      if (!groupedRows.has(rowKey)) groupedRows.set(rowKey, []);
      groupedRows.get(rowKey).push(draft);
    }

    const rowPlans = [];
    const operations = [];
    for (const [rowKey, rowDrafts] of groupedRows) {
      rowDrafts.sort((left, right) => left.columnIndex - right.columnIndex);
      rowPlans.push({ key: `related:${rowKey}`, drafts: rowDrafts });
      let run = [];
      const flushRun = () => {
        if (!run.length) return;
        operations.push({
          reference: qualifiedReference(run[0].sheetName, `${columnName(run[0].columnIndex + 1)}${run[0].rowNumber}`),
          values: run.map((draft) => draft.value)
        });
        run = [];
      };
      for (const draft of rowDrafts) {
        const previous = run[run.length - 1];
        if (previous && draft.columnIndex !== previous.columnIndex + 1) flushRun();
        run.push(draft);
      }
      flushRun();
    }
    return { operations, rowPlans };
  }

  function registerPrimaryWrite(plan) {
    if (!plan) return;
    const { gid, row, labels, properties, blockValues, firstChanged } = plan;
    const key = `${gid}:${row}`;
    const previousPending = state.pendingWrites.get(key);
    previousPending?.controller.abort();
    const optimisticValues = [...state.values];
    blockValues.forEach((value, offset) => {
      optimisticValues[firstChanged + offset] = String(value ?? "");
    });
    const writtenByIndex = new Map((previousPending?.writtenCells || []).map((cell) => [cell.index, cell]));
    blockValues.forEach((value, offset) => {
      const index = firstChanged + offset;
      writtenByIndex.set(index, { index, value: String(value ?? "") });
    });
    const writtenCells = [...writtenByIndex.values()].sort((left, right) => left.index - right.index);
    const controller = new AbortController();
    const pendingSince = previousPending?.pendingSince || Date.now();
    const entry = {
      key,
      cacheKey: cacheKey("row", gid, row),
      gid,
      row,
      labels,
      properties,
      previousValues: previousPending?.previousValues || [...state.values],
      writtenCells,
      pendingSince,
      controller
    };
    state.pendingWrites.set(key, entry);
    state.values = optimisticValues;
    void writePersistentCache(entry.cacheKey, {
      labels,
      values: optimisticValues,
      updatedAt: Date.now(),
      pendingChanges: writtenCells,
      pendingSince
    });
    void verifyPendingWrite(entry);
  }

  function registerRelatedWrites(rowPlans) {
    for (const plan of rowPlans) {
      const previousPending = state.pendingWrites.get(plan.key);
      previousPending?.controller.abort();
      const previousByIndex = new Map((previousPending?.previousCells || []).map((cell) => [cell.index, cell]));
      const writtenByIndex = new Map((previousPending?.writtenCells || []).map((cell) => [cell.index, cell]));
      for (const draft of plan.drafts) {
        if (!previousByIndex.has(draft.columnIndex)) {
          previousByIndex.set(draft.columnIndex, { index: draft.columnIndex, value: draft.previousValue });
        }
        writtenByIndex.set(draft.columnIndex, { index: draft.columnIndex, value: draft.value, property: draft.property });
        draft.row.cells[draft.cellIndex] = draft.value;
        if (state.relatedDrafts.get(draft.key) === draft) state.relatedDrafts.delete(draft.key);
      }
      const firstDraft = plan.drafts[0];
      const entry = {
        key: plan.key,
        sheetName: firstDraft.sheetName,
        rowNumber: firstDraft.rowNumber,
        relation: firstDraft.relation,
        row: firstDraft.row,
        previousCells: [...previousByIndex.values()],
        writtenCells: [...writtenByIndex.values()].sort((left, right) => left.index - right.index),
        controller: new AbortController()
      };
      state.pendingWrites.set(entry.key, entry);
      void verifyRelatedWrite(entry);
    }
    state.sheetCache.clear();
    persistVisibleRelations();
    notifyRelatedDrafts();
  }

  async function verifyRelatedWrite(entry) {
    const verificationDelays = [600, 1_200, 2_200, 4_000];
    let verificationError = null;
    try {
      for (const delay of verificationDelays) {
        await wait(delay);
        if (entry.controller.signal.aborted || state.pendingWrites.get(entry.key) !== entry) return;
        try {
          const values = await readNamedSheetRow(entry.sheetName, entry.rowNumber, entry.controller.signal);
          const verified = entry.writtenCells.every(({ index, value, property }) =>
            valuesEqualForProperty(values[index], value, property)
          );
          if (!verified) continue;
          for (const column of displayRelationColumns(entry.relation)) {
            entry.row.cells[column.index] = String(values[column.propertyIndex] ?? "");
          }
          state.pendingWrites.delete(entry.key);
          state.sheetCache.clear();
          persistVisibleRelations();
          host.dataset.writeVerification = hasPendingWriteVerification() ? "pending" : "verified";
          notifyRelatedDrafts();
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
          verificationError = error;
        }
      }

      if (state.pendingWrites.get(entry.key) !== entry) return;
      state.pendingWrites.delete(entry.key);
      for (const previous of entry.previousCells) {
        const column = displayRelationColumns(entry.relation).find((item) => item.propertyIndex === previous.index);
        if (column) entry.row.cells[column.index] = previous.value;
      }
      state.sheetCache.clear();
      persistVisibleRelations();
      host.dataset.writeVerification = "failed";
      setStatus(verificationError?.message || `Sheets no confirmó la fila ${entry.rowNumber} de ${entry.sheetName}`, "error");
      notifyRelatedDrafts();
    } finally {
      if (state.pendingWrites.get(entry.key) === entry && entry.controller.signal.aborted) {
        state.pendingWrites.delete(entry.key);
      }
    }
  }

  function preparePrimaryWrite() {
    const controls = currentControls();
    const properties = state.fields.map((_, index) => propertyForColumn(index));
    const changes = collectPendingChanges(controls);
    if (!changes.length) return null;
    const firstChanged = changes[0].index;
    const lastChanged = changes[changes.length - 1].index;
    const changedValues = new Map(changes.map((change) => [change.index, change.value]));
    const blockValues = controls.slice(firstChanged, lastChanged + 1).map((control) => {
      const index = Number(control.dataset.column) - 1;
      if (changedValues.has(index)) return changedValues.get(index);
      const property = properties[index];
      return property.type === "checkbox"
        ? serializeEditorValue(checkboxEditorValue(state.values[index], property), property)
        : state.values[index];
    });
    return {
      gid: state.gid,
      row: state.row,
      labels: [...state.fields],
      properties,
      changes,
      firstChanged,
      blockValues,
      operation: {
        reference: qualifiedReference(state.sheetName, `${columnName(firstChanged + 1)}${state.row}`),
        values: blockValues
      }
    };
  }

  async function persistChanges(primaryPlan, requestedRelatedDrafts) {
    const relatedPlan = buildRelatedWritePlans(requestedRelatedDrafts);
    const operations = [primaryPlan?.operation, ...relatedPlan.operations].filter(Boolean);
    if (!operations.length) {
      setStatus("No hay cambios pendientes");
      syncPendingActions();
      return;
    }

    const selectedReference = nameBoxValue().split("!").pop() || `A${state.row}`;
    const restoreReference = qualifiedReference(state.sheetName, selectedReference);
    const changeCount = (primaryPlan?.changes.length || 0) + requestedRelatedDrafts.length;
    state.saving = true;
    notifyRelatedDrafts();
    setStatus(`Guardando ${changeCount} campo(s)…`, "busy");
    try {
      await writeRanges(operations, restoreReference);
      registerPrimaryWrite(primaryPlan);
      registerRelatedWrites(relatedPlan.rowPlans);
      host.dataset.writeVerification = "pending";
      setStatus(changeCount === 1 ? "Cambio guardado" : `${changeCount} cambios guardados`);
    } catch (error) {
      host.dataset.writeVerification = "failed";
      setStatus(error.message, "error");
    } finally {
      state.saving = false;
      notifyRelatedDrafts();
      syncSaveState();
    }
  }

  async function saveRelatedChanges(drafts = [...state.relatedDrafts.values()]) {
    if (state.saving || !state.row || !drafts.length) return;
    if (state.viewRow !== state.row || state.viewGid !== state.gid) {
      setStatus("Espera a que termine de cargar la fila seleccionada", "busy");
      return;
    }
    await persistChanges(null, drafts);
  }

  async function saveChanges() {
    if (state.saving || !state.row) return;
    if (state.viewRow !== state.row || state.viewGid !== state.gid) {
      setStatus("Espera a que termine de cargar la fila seleccionada", "busy");
      return;
    }
    await persistChanges(preparePrimaryWrite(), [...state.relatedDrafts.values()]);
  }

  function normalizedBridgeRange(value, label = "rango") {
    const range = String(value || "").trim().replace(/\$/g, "").toUpperCase();
    if (!/^[A-Z]{1,2}[1-9]\d*(?::[A-Z]{1,2}[1-9]\d*)?$/.test(range)) {
      throw new Error(`El ${label} debe usar notación A1, por ejemplo A1:D20`);
    }
    return range;
  }

  function bridgeColumnNumber(column) {
    return [...column].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  }

  function bridgeWriteRange(start, rows) {
    const reference = normalizedBridgeRange(start, "inicio");
    if (reference.includes(":")) throw new Error("El inicio de escritura debe ser una sola celda");
    const match = reference.match(/^([A-Z]+)([1-9]\d*)$/);
    const width = rows[0].length;
    const firstColumn = bridgeColumnNumber(match[1]);
    const firstRow = Number(match[2]);
    return `${reference}:${columnName(firstColumn + width - 1)}${firstRow + rows.length - 1}`;
  }

  function bridgeRows(values) {
    if (!Array.isArray(values) || !values.length) throw new Error("values debe contener al menos una fila");
    const rows = Array.isArray(values[0]) ? values : [values];
    const width = rows[0]?.length || 0;
    if (!width || rows.some((row) => !Array.isArray(row) || row.length !== width)) {
      throw new Error("values debe ser una matriz rectangular");
    }
    return rows.map((row) => row.map((value) => value === null || value === undefined ? "" : String(value)));
  }

  async function readNamedBridgeRange(sheetName, range, signal) {
    const table = await readSheetTable(sheetName, range, signal);
    const firstRow = Number(range.match(/[A-Z]+(\d+)/)?.[1] || 1);
    return [
      { number: firstRow, cells: table.headers },
      ...table.rows.map((row, index) => ({ number: firstRow + index + 1, cells: row.cells }))
    ].filter((row) => row.cells.length);
  }

  async function readBridgeRange(params, signal) {
    const range = normalizedBridgeRange(params.range);
    const requestedSheet = String(params.sheet || "").trim();
    const activeName = activeSheetName();
    const rows = requestedSheet && normalizedColumn(requestedSheet) !== normalizedColumn(activeName)
      ? await readNamedBridgeRange(requestedSheet, range, signal)
      : await readRange(range, signal, String(params.gid || currentGid()));
    return {
      spreadsheetId: spreadsheetId(),
      gid: String(params.gid || currentGid()),
      sheet: requestedSheet || activeName,
      range,
      rows: rows.map((row) => ({ row: row.number, values: row.cells }))
    };
  }

  function bridgeRangeBounds(range) {
    const [start, end = start] = range.split(":");
    const startMatch = start.match(/^([A-Z]+)(\d+)$/);
    const endMatch = end.match(/^([A-Z]+)(\d+)$/);
    return {
      firstColumn: bridgeColumnNumber(startMatch[1]),
      lastColumn: bridgeColumnNumber(endMatch[1]),
      firstRow: Number(startMatch[2]),
      lastRow: Number(endMatch[2])
    };
  }

  function bridgeCellDiagnostics(cell, columnIndex, structuredCell, structuredColumn) {
    return {
      column: columnName(columnIndex),
      value: cell ? readableCellText(cell) : "",
      text: String(cell?.textContent || "").trim(),
      html: String(cell?.innerHTML || "").slice(0, 4_000),
      attributes: cell
        ? Object.fromEntries(Array.from(cell.attributes, (attribute) => [attribute.name, attribute.value]))
        : {},
      svgUses: cell
        ? Array.from(cell.querySelectorAll("svg use"), (use) =>
          use.getAttribute("href") || use.getAttribute("xlink:href") || ""
        ).filter(Boolean)
        : [],
      structured: {
        column: structuredColumn || null,
        cell: structuredCell || null
      }
    };
  }

  async function inspectBridgeRange(params, signal) {
    const range = normalizedBridgeRange(params.range);
    const requestedSheet = String(params.sheet || "").trim();
    const activeName = activeSheetName();
    const sheetName = requestedSheet || activeName;
    if (requestedSheet && normalizedColumn(requestedSheet) !== normalizedColumn(activeName)) {
      throw new Error("La inspección HTML requiere que la hoja solicitada sea la pestaña activa");
    }

    const bounds = bridgeRangeBounds(range);
    const width = bounds.lastColumn - bounds.firstColumn + 1;
    const height = bounds.lastRow - bounds.firstRow + 1;
    if (width <= 0 || height <= 0) throw new Error("El rango de inspección está invertido");
    if (width * height > 100) throw new Error("La inspección admite como máximo 100 celdas");

    const structuredRequest = readVisualizationRange(sheetName, range, signal).then(
      (table) => ({ table }),
      (error) => ({ error })
    );
    const [doc, structuredResult] = await Promise.all([
      fetchHtmlDocument(
        embedUrl(range, String(params.gid || currentGid())),
        signal,
        "La vista HTML tardó demasiado en responder",
        12_000
      ),
      structuredRequest
    ]);
    if (structuredResult.error && (structuredResult.error.name === "AbortError" || signal?.aborted)) {
      throw structuredResult.error;
    }

    const visualRows = new Map(Array.from(doc.querySelectorAll("tbody tr")).flatMap((tr) => {
      const rowHeader = tr.querySelector("th.row-headers-background");
      const number = Number(rowHeader?.textContent.trim());
      return Number.isFinite(number)
        ? [[number, Array.from(tr.querySelectorAll("td:not(.freezebar-cell)"))]]
        : [];
    }));
    const table = structuredResult.table;
    const rows = Array.from({ length: height }, (_, rowOffset) => {
      const rowNumber = bounds.firstRow + rowOffset;
      const visualCells = visualRows.get(rowNumber) || [];
      const structuredCells = table?.rows?.[rowOffset]?.c || [];
      return {
        row: rowNumber,
        cells: Array.from({ length: width }, (_, columnOffset) => bridgeCellDiagnostics(
          visualCells[columnOffset],
          bounds.firstColumn + columnOffset,
          structuredCells[columnOffset],
          table?.cols?.[columnOffset]
        ))
      };
    });

    return {
      spreadsheetId: spreadsheetId(),
      gid: String(params.gid || currentGid()),
      sheet: sheetName,
      range,
      structuredError: structuredResult.error?.message || null,
      rows
    };
  }

  function bridgeResultValues(result, expectedRows) {
    return expectedRows.map((row, rowIndex) => row.map((_, columnIndex) =>
      String(result.rows[rowIndex]?.values[columnIndex] ?? "")
    ));
  }

  async function verifyBridgeMutation(params, range, expectedRows) {
    let lastResult = null;
    for (const delay of [500, 1_000, 2_000]) {
      await wait(delay);
      lastResult = await readBridgeRange({ ...params, range }, undefined);
      if (JSON.stringify(bridgeResultValues(lastResult, expectedRows)) === JSON.stringify(expectedRows)) {
        return { verified: true, values: expectedRows };
      }
    }
    return { verified: false, values: bridgeResultValues(lastResult || { rows: [] }, expectedRows) };
  }

  function visibleBridgeSheets() {
    return visibleSheetNames().map((name) => ({
      name,
      gid: normalizedColumn(name) === normalizedColumn(activeSheetName()) ? currentGid() : null
    }));
  }

  async function executeCodexBridgeCommand(command) {
    const params = command?.params || {};
    if (command.action === "info") {
      return {
        spreadsheetId: spreadsheetId(),
        gid: currentGid(),
        sheet: activeSheetName(),
        selection: nameBoxValue(),
        sheets: visibleBridgeSheets(),
        capabilities: ["read", "inspect", "write", "clear"]
      };
    }
    if (command.action === "read") return readBridgeRange(params, undefined);
    if (command.action === "inspect") return inspectBridgeRange(params, undefined);
    if (command.action !== "write" && command.action !== "clear") {
      throw new Error(`Operación no soportada: ${command.action}`);
    }

    const targetSheet = String(params.sheet || activeSheetName()).trim();
    const selectedReference = nameBoxValue().split("!").pop() || `A${state.row || 1}`;
    const restoreReference = qualifiedReference(activeSheetName(), selectedReference);
    let range;
    let expectedRows;
    let operation;

    if (command.action === "write") {
      expectedRows = bridgeRows(params.values);
      range = bridgeWriteRange(params.start, expectedRows);
      operation = {
        reference: qualifiedReference(targetSheet, range.split(":")[0]),
        rows: expectedRows
      };
    } else {
      range = normalizedBridgeRange(params.range);
      const [start, end = start] = range.split(":");
      const startMatch = start.match(/^([A-Z]+)(\d+)$/);
      const endMatch = end.match(/^([A-Z]+)(\d+)$/);
      const width = bridgeColumnNumber(endMatch[1]) - bridgeColumnNumber(startMatch[1]) + 1;
      const height = Number(endMatch[2]) - Number(startMatch[2]) + 1;
      if (width <= 0 || height <= 0) throw new Error("El rango de limpieza está invertido");
      expectedRows = Array.from({ length: height }, () => Array(width).fill(""));
      operation = { action: "clear", reference: qualifiedReference(targetSheet, range) };
    }

    await writeRanges([operation], restoreReference);
    state.headerCache.clear();
    state.sheetCache.clear();
    const verification = await verifyBridgeMutation({ ...params, sheet: targetSheet }, range, expectedRows);
    if (normalizedColumn(targetSheet) === normalizedColumn(activeSheetName()) && state.row) {
      void loadRow(state.row, true);
    }
    return {
      spreadsheetId: spreadsheetId(),
      gid: String(params.gid || currentGid()),
      sheet: targetSheet,
      range,
      ...verification
    };
  }

  function runtimeBridgeMessage(type, payload) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      try {
        runtime.sendMessage({ source: "sheets-row-drawer-codex", type, payload }, (response) => {
          const runtimeError = globalThis.chrome?.runtime?.lastError;
          if (runtimeError) reject(new Error(runtimeError.message));
          else resolve(response || null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function pollCodexBridge() {
    try {
      const response = await runtimeBridgeMessage("poll", {
        spreadsheetId: spreadsheetId(),
        gid: currentGid(),
        sheet: activeSheetName()
      });
      const command = response?.command;
      if (command) {
        try {
          const result = await executeCodexBridgeCommand(command);
          await runtimeBridgeMessage("result", { id: command.id, ok: true, result });
        } catch (error) {
          await runtimeBridgeMessage("result", {
            id: command.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch {}
    setTimeout(pollCodexBridge, CODEX_BRIDGE_POLL_MS);
  }

  function pollSelection() {
    if (state.saving) return;
    const reference = nameBoxValue();
    const gid = currentGid();
    const normalizedReference = reference.split("!").pop().replace(/\$/g, "");
    const signature = `${gid}:${normalizedReference}`;
    if (!reference || signature === state.lastSelection) return;
    state.lastSelection = signature;
    if (state.propertyColumn !== null) closePropertyEditor();
    const row = selectedRow(reference);
    if (!row) {
      clearRelations();
      setRelatedStatus("Selecciona una fila para buscar relaciones.");
      setStatus("Selecciona una celda de la fila que quieres abrir", "busy");
      return;
    }
    if (row === 1) {
      ui.fields.replaceChildren();
      clearRelations();
      state.viewRow = null;
      state.viewGid = null;
      setRelatedStatus("La fila de encabezados no tiene relaciones.");
      syncPendingActions();
      ui.meta.textContent = "Fila de encabezados";
      setStatus("Selecciona una fila de datos debajo de los encabezados", "busy");
      return;
    }
    loadRow(row);
  }

  void ensureWorkspaceLoaded().finally(() => {
    renderSheetViewActions();
    setInterval(pollSelection, POLL_MS);
    pollSelection();
    void pollCodexBridge();
  });
})();
