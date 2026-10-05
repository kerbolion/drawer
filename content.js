import React from "react";
import { createPortal, flushSync } from "react-dom";
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
import Switch from "antd/es/switch/index.js";
import Tag from "antd/es/tag/index.js";
import TimePicker from "antd/es/time-picker/index.js";
import Tooltip from "antd/es/tooltip/index.js";
import {
  CalculatorOutlined,
  AppstoreOutlined,
  CalendarOutlined,
  CheckOutlined,
  CheckCircleOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  DragOutlined,
  LeftOutlined,
  LinkOutlined,
  MailOutlined,
  MoonOutlined,
  PhoneOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
  SunOutlined,
  TableOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
import esES from "antd/es/locale/es_ES.js";
import dayjs from "dayjs";
import "dayjs/locale/es.js";
import { CircleDollarSign, Clock3, Hash, ListChecks, Type } from "lucide-react";
import {
  antdTokens,
  darkAntdTokens,
  getWorkspaceThemeConfig,
  workspaceDarkTokens,
  workspaceTokens
} from "./theme.js";
import { createCloudAccountUi } from "./cloud-account.js";
import { WorkspaceSheetView } from "./workspace-sheet-view.jsx";

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
  const CACHE_PREFIX = "srd:v2";
  const CACHE_INDEX_KEY = `${CACHE_PREFIX}:index`;
  const WORKSPACE_PREFIX = "srd:workspace:v2";
  const THEME_STORAGE_KEY = "srd:theme-mode";
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

  function locallyStoredThemeMode() {
    try {
      return globalThis.localStorage?.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  let activeThemeMode = locallyStoredThemeMode();
  const themeListeners = new Set();
  const themeSnapshot = () => activeThemeMode;
  const subscribeToTheme = (listener) => {
    themeListeners.add(listener);
    return () => themeListeners.delete(listener);
  };

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
    primaryDrafts: new Map(),
    writeInteractionDepth: 0,
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
    propertyTarget: null,
    primaryCreation: null,
    pendingWrites: new Map(),
    sheetViewWrites: new Map(),
    sheetDataRevision: 0,
    sheetChangeTimer: null,
    sheetChangeRequest: 0,
    sheetViewMutationQueue: [],
    sheetViewMutationTimer: null,
    sheetViewMutationRunning: false,
    sheetViewMutationPromise: null,
    relations: [],
    relatedDrafts: new Map(),
    relatedDraftListeners: new Set(),
    relatedDraftCellListeners: new Map(),
    relatedDraftVersion: 0,
    relatedDraftNotifyTimer: null,
    activity: { row: false, relations: false, config: false },
    indicatorError: false,
    cloudRequired: Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.runtime?.sendMessage),
    cloudSession: null,
    cloudWorkspaceRevision: 0,
    cloudWorkspaceHydrated: false,
    cloudWorkspaceTimer: null,
    cloudWorkspaceWriteQueue: Promise.resolve(),
    workspaceRecordOverlay: false,
    sheetViewOpen: false,
    sheetViewRestorePanel: false
  };

  const host = document.createElement("div");
  host.id = "sheets-session-probe";
  host.dataset.status = "starting";
  host.dataset.themeSource = "workspace-antd";
  host.dataset.theme = activeThemeMode;
  host.dataset.writeVerification = "idle";
  document.documentElement.appendChild(host);

  const googleThemeStyles = document.createElement("style");
  googleThemeStyles.id = "sheets-row-drawer-google-theme";
  googleThemeStyles.textContent = `
    html[data-srd-theme="dark"] { background: #202124 !important; color-scheme: dark; }
    html[data-srd-theme="dark"] > body {
      background: #ffffff !important;
      filter: invert(90%) hue-rotate(180deg);
    }
    html[data-srd-theme="dark"] > body img,
    html[data-srd-theme="dark"] > body video {
      filter: invert(100%) hue-rotate(180deg);
    }
  `;
  (document.head || document.documentElement).appendChild(googleThemeStyles);
  document.documentElement.dataset.srdTheme = activeThemeMode;

  const shadow = host.attachShadow({ mode: "open" });
  const shellStyles = new CSSStyleSheet();
  shellStyles.replaceSync(`
    :host {
      all: initial;
      --srd-frame-bg: ${antdTokens.colorBgElevated};
      --srd-view-bg: ${antdTokens.colorBgContainer};
      --srd-frame-shadow: ${antdTokens.boxShadowSecondary};
    }
    :host([data-theme="dark"]) {
      --srd-frame-bg: ${darkAntdTokens.colorBgElevated};
      --srd-view-bg: ${darkAntdTokens.colorBgContainer};
      --srd-frame-shadow: ${darkAntdTokens.boxShadowSecondary};
    }
    .panel-frame {
      position: fixed; inset: 0 0 0 auto; z-index: 2147483647;
      width: min(720px, 94vw); height: 100vh; border: 0; background: var(--srd-frame-bg);
      box-shadow: var(--srd-frame-shadow);
    }
    .sheet-view-frame {
      position: fixed; inset: 0; z-index: 2147483646;
      width: 100vw; height: 100vh; border: 0; background: var(--srd-view-bg);
    }
    .panel-frame[hidden], .sheet-view-frame[hidden], .reopen[hidden] { display: none; }
    .reopen {
      box-sizing: border-box; position: fixed; z-index: 2147483645;
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

  const sheetViewFrame = document.createElement("iframe");
  sheetViewFrame.className = "sheet-view-frame";
  sheetViewFrame.title = "Vista de la hoja";
  sheetViewFrame.hidden = true;
  shadow.appendChild(sheetViewFrame);

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

  function panelThemeVariables(tokens, surfaces) {
    return `
      --workspace-bg: ${surfaces.bg};
      --workspace-surface: ${surfaces.surface};
      --workspace-surface-muted: ${surfaces.surfaceMuted};
      --workspace-surface-subtle: ${surfaces.surfaceSubtle};
      --workspace-surface-raised: ${surfaces.surfaceRaised};
      --workspace-border: ${surfaces.border};
      --workspace-border-soft: ${surfaces.borderSoft};
      --workspace-border-subtle: ${surfaces.borderSubtle};
      --workspace-text: ${surfaces.text};
      --workspace-text-body: ${surfaces.textBody};
      --workspace-text-secondary: ${surfaces.textSecondary};
      --workspace-text-muted: ${surfaces.textMuted};
      --workspace-text-disabled: ${surfaces.textDisabled};
      --workspace-primary: ${surfaces.primary};
      --workspace-primary-border: ${surfaces.primaryBorder};
      --workspace-primary-soft: ${surfaces.primarySoft};
      --workspace-primary-hover: ${surfaces.primaryHover};
      --workspace-shadow: ${surfaces.shadow};
      --workspace-shadow-soft: ${surfaces.shadowSoft};
      --antd-bg-container: ${tokens.colorBgContainer};
      --antd-bg-container-disabled: ${tokens.colorBgContainerDisabled};
      --antd-bg-elevated: ${tokens.colorBgElevated};
      --antd-border: ${tokens.colorBorder};
      --antd-border-secondary: ${tokens.colorBorderSecondary};
      --antd-error: ${tokens.colorError};
      --antd-error-hover: ${tokens.colorErrorHover};
      --antd-error-bg: ${tokens.colorErrorBg};
      --antd-error-border: ${tokens.colorErrorBorder};
      --antd-error-text: ${tokens.colorErrorText};
      --antd-fill-quaternary: ${tokens.colorFillQuaternary};
      --antd-fill-tertiary: ${tokens.colorFillTertiary};
      --antd-info-bg: ${tokens.colorInfoBg};
      --antd-info-border: ${tokens.colorInfoBorder};
      --antd-info-text: ${tokens.colorInfoText};
      --antd-primary: ${tokens.colorPrimary};
      --antd-primary-bg: ${tokens.colorPrimaryBg};
      --antd-primary-bg-hover: ${tokens.colorPrimaryBgHover};
      --antd-primary-hover: ${tokens.colorPrimaryHover};
      --antd-success: ${tokens.colorSuccess};
      --antd-success-bg: ${tokens.colorSuccessBg};
      --antd-success-border: ${tokens.colorSuccessBorder};
      --antd-success-text: ${tokens.colorSuccessText};
      --antd-text: ${tokens.colorText};
      --antd-text-disabled: ${tokens.colorTextDisabled};
      --antd-text-heading: ${tokens.colorTextHeading};
      --antd-text-secondary: ${tokens.colorTextSecondary};
      --antd-text-tertiary: ${tokens.colorTextTertiary};
      --antd-white: ${tokens.colorWhite};
      --antd-control-outline: ${tokens.controlOutline};
      --antd-shadow-secondary: ${tokens.boxShadowSecondary};
      --antd-shadow-tertiary: ${tokens.boxShadowTertiary};
    `;
  }

  const panelDocument = panelFrame.contentDocument;
  installTrustedHtmlBridge(panelFrame.contentWindow);
  panelDocument.documentElement.lang = "es";
  panelDocument.body.replaceChildren();
  const panelStyles = panelDocument.createElement("style");
  panelStyles.textContent = `
    :root {
      color-scheme: light;
      ${panelThemeVariables(antdTokens, workspaceTokens)}
    }
    :root[data-theme="dark"] {
      color-scheme: dark;
      ${panelThemeVariables(darkAntdTokens, workspaceDarkTokens)}
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%; margin: 0; overflow: hidden;
      background: var(--antd-bg-container); color: var(--antd-text);
      font: ${antdTokens.fontSize}px/${antdTokens.lineHeight} ${antdTokens.fontFamily};
    }
    button, input, textarea, select { font: inherit; }
    .drawer {
      width: 100%; height: 100%; background: var(--antd-bg-container); color: var(--antd-text);
      border-left: 1px solid var(--antd-border);
      display: flex; flex-direction: column;
    }
    .workspace-record-mask {
      position: fixed; inset: 0; z-index: 1090; background: rgba(0, 0, 0, .28);
      animation: workspace-record-mask-enter 180ms ease-out;
    }
    .workspace-record-mask[hidden] { display: none; }
    .drawer.is-workspace-record-overlay {
      position: fixed; z-index: 1100; inset: 0 0 0 auto; width: min(720px, 100%);
      box-shadow: var(--antd-shadow-secondary); animation: workspace-record-enter 180ms cubic-bezier(.2, 0, 0, 1);
    }
    @keyframes workspace-record-mask-enter { from { opacity: 0; } }
    @keyframes workspace-record-enter { from { transform: translateX(100%); } }
    .drawer > header {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 16px 24px; border-bottom: 1px solid var(--antd-border-secondary);
    }
    .drawer-title { min-width: 0; }
    .drawer-title h1 { margin: 0; color: var(--antd-text-heading); font-size: 18px; line-height: 1.25; }
    .drawer-title p { margin: 3px 0 0; color: var(--antd-text-tertiary); font-size: 12px; line-height: 1.35; }
    .drawer-title a { color: var(--antd-text); font-weight: 700; text-decoration: none; }
    .drawer-title a:hover { text-decoration: underline; text-underline-offset: 3px; }
    .header-actions {
      display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px;
    }
    .sheet-view-actions { display: inline-flex; align-items: center; gap: 2px; }
    .sheet-view-actions .ant-btn { color: var(--workspace-text-muted); }
    .sheet-view-actions .ant-btn:hover { color: var(--workspace-primary); }
    .theme-toggle { display: inline-flex; align-items: center; justify-content: center; }
    [data-theme-toggle] .ant-switch-inner-checked,
    [data-theme-toggle] .ant-switch-inner-unchecked {
      display: flex; align-items: center; justify-content: center;
    }
    [data-theme-toggle] .anticon {
      display: inline-flex; align-items: center; justify-content: center; line-height: 1;
      vertical-align: 0; transform: translateY(5px);
    }
    [data-theme-toggle] .anticon svg { display: block; }
    .icon-button {
      width: ${antdTokens.controlHeight}px; height: ${antdTokens.controlHeight}px;
      border: 0; border-radius: ${antdTokens.borderRadius}px; background: transparent;
      color: var(--antd-text-secondary); font-size: 20px; cursor: pointer;
    }
    .icon-button:hover { background: var(--antd-fill-tertiary); color: var(--antd-text); }
    .save-state {
      align-items: center; display: inline-flex; width: 28px; height: 28px; justify-content: center;
      font-size: 17px; line-height: 1; transition: color ${antdTokens.motionDurationMid};
    }
    .save-state.is-saving { color: var(--antd-primary); }
    .save-state.is-saved { color: #22c55e; }
    .save-state.is-pending { color: var(--antd-text-disabled); }
    .save-state.is-error { color: var(--antd-error); }
    .save-state-check, .save-state-spinner, .save-state-error { display: none; }
    .save-state.is-saving .save-state-spinner {
      display: block; width: 16px; height: 16px; border: 2px solid currentColor;
      border-right-color: transparent; border-radius: 50%; animation: save-state-spin .8s linear infinite;
    }
    .save-state.is-saved .save-state-check {
      display: inline-flex; animation: save-state-confirm .42s cubic-bezier(.2, .9, .25, 1.35);
    }
    .save-state.is-pending .save-state-check { display: inline-flex; opacity: .5; }
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
      margin-bottom: 14px; padding: 9px 12px; border: 1px solid var(--antd-success-border);
      border-radius: ${antdTokens.borderRadiusLG}px; background: var(--antd-success-bg); color: var(--antd-success-text);
      font-size: 12px;
    }
    .status.error { border-color: var(--antd-error-border); background: var(--antd-error-bg); color: var(--antd-error-text); }
    .status.busy { border-color: var(--antd-info-border); background: var(--antd-info-bg); color: var(--antd-info-text); }
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
    .field[hidden] { display: none !important; }
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
      background: var(--antd-primary-bg); color: var(--antd-primary); cursor: pointer;
      line-height: 1; opacity: 1; transition: color ${antdTokens.motionDurationMid}, background ${antdTokens.motionDurationMid};
    }
    .field-configure svg { display: block; width: 14px; height: 14px; }
    .field-configure:hover, .field-configure:focus-visible { background: var(--antd-primary-bg-hover); color: var(--antd-primary-hover); }
    .header-type { display: inline-flex; align-items: center; justify-content: center; }
    .field-editor { min-width: 0; padding-top: 0; }
    .antd-field-control { width: 100%; min-width: 0; }
    .antd-field-control > .ant-input-number,
    .antd-field-control > .ant-picker,
    .antd-field-control > .ant-select,
    .antd-field-control > .ant-input,
    .antd-field-control > .ant-space-compact { width: 100%; }
    .property-value-compact { width: 100%; min-width: 0; }
    .property-value-compact > :not(.ant-btn) { min-width: 0; flex: 1 1 auto; }
    .property-value-compact > .ant-btn { flex: 0 0 auto; height: auto; align-self: stretch; }
    .property-value-compact.is-checkbox > .ant-checkbox-wrapper {
      min-height: ${antdTokens.controlHeight}px; border: 1px solid var(--antd-border); border-radius: ${antdTokens.borderRadius}px 0 0 ${antdTokens.borderRadius}px;
      padding: 4px 11px; background: var(--antd-bg-container); color: var(--antd-text);
    }
    .property-value-compact.is-checkbox > .ant-checkbox-wrapper.ant-checkbox-wrapper-disabled { background: var(--antd-bg-container-disabled); }
    .field-copy-button.is-copied { border-color: var(--antd-success); color: var(--antd-success); }
    .fields[aria-busy="true"] { cursor: progress; }
    .property-drawer {
      position: fixed; inset: 0; z-index: 1120; display: flex; flex-direction: column;
      background: var(--antd-bg-container); animation: property-enter ${antdTokens.motionDurationMid} ease-out;
    }
    .property-drawer[hidden] { display: none; }
    .account-drawer {
      position: fixed; inset: 0; z-index: 1130; display: flex; flex-direction: column;
      background: var(--antd-bg-container); animation: property-enter ${antdTokens.motionDurationMid} ease-out;
    }
    .account-drawer[hidden] { display: none; }
    .cloud-account-body { max-width: 820px; width: 100%; margin: 0 auto; }
    .cloud-card {
      display: grid; gap: 14px; margin-bottom: 14px; padding: 18px;
      border: 1px solid var(--workspace-border); border-radius: 8px;
      background: var(--workspace-surface); box-shadow: 0 6px 18px var(--workspace-shadow-soft);
    }
    .cloud-card h3 { margin: 0; color: var(--workspace-text); font-size: 15px; }
    .cloud-copy { margin: 0; color: var(--workspace-text-muted); font-size: 12px; }
    .cloud-danger-zone { border-color: var(--antd-error-border); background: var(--antd-error-bg); }
    .cloud-danger-zone h3 { color: var(--antd-error-text); }
    .cloud-form-item { display: grid; gap: 6px; color: var(--workspace-text); font-size: 13px; font-weight: 600; }
    .cloud-form-label { display: block; }
    .cloud-control-host { width: 100%; min-width: 0; font-weight: 400; }
    .cloud-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .cloud-message { margin-bottom: 14px; padding: 9px 12px; border: 1px solid; border-radius: 6px; font-size: 12px; }
    .cloud-message.error { border-color: var(--antd-error-border); background: var(--antd-error-bg); color: var(--antd-error-text); }
    .cloud-message.success { border-color: var(--antd-success-border); background: var(--antd-success-bg); color: var(--antd-success-text); }
    .cloud-account-summary {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px;
      margin-bottom: 14px; padding: 14px 16px; border: 1px solid var(--workspace-border); border-radius: 8px;
      background: var(--workspace-surface);
    }
    .cloud-account-summary > div { display: grid; gap: 2px; min-width: 0; }
    .cloud-account-summary strong, .cloud-account-summary span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cloud-account-summary > div span { color: var(--workspace-text-muted); font-size: 12px; }
    .cloud-avatar {
      display: inline-flex; width: 38px; height: 38px; align-items: center; justify-content: center;
      border-radius: 50%; background: var(--antd-primary-bg); color: var(--antd-primary); font-weight: 700;
    }
    .cloud-status { padding: 3px 8px; border-radius: 999px; background: var(--antd-success-bg); color: var(--antd-success-text); font-size: 11px; }
    .cloud-status.suspended { background: var(--antd-error-bg); color: var(--antd-error-text); }
    .cloud-tabs { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--workspace-border); }
    .cloud-tabs button { border: 0; border-bottom: 2px solid transparent; padding: 8px 10px; background: transparent; color: var(--workspace-text-muted); cursor: pointer; }
    .cloud-tabs button.is-active { border-bottom-color: var(--workspace-primary); color: var(--workspace-primary); font-weight: 600; }
    .cloud-details { display: grid; grid-template-columns: minmax(100px, auto) minmax(0, 1fr); gap: 7px 14px; margin: 0; font-size: 12px; }
    .cloud-details dt { color: var(--workspace-text-muted); }
    .cloud-details dd { margin: 0; color: var(--workspace-text); font-weight: 600; }
    .cloud-admin-list { display: grid; gap: 14px; }
    .cloud-admin-card { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cloud-admin-card h3, .cloud-admin-card .cloud-copy, .cloud-admin-card .cloud-actions { grid-column: 1 / -1; }
    .account-button { position: relative; font-size: 0; }
    .account-button svg { width: 17px; height: 17px; }
    .account-button[data-authenticated="true"]::after {
      content: ""; position: absolute; right: 4px; bottom: 4px; width: 6px; height: 6px;
      border: 1px solid var(--antd-bg-container); border-radius: 50%; background: var(--antd-success);
    }
    .property-header {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 16px 24px; border-bottom: 1px solid var(--antd-border-secondary);
    }
    .property-header h2 { margin: 0; font-size: 16px; }
    .property-actions { display: flex; gap: 8px; }
    .secondary-button, .primary-button, .danger-button {
      min-height: ${antdTokens.controlHeight}px; border-radius: ${antdTokens.borderRadius}px;
      padding: 4px 15px; font-weight: 500; cursor: pointer;
    }
    .secondary-button { border: 1px solid var(--antd-border); background: var(--antd-bg-container); color: var(--antd-text); }
    .secondary-button:hover { border-color: var(--antd-primary); color: var(--antd-primary); }
    .primary-button { border: 1px solid var(--antd-primary); background: var(--antd-primary); color: var(--antd-white); }
    .primary-button:hover { border-color: var(--antd-primary-hover); background: var(--antd-primary-hover); }
    .danger-button { border: 1px solid var(--antd-error); background: var(--antd-error); color: var(--antd-white); }
    .danger-button:hover { border-color: var(--antd-error-hover); background: var(--antd-error-hover); }
    .danger-button:disabled { border-color: var(--antd-border); background: var(--antd-bg-container-disabled); color: var(--antd-text-disabled); cursor: default; }
    .property-body { flex: 1; overflow: auto; padding: 24px; background: var(--antd-bg-container); }
    .property-form-item { margin-bottom: 22px; }
    .property-form-item > label { display: block; margin-bottom: 8px; color: var(--antd-text); font-weight: 600; }
    .property-input {
      width: 100%; min-height: ${antdTokens.controlHeightLG}px; border: 1px solid var(--antd-border);
      border-radius: ${antdTokens.borderRadius}px; padding: 7px 11px; background: var(--antd-bg-container);
      color: var(--antd-text);
    }
    textarea.property-input { min-height: 116px; resize: vertical; line-height: 1.5; }
    .property-input:hover { border-color: var(--antd-primary-hover); }
    .property-input:focus { border-color: var(--antd-primary); outline: 0; box-shadow: 0 0 0 ${antdTokens.controlOutlineWidth}px var(--antd-control-outline); }
    .property-type-host { width: 100%; }
    .property-type-option { display: inline-flex; align-items: center; gap: 8px; }
    .property-type-option-icon {
      display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px;
      border-radius: 50%; background: var(--antd-primary-bg); color: var(--antd-primary);
    }
    .property-type-option-icon svg { display: block; width: 14px; height: 14px; }
    .property-help { margin-top: 6px; color: var(--antd-text-tertiary); font-size: 12px; }
    .property-protection {
      padding: 10px 12px; border: 1px solid var(--antd-border); border-radius: ${antdTokens.borderRadius}px;
      background: var(--antd-fill-quaternary);
    }
    .property-protection .property-help { margin: 4px 0 0 24px; }
    .property-random-id {
      display: grid; gap: 12px; margin-bottom: 22px; padding: 12px;
      border: 1px solid var(--antd-border); border-radius: ${antdTokens.borderRadius}px;
      background: var(--antd-fill-quaternary);
    }
    .property-random-id-length { display: grid; grid-template-columns: minmax(0, 1fr) 120px; align-items: center; gap: 12px; }
    .property-random-id-length > span { color: var(--antd-text); font-weight: 600; }
    .property-random-id-length .ant-input-number { width: 100%; }
    .property-random-id .property-help { margin: -4px 0 0 24px; }
    .property-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .option-editor { border: 1px solid var(--antd-border); border-radius: ${antdTokens.borderRadius}px; padding: 10px; }
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
      background: var(--antd-fill-quaternary); color: var(--antd-text-secondary); font-size: 12px;
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
      background: var(--antd-primary-bg); color: var(--antd-primary);
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
    .related-record-drawer-root { z-index: 1100 !important; }
    .related-record-drawer-root .ant-drawer-content-wrapper { width: min(720px, 100%) !important; }
    .related-record-drawer .ant-drawer-header { background: var(--workspace-surface); border-bottom-color: var(--workspace-border-soft); }
    .related-record-drawer .ant-drawer-body { padding: 8px 28px 32px; background: var(--workspace-bg); }
    .related-record-drawer .ant-drawer-footer { padding: 12px 24px 16px; background: var(--workspace-surface); border-top-color: var(--workspace-border-soft); }
    .related-record-page { max-width: 760px; margin: 0 auto; }
    .related-drawer-title { margin: 12px 0 22px; color: var(--workspace-text); font-size: 28px; line-height: 1.15; overflow-wrap: anywhere; }
    .related-drawer-fields { width: 100%; }
    .related-field-icon { cursor: pointer; }
    .related-drawer-footer { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; }
    .related-drawer-footer .ant-btn { min-height: ${antdTokens.controlHeightLG}px; font-weight: 600; }
    .relation-pagination { display: flex; justify-content: center; padding: 12px 14px 0; }
    .sheet-view-root { width: 100%; height: 100%; }
    .sheet-view-panel { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; flex-direction: column; background: var(--workspace-bg); }
    .sheet-view-panel-header { display: flex; flex: 0 0 auto; min-height: 54px; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 18px; border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface); }
    .sheet-view-panel-title { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; gap: 10px; color: var(--workspace-text); font-size: 16px; font-weight: 700; }
    .workspace-document-name { flex: 0 1 auto; max-width: min(320px, 28vw); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sheet-view-panel-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; }
    .sheet-view-panel-actions .save-state { margin: 0 2px; }
    .sheet-view-panel.is-saving .sheet-view-panel-body { pointer-events: none; }
    .sheet-view-panel-body { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
    .sheet-view-surface { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; flex-direction: column; }
    .workspace-browser { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; background: var(--workspace-bg); }
    .workspace-browser-sheets { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; gap: 4px; overflow-x: auto; padding: 2px 0; }
    .workspace-browser-sheet { display: inline-flex; flex: 0 0 auto; min-width: 0; max-width: 220px; align-items: center; gap: 7px; border: 0; border-radius: 6px; padding: 7px 10px; background: transparent; color: var(--workspace-text-secondary); cursor: pointer; }
    .workspace-browser-sheet span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .workspace-browser-sheet:hover { background: var(--workspace-surface-muted); color: var(--workspace-primary); }
    .workspace-browser-sheet.is-active { background: var(--workspace-primary-soft); color: var(--workspace-primary); font-weight: 700; }
    .workspace-browser-main { position: relative; display: flex; width: 100%; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }
    .workspace-board-header { display: flex; flex: 0 0 auto; min-height: 60px; align-items: center; justify-content: space-between; gap: 18px; padding: 10px 16px; border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface); }
    .workspace-board-heading { display: flex; min-width: 0; align-items: baseline; gap: 10px; }
    .workspace-board-heading h2 { margin: 0; overflow: hidden; color: var(--workspace-text); font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
    .workspace-board-heading span { flex: 0 0 auto; color: var(--workspace-text-muted); font-size: 12px; }
    .workspace-board-tabs { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
    .workspace-board-content { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }
    .workspace-browser-error { flex: 0 0 auto; margin: 10px 12px 0; }
    .workspace-browser-loading { display: flex; flex: 1; align-items: center; justify-content: center; }
    .workspace-table-view { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; background: var(--workspace-surface); }
    .workspace-table-toolbar { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface-raised); }
    .workspace-table-filters { display: flex; min-width: 0; flex: 1; flex-wrap: wrap; align-items: center; gap: 6px; }
    .workspace-table-filter { display: flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid var(--workspace-border); border-radius: 6px; background: var(--workspace-surface); }
    .workspace-table-filter .ant-input-affix-wrapper { width: 150px; }
    .workspace-table-columns { position: relative; flex: 0 0 auto; }
    .workspace-table-columns summary { list-style: none; padding: 6px 10px; border: 1px solid var(--workspace-border); border-radius: 6px; color: var(--workspace-text-secondary); cursor: pointer; user-select: none; }
    .workspace-table-columns summary::-webkit-details-marker { display: none; }
    .workspace-table-columns-menu { position: absolute; z-index: 8; top: calc(100% + 5px); right: 0; display: grid; width: 220px; max-height: 320px; gap: 8px; overflow: auto; padding: 12px; border: 1px solid var(--workspace-border); border-radius: 8px; background: var(--workspace-surface); box-shadow: 0 12px 32px var(--workspace-shadow); }
    .workspace-table-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
    .workspace-data-table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
    .workspace-data-table th { position: sticky; z-index: 2; top: 0; min-width: 190px; padding: 9px 10px; border-right: 1px solid var(--workspace-border-subtle); border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface-muted); color: var(--workspace-text-secondary); font-size: 12px; font-weight: 700; text-align: left; }
    .workspace-data-table td { position: relative; z-index: 0; min-width: 190px; max-width: 320px; height: 48px; overflow: hidden; padding: 5px 8px; border-right: 1px solid var(--workspace-border-subtle); border-bottom: 1px solid var(--workspace-border-subtle); background: var(--workspace-surface); vertical-align: middle; }
    .workspace-data-table tbody tr:hover td { background: var(--workspace-surface-raised); }
    .workspace-data-table .workspace-table-select { left: 0; width: 44px; min-width: 44px; max-width: 44px; text-align: center; }
    .workspace-data-table .workspace-table-row-number { width: 54px; min-width: 54px; max-width: 54px; color: var(--workspace-text-muted); text-align: center; }
    .workspace-data-table .workspace-table-actions { position: sticky; z-index: 5; right: 0; width: 124px; min-width: 124px; max-width: 124px; overflow: visible; background: var(--workspace-surface-raised); box-shadow: -5px 0 8px -8px var(--workspace-shadow); white-space: nowrap; }
    .workspace-data-table th.workspace-table-actions { z-index: 6; background: var(--workspace-surface-muted); }
    .workspace-data-table tbody tr:hover td.workspace-table-actions { background: var(--workspace-surface-raised); }
    .workspace-table-column-heading { display: grid; min-width: 0; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 1px 7px; }
    .workspace-table-column-heading .property-type-icon { grid-row: 1 / span 2; width: 26px; min-height: 26px; }
    .workspace-table-column-heading > span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .workspace-table-column-heading small { color: var(--workspace-text-muted); font-size: 10px; font-weight: 400; }
    .workspace-table-cell-editor { min-width: 0; width: 100%; max-width: 100%; overflow: hidden; }
    .workspace-table-cell-editor > .ant-input-number,
    .workspace-table-cell-editor > .ant-picker,
    .workspace-table-cell-editor > .ant-select,
    .workspace-table-cell-editor > .ant-input,
    .workspace-table-cell-editor > .ant-space-compact { width: 100%; min-width: 0; max-width: 100%; }
    .workspace-table-cell-editor > .ant-space-compact > * { min-width: 0; }
    .workspace-table-cell-editor > .ant-space-compact > .ant-btn { flex: 0 0 auto; }
    .workspace-table-footer { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--workspace-border); background: var(--workspace-surface); color: var(--workspace-text-muted); font-size: 12px; }
    .workspace-deck-view { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; background: var(--workspace-surface-muted); }
    .workspace-deck-toolbar { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface-raised); }
    .workspace-deck-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 12px; }
    .workspace-deck-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); align-content: start; gap: 10px; }
    .workspace-deck-card { min-width: 0; border: 1px solid var(--workspace-border); border-radius: 8px; padding: 12px; background: var(--workspace-surface); box-shadow: 0 6px 18px var(--workspace-shadow-soft); cursor: pointer; }
    .workspace-deck-card:hover, .workspace-deck-card:focus-visible { border-color: var(--workspace-primary-border); outline: 0; box-shadow: 0 8px 22px var(--workspace-shadow); }
    .workspace-deck-card-head { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }
    .workspace-deck-card-head > strong { overflow: hidden; color: var(--workspace-text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .workspace-deck-fields { display: grid; gap: 7px; margin-top: 10px; }
    .workspace-deck-field { display: grid; min-width: 0; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 2px 10px; }
    .workspace-deck-field-icon { grid-row: 1 / span 2; width: 34px; min-height: 34px; }
    .workspace-deck-field-icon svg { width: 12px; height: 12px; }
    .workspace-deck-field > span:not(.property-type-icon), .workspace-deck-empty { color: var(--workspace-text-muted); font-size: 11px; }
    .workspace-deck-field strong { overflow: hidden; color: var(--workspace-text); font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 820px) {
      .sheet-view-panel-header { align-items: flex-start; flex-wrap: wrap; }
      .sheet-view-panel-title { flex-basis: 100%; }
      .workspace-document-name { max-width: 40vw; }
      .workspace-board-header { align-items: flex-start; flex-direction: column; }
      .workspace-deck-toolbar { align-items: stretch; flex-direction: column; }
      .workspace-deck-toolbar .ant-input-affix-wrapper { width: 100% !important; }
    }
    .sheet-view-loading, .sheet-view-empty {
      display: flex; flex: 1; min-height: 320px; align-items: center; justify-content: center; padding: 32px;
      background: var(--workspace-surface);
    }
    .view-controls {
      display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px; border-bottom: 1px solid var(--workspace-border); background: var(--workspace-surface);
    }
    .view-controls .view-search { width: min(280px, 100%); }
    .kanban-settings { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
    .kanban-view-mode { min-width: 180px; }
    .kanban-setting { display: inline-flex; align-items: center; gap: 6px; color: var(--workspace-text-secondary); font-size: 12px; white-space: nowrap; }
    .kanban-setting .ant-input-number { width: 72px; }
    .kanban-view, .calendar-view { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
    .kanban-board {
      flex: 1; min-height: 0; gap: 12px; overflow: auto; padding: 12px; background: var(--workspace-surface-muted);
    }
    .kanban-board--grid {
      display: grid; grid-template-columns: repeat(var(--kanban-real-columns, var(--kanban-columns, 3)), minmax(300px, 1fr));
      align-content: start; align-items: start;
    }
    .kanban-board--row {
      display: grid; grid-auto-flow: column; grid-auto-columns: minmax(300px, 320px); grid-template-rows: minmax(0, 1fr); align-items: stretch;
    }
    .kanban-column {
      display: flex; width: 100%; height: var(--kanban-height, 600px); min-width: 0; min-height: 150px; flex-direction: column; padding: 10px; border: 1px solid var(--workspace-border);
      border-radius: 6px; background: var(--workspace-surface); transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
    }
    .kanban-board--row .kanban-column { height: auto; min-height: 0; max-height: none; }
    .kanban-column-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; cursor: grab; }
    .kanban-column-header:active { cursor: grabbing; }
    .kanban-column.dragging { opacity: .35; }
    .kanban-drag-image {
      position: fixed; z-index: 10000; top: 0; left: 0; margin: 0; opacity: 1; pointer-events: none;
      transition: none; will-change: transform;
    }
    .kanban-column-title { display: flex; min-width: 0; align-items: center; gap: 6px; color: var(--workspace-text); font-weight: 700; }
    .kanban-column-title .ant-tag { max-width: 190px; margin-inline-end: 0; overflow: hidden; text-overflow: ellipsis; }
    .kanban-column-stats { display: grid; flex: 0 0 auto; gap: 2px; justify-items: end; }
    .kanban-count, .kanban-total { color: var(--workspace-text-muted); font-size: 12px; }
    .kanban-total { color: var(--workspace-text); font-weight: 700; }
    .kanban-cards { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 8px; overflow-y: auto; padding: 10px; }
    .kanban-cards:has(.kanban-card-shell.dragging) .kanban-empty-drop { display: none; }
    .kanban-card-shell {
      cursor: grab; touch-action: none; user-select: none;
    }
    .kanban-card-shell:active { cursor: grabbing; }
    .kanban-card-shell.is-protected, .kanban-card-shell.is-protected:active { cursor: default; }
    .kanban-card-shell.dragging { opacity: .35; }
    .kanban-card-shell.is-moving { opacity: .55; pointer-events: none; }
    .kanban-card-shell.is-moving { animation: kanban-card-settle 180ms cubic-bezier(.2, 0, 0, 1); }
    .kanban-card { border-color: var(--workspace-border); background: var(--workspace-surface); transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
    .kanban-card:hover { border-color: var(--workspace-primary-border); box-shadow: 0 8px 22px var(--workspace-shadow); }
    .kanban-card .ant-card-head { min-height: 38px; padding: 0 10px; }
    .kanban-card .ant-card-head-title { padding: 8px 0; }
    .kanban-card .ant-card-body { padding: 10px; }
    .kanban-card--title-only .ant-card-head { border-bottom: 0; }
    .kanban-card--title-only .ant-card-body { display: none; }
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
    @keyframes kanban-card-settle {
      from { transform: scale(.98); }
      to { transform: scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .kanban-card, .kanban-card-shell.is-moving { animation: none !important; transition: none !important; }
    }
    @media (max-width: 820px) {
      .view-controls { align-items: stretch; flex-direction: column; }
      .kanban-settings { flex-wrap: wrap; justify-content: flex-start; }
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
    .drawer > footer { min-width: 0; padding: 12px 24px 16px; border-top: 1px solid var(--antd-border-secondary); background: var(--antd-bg-container); }
    .meta { margin-bottom: 9px; color: var(--antd-text-tertiary); font-size: 11px; }
    .footer-actions { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; }
    .cancel, .save {
      min-height: ${antdTokens.controlHeightLG}px; border-radius: ${antdTokens.borderRadius}px;
      padding: 6px 15px; font-weight: 600; cursor: pointer; transition: color ${antdTokens.motionDurationMid}, border-color ${antdTokens.motionDurationMid}, background ${antdTokens.motionDurationMid};
    }
    .cancel {
      min-width: 112px; border: 1px solid var(--antd-border); background: var(--antd-bg-container);
      color: var(--antd-text);
    }
    .cancel:hover { border-color: var(--antd-primary); color: var(--antd-primary); }
    .save {
      width: 100%; border: 1px solid var(--antd-primary);
      background: var(--antd-primary); color: var(--antd-white); box-shadow: var(--antd-shadow-tertiary);
    }
    .save:hover { background: var(--antd-primary-hover); border-color: var(--antd-primary-hover); }
    .cancel:disabled, .save:disabled { border-color: var(--antd-bg-container-disabled); background: var(--antd-bg-container-disabled); color: var(--antd-text-disabled); box-shadow: none; cursor: default; }
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
      .cloud-admin-card { grid-template-columns: 1fr; }
      .cloud-admin-card h3, .cloud-admin-card .cloud-copy, .cloud-admin-card .cloud-actions { grid-column: auto; }
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

  const sheetViewDocument = sheetViewFrame.contentDocument;
  installTrustedHtmlBridge(sheetViewFrame.contentWindow);
  sheetViewDocument.documentElement.lang = "es";
  sheetViewDocument.body.replaceChildren();
  const sheetViewStyles = sheetViewDocument.createElement("style");
  sheetViewStyles.textContent = panelStyles.textContent;
  sheetViewDocument.head.appendChild(sheetViewStyles);
  const sheetViewRoot = sheetViewDocument.createElement("div");
  sheetViewRoot.className = "sheet-view-root";
  sheetViewDocument.body.appendChild(sheetViewRoot);

  function persistThemeMode(mode) {
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, mode);
    } catch {}
    try {
      const area = storageArea();
      if (area) void area.set({ [THEME_STORAGE_KEY]: mode });
    } catch {}
  }

  function applyThemeMode(mode, { persist = false } = {}) {
    const nextMode = mode === "dark" ? "dark" : "light";
    const changed = nextMode !== activeThemeMode;
    activeThemeMode = nextMode;
    host.dataset.theme = nextMode;
    document.documentElement.dataset.srdTheme = nextMode;
    for (const frameDocument of [panelDocument, sheetViewDocument]) {
      frameDocument.documentElement.dataset.theme = nextMode;
      frameDocument.body.dataset.theme = nextMode;
    }
    if (persist) persistThemeMode(nextMode);
    if (changed) {
      for (const listener of themeListeners) listener();
    }
  }

  async function hydrateThemeMode() {
    const area = storageArea();
    if (!area) return;
    try {
      const stored = await area.get(THEME_STORAGE_KEY);
      const mode = stored?.[THEME_STORAGE_KEY];
      if (mode === "dark" || mode === "light") applyThemeMode(mode);
    } catch {}
  }

  function ThemeScope({ child, targetDocument }) {
    const mode = React.useSyncExternalStore(subscribeToTheme, themeSnapshot, themeSnapshot);
    return React.createElement(
      StyleProvider,
      { container: targetDocument.head },
      React.createElement(
        ConfigProvider,
        {
          theme: getWorkspaceThemeConfig(mode === "dark"),
          locale: workspaceLocale,
          getPopupContainer: () => targetDocument.body
        },
        child
      )
    );
  }

  applyThemeMode(activeThemeMode);
  void hydrateThemeMode();

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    if (event.newValue === "dark" || event.newValue === "light") applyThemeMode(event.newValue);
  });
  try {
    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      const mode = areaName === "local" ? changes?.[THEME_STORAGE_KEY]?.newValue : null;
      if (mode === "dark" || mode === "light") applyThemeMode(mode);
    });
  } catch {}

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
    return React.createElement(ThemeScope, { child, targetDocument: panelDocument });
  }

  function sheetViewTree(child) {
    return React.createElement(ThemeScope, { child, targetDocument: sheetViewDocument });
  }

  function ThemeToggleControl() {
    const mode = React.useSyncExternalStore(subscribeToTheme, themeSnapshot, themeSnapshot);
    const darkMode = mode === "dark";
    return React.createElement(Switch, {
      checked: darkMode,
      checkedChildren: React.createElement(MoonOutlined),
      unCheckedChildren: React.createElement(SunOutlined),
      title: darkMode ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
      "aria-label": darkMode ? "Cambiar a modo claro" : "Cambiar a modo oscuro",
      "data-theme-toggle": mode,
      onChange: (checked) => applyThemeMode(checked ? "dark" : "light", { persist: true })
    });
  }

  function setSheetViewHostOpen(open, title = "Vista de la hoja") {
    if (open) {
      if (!state.sheetViewOpen) state.sheetViewRestorePanel = !panelFrame.hidden;
      state.sheetViewOpen = true;
      sheetViewFrame.title = title;
      sheetViewFrame.hidden = false;
      if (!state.workspaceRecordOverlay) panelFrame.hidden = true;
      return;
    }
    if (!state.sheetViewOpen) return;
    state.sheetViewOpen = false;
    sheetViewFrame.hidden = true;
    if (state.sheetViewRestorePanel && !state.workspaceRecordOverlay) panelFrame.hidden = false;
    state.sheetViewRestorePanel = false;
  }

  function createCloudFormControl({
    name = "",
    type = "text",
    value = "",
    autocomplete = "off",
    min,
    disabled = false,
    options = [],
    onChange
  }) {
    const host = element("div", "cloud-control-host");
    const reactRoot = createRoot(host);
    let currentValue = value ?? "";
    let baseDisabled = Boolean(disabled);
    let busy = false;
    let destroyed = false;
    let initialized = false;

    const updateValue = (nextValue) => {
      currentValue = nextValue ?? "";
      onChange?.(currentValue);
      renderControl();
    };

    const renderControl = () => {
      if (destroyed) return;
      const isDisabled = baseDisabled || busy;
      const fullWidth = { width: "100%" };
      let control;

      if (type === "select") {
        control = React.createElement(Select, {
          value: currentValue,
          disabled: isDisabled,
          options,
          onChange: updateValue,
          style: fullWidth
        });
      } else if (type === "number") {
        control = React.createElement(InputNumber, {
          name,
          value: currentValue === "" ? null : Number(currentValue),
          min: min === "" || min === undefined ? undefined : Number(min),
          disabled: isDisabled,
          controls: true,
          onChange: updateValue,
          style: fullWidth
        });
      } else if (type === "datetime") {
        const pickerValue = currentValue && dayjs(currentValue).isValid() ? dayjs(currentValue) : null;
        control = React.createElement(DatePicker, {
          name,
          value: pickerValue,
          disabled: isDisabled,
          allowClear: true,
          locale: datePickerLocale,
          popupClassName: "workspace-date-picker-popup",
          placement: "bottomRight",
          showTime: { format: "HH:mm" },
          format: "DD/MM/YYYY HH:mm",
          onChange: (date) => updateValue(date ? date.format("YYYY-MM-DDTHH:mm") : ""),
          style: fullWidth
        });
      } else {
        const Component = type === "password" ? Input.Password : Input;
        control = React.createElement(Component, {
          name,
          value: String(currentValue),
          type: type === "email" ? "email" : undefined,
          autoComplete: autocomplete,
          disabled: isDisabled,
          onChange: (event) => updateValue(event.target.value),
          style: fullWidth
        });
      }

      const tree = antdTree(control);
      if (!initialized) {
        flushSync(() => reactRoot.render(tree));
        initialized = true;
      } else {
        reactRoot.render(tree);
      }
    };

    const adapter = {
      element: host,
      get value() { return currentValue; },
      set value(nextValue) {
        currentValue = nextValue ?? "";
        renderControl();
      },
      get disabled() { return baseDisabled; },
      set disabled(nextValue) {
        baseDisabled = Boolean(nextValue);
        renderControl();
      },
      setBusy(nextValue) {
        busy = Boolean(nextValue);
        renderControl();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        reactRoot.unmount();
      }
    };

    renderControl();
    return adapter;
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

  function sheetViewKanbanTotal(columns, rows) {
    const totalColumn = columns.find((column) => column.type === "currency")
      || columns.find((column) => column.type === "number");
    if (!totalColumn) return "";

    const total = rows.reduce((sum, row) => {
      const number = parseNumber(row.cells[totalColumn.index], totalColumn);
      return number === null ? sum : sum + number;
    }, 0);
    if (!total) return "";

    if (totalColumn.type === "currency") {
      return `${totalColumn.currencySymbol || "$"}${total.toFixed(Number(totalColumn.currencyDecimals ?? 2))}`;
    }
    return String(total);
  }

  function SheetViewEmpty({ description }) {
    return React.createElement(
      "div",
      { className: "sheet-view-empty" },
      React.createElement(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description })
    );
  }

  function KanbanCardContent({ columns, row, statusColumn, titleColumn }) {
    const fields = columns.filter((column) => (
      column.index !== statusColumn.index
      && column.index !== titleColumn?.index
      && String(row.cells[column.index] || "").trim()
    )).slice(0, 3);
    const titleOnly = fields.length === 0;

    return React.createElement(
      Card,
      {
        className: `kanban-card${titleOnly ? " kanban-card--title-only" : ""}`,
        size: "small",
        variant: "outlined",
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
        { className: "kanban-field", key: `${column.id}:${column.index}` },
        React.createElement("span", { className: "property-type-icon" }, typeBadge(column.type, 12)),
        React.createElement("span", null, column.name),
        React.createElement("strong", null, sheetViewCellLabel(row.cells[column.index], column) || "Sin valor")
      ))
    );
  }

  function NativeKanbanCard({ columns, moving, onOpenRow, row, statusColumn, suppressOpenRef, titleColumn }) {
    return React.createElement(
      "div",
      {
        className: ["kanban-card-shell", "card", moving ? "is-moving" : "", statusColumn.protected ? "is-protected" : ""].filter(Boolean).join(" "),
        "data-sheet-row": String(row.number),
        draggable: !moving && !statusColumn.protected,
        onDoubleClick: () => {
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

  function KanbanColumn({ columns, group, groupRows, movingRows, onOpenRow, statusColumn, suppressOpenRef, titleColumn, total, visibleRows }) {
    return React.createElement(
      "section",
      {
        className: "kanban-column column",
        "data-kanban-group": group.id
      },
      React.createElement(
        "div",
        { className: "kanban-column-header", draggable: true },
        React.createElement(
          "div",
          { className: "kanban-column-title" },
          group.color ? optionTag(group.label, group.color) : React.createElement("span", null, group.label)
        ),
        React.createElement(
          "div",
          { className: "kanban-column-stats" },
          total ? React.createElement("span", { className: "kanban-total" }, total) : null,
          React.createElement("span", { className: "kanban-count" }, String(groupRows.length))
        )
      ),
      React.createElement(
        "div",
        { className: "kanban-cards cards" },
        ...(visibleRows.length ? visibleRows.map((row) => React.createElement(NativeKanbanCard, {
          columns,
          key: row.number,
          moving: movingRows.includes(row.number),
          onOpenRow,
          row,
          statusColumn,
          suppressOpenRef,
          titleColumn
        })) : [React.createElement("div", { className: "kanban-empty-drop", key: "empty" }, "Arrastra registros aquí.")])
      )
    );
  }

  function SheetKanban({ table, columns, visibleColumnIds, getDocumentColumnValues, initialColumnId, initialColumnsPerRow, initialGroupOrder, initialHeight, initialRowOrder, initialView, movingRows, onColumnChange, onLayoutChange, onMoveRow, onOpenRow }) {
    const statusColumns = columns.filter((column) => column.type === "status");
    const visibleIds = Array.isArray(visibleColumnIds) ? new Set(visibleColumnIds) : null;
    const displayColumns = visibleIds ? columns.filter((column) => visibleIds.has(column.id)) : columns;
    const [columnId, setColumnId] = React.useState(() => (
      statusColumns.some((column) => column.id === initialColumnId) ? initialColumnId : statusColumns[0]?.id || ""
    ));
    const [search, setSearch] = React.useState("");
    const [page, setPage] = React.useState(1);
    const [viewMode, setViewMode] = React.useState(() => initialView === "row" ? "row" : "grid");
    const [columnsPerRow, setColumnsPerRow] = React.useState(() => Math.min(10, Math.max(1, Math.round(Number(initialColumnsPerRow) || 3))));
    const [boardHeight, setBoardHeight] = React.useState(() => Math.max(150, Math.round(Number(initialHeight) || 600)));
    const [groupOrder, setGroupOrder] = React.useState(() => Array.isArray(initialGroupOrder) ? initialGroupOrder : []);
    const [rowOrder, setRowOrder] = React.useState(() => (
      Array.isArray(initialRowOrder)
        ? [...new Set(initialRowOrder.map(Number).filter((rowNumber) => Number.isInteger(rowNumber) && rowNumber > 0))]
        : []
    ));
    const [rowGroups, setRowGroups] = React.useState({});
    const [boardRevision, setBoardRevision] = React.useState(0);
    const boardRef = React.useRef(null);
    const boardScrollSnapshotRef = React.useRef(null);
    const suppressOpenRef = React.useRef(null);
    const pageSize = 8;
    const statusColumn = statusColumns.find((column) => column.id === columnId) || statusColumns[0];
    const rows = sheetViewRows(table);
    const rowNumbersKey = rows.map((row) => row.number).join("|");
    const initialGroupOrderKey = Array.isArray(initialGroupOrder) ? initialGroupOrder.join("\u0000") : "";
    const initialRowOrderKey = Array.isArray(initialRowOrder) ? initialRowOrder.join("|") : "";
    const rowStatusesKey = statusColumn
      ? rows.map((row) => `${row.number}:${String(row.cells[statusColumn.index] || "").trim() || "__empty__"}`).join("|")
      : "";

    React.useEffect(() => {
      if (!statusColumns.some((column) => column.id === columnId)) {
        const next = statusColumns[0]?.id || "";
        setColumnId(next);
        if (next) onColumnChange(next);
      }
    }, [columnId, statusColumns.map((column) => column.id).join("|")]);

    React.useEffect(() => setPage(1), [columnId, search]);
    React.useEffect(() => {
      setViewMode(initialView === "row" ? "row" : "grid");
      setColumnsPerRow(Math.min(10, Math.max(1, Math.round(Number(initialColumnsPerRow) || 3))));
      setBoardHeight(Math.max(150, Math.round(Number(initialHeight) || 600)));
    }, [initialColumnsPerRow, initialHeight, initialView]);
    React.useEffect(() => {
      setGroupOrder(Array.isArray(initialGroupOrder) ? initialGroupOrder : []);
    }, [initialGroupOrderKey]);
    React.useEffect(() => {
      if (!Array.isArray(initialRowOrder)) return;
      setRowOrder([...new Set(initialRowOrder.map(Number).filter((rowNumber) => Number.isInteger(rowNumber) && rowNumber > 0))]);
    }, [initialRowOrderKey]);
    React.useEffect(() => {
      const available = new Set(rows.map((row) => row.number));
      setRowOrder((current) => [
        ...current.filter((rowNumber) => available.has(rowNumber)),
        ...rows.map((row) => row.number).filter((rowNumber) => !current.includes(rowNumber))
      ]);
    }, [rowNumbersKey]);
    React.useEffect(() => {
      if (!statusColumn) return;
      const available = new Set(rows.map((row) => row.number));
      setRowGroups((current) => {
        let changed = false;
        const next = { ...current };
        for (const [rowNumber, groupId] of Object.entries(current)) {
          const row = rows.find((candidate) => candidate.number === Number(rowNumber));
          const actualGroup = String(row?.cells[statusColumn.index] || "").trim() || "__empty__";
          if (!available.has(Number(rowNumber)) || actualGroup === groupId) {
            delete next[rowNumber];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, [columnId, rowStatusesKey]);

    const captureBoardScroll = () => {
      const board = boardRef.current;
      if (!board) return;
      boardScrollSnapshotRef.current = {
        left: board.scrollLeft,
        top: board.scrollTop,
        columns: Object.fromEntries(
          [...board.querySelectorAll(".kanban-column[data-kanban-group]")].map((column) => [
            String(column.dataset.kanbanGroup || ""),
            column.querySelector(".kanban-cards")?.scrollTop || 0
          ])
        )
      };
    };

    React.useLayoutEffect(() => {
      const board = boardRef.current;
      const snapshot = boardScrollSnapshotRef.current;
      if (!board || !snapshot) return;
      board.scrollLeft = snapshot.left;
      board.scrollTop = snapshot.top;
      const columnsByGroup = new Map(
        [...board.querySelectorAll(".kanban-column[data-kanban-group]")]
          .map((column) => [String(column.dataset.kanbanGroup || ""), column])
      );
      for (const [groupId, scrollTop] of Object.entries(snapshot.columns)) {
        const cards = columnsByGroup.get(groupId)?.querySelector(".kanban-cards");
        if (cards) cards.scrollTop = scrollTop;
      }
      boardScrollSnapshotRef.current = null;
    }, [boardRevision]);

    React.useEffect(() => {
      const board = boardRef.current;
      if (!board || viewMode !== "grid") return undefined;
      const adjustGridColumns = () => {
        const contentWidth = Math.max(0, board.clientWidth - 24);
        const availableColumns = Math.max(1, Math.floor((contentWidth + 12) / 312));
        board.style.setProperty("--kanban-real-columns", String(Math.min(columnsPerRow, availableColumns)));
      };
      adjustGridColumns();
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(adjustGridColumns);
        observer.observe(board);
        return () => observer.disconnect();
      }
      const boardWindow = board.ownerDocument.defaultView;
      boardWindow.addEventListener("resize", adjustGridColumns);
      return () => boardWindow.removeEventListener("resize", adjustGridColumns);
    }, [boardRevision, columnId, columnsPerRow, viewMode]);

    if (!statusColumn) return React.createElement(SheetViewEmpty, { description: "Configura una columna como Estado para usar Kanban" });

    const orderIndex = new Map(rowOrder.map((rowNumber, index) => [rowNumber, index]));
    const normalizedSearch = normalizedColumn(search);
    const filteredRows = (normalizedSearch
      ? rows.filter((row) => normalizedColumn(row.cells.join(" ")).includes(normalizedSearch))
      : rows).sort((left, right) => (
        (orderIndex.get(left.number) ?? Number.MAX_SAFE_INTEGER)
        - (orderIndex.get(right.number) ?? Number.MAX_SAFE_INTEGER)
        || left.number - right.number
      ));
    const documentValues = typeof getDocumentColumnValues === "function"
      ? getDocumentColumnValues(statusColumn)
      : rows.map((row) => row.cells[statusColumn.index]);
    const configuredGroups = propertyOptionEntries(statusColumn)
      .map((option) => ({
        id: option.label,
        label: option.label,
        color: option.color
      }));
    const knownGroups = new Set(configuredGroups.map((group) => group.id));
    const inferredGroups = [];
    for (const documentValue of documentValues) {
      const value = String(documentValue || "").trim();
      if (!value || knownGroups.has(value)) continue;
      knownGroups.add(value);
      inferredGroups.push({ id: value, label: value, color: "" });
    }
    const unorderedGroups = [
      { id: "__empty__", label: "Sin selección", color: "" },
      ...configuredGroups,
      ...inferredGroups
    ];
    const groupsById = new Map(unorderedGroups.map((group) => [group.id, group]));
    const groups = [
      ...groupOrder.map((groupId) => groupsById.get(groupId)).filter(Boolean),
      ...unorderedGroups.filter((group) => !groupOrder.includes(group.id))
    ];
    const groupedRows = Object.fromEntries(groups.map((group) => [group.id, []]));
    for (const row of filteredRows) {
      const value = String(row.cells[statusColumn.index] || "").trim();
      const stagedGroup = rowGroups[row.number];
      const groupId = stagedGroup && groupedRows[stagedGroup]
        ? stagedGroup
        : groupedRows[value] ? value : "__empty__";
      groupedRows[groupId].push(row);
    }
    const longestGroup = Math.max(0, ...Object.values(groupedRows).map((groupRows) => groupRows.length));
    const totalPages = Math.max(1, Math.ceil(longestGroup / pageSize));
    const safePage = Math.min(page, totalPages);
    const titleColumn = displayColumns.find((column) => column.type === "text") || displayColumns[0];

    const selectColumn = (nextColumnId) => {
      setColumnId(nextColumnId);
      onColumnChange(nextColumnId);
    };

    const changeColumnsPerRow = (value) => {
      const next = Math.min(10, Math.max(1, Math.round(Number(value) || 1)));
      setColumnsPerRow(next);
      onLayoutChange?.("kanbanColumns", next);
    };

    const changeViewMode = (value) => {
      const next = value === "row" ? "row" : "grid";
      setViewMode(next);
      onLayoutChange?.("kanbanView", next);
    };

    const changeBoardHeight = (value) => {
      const next = Math.max(150, Math.round(Number(value) || 150));
      setBoardHeight(next);
      onLayoutChange?.("kanbanHeight", next);
    };

    const releaseSuppressedOpen = () => {
      panelDocument.defaultView.setTimeout(() => {
        suppressOpenRef.current = null;
      }, 200);
    };

    React.useEffect(() => {
      const board = boardRef.current;
      if (!board) return undefined;
      const kanbanDocument = board.ownerDocument;
      let drag = null;
      let dragType = "";
      let dragImage = null;
      let dragOffset = { x: 0, y: 0 };
      let columnMoveAnchor = null;
      let dragImageFrame = 0;
      let dragImagePoint = null;
      const kanbanWindow = kanbanDocument.defaultView;

      const moveDragImage = (x, y) => {
        if (!dragImage) return;
        dragImage.style.transform = `translate3d(${x - dragOffset.x}px,${y - dragOffset.y}px,0)`;
      };

      const queueDragImageMove = (x, y) => {
        dragImagePoint = { x, y };
        if (dragImageFrame) return;
        dragImageFrame = kanbanWindow.requestAnimationFrame(() => {
          dragImageFrame = 0;
          if (dragImagePoint) moveDragImage(dragImagePoint.x, dragImagePoint.y);
        });
      };

      const removeDragImage = () => {
        if (dragImageFrame) kanbanWindow.cancelAnimationFrame(dragImageFrame);
        dragImageFrame = 0;
        dragImagePoint = null;
        dragImage?.remove();
        dragImage = null;
      };

      const createDragImage = (element, event) => {
        const rect = element.getBoundingClientRect();
        dragImage = element.cloneNode(true);
        dragImage.classList.remove("dragging");
        dragImage.classList.add("kanban-drag-image");
        dragImage.setAttribute("aria-hidden", "true");
        dragImage.style.width = `${rect.width}px`;
        dragImage.style.height = `${rect.height}px`;
        dragImage.querySelectorAll("[draggable]").forEach((item) => { item.draggable = false; });
        dragImage.draggable = false;
        const sourceCards = element.querySelector(".kanban-cards");
        const previewCards = dragImage.querySelector(".kanban-cards");
        dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        kanbanDocument.body.append(dragImage);
        if (sourceCards && previewCards) previewCards.scrollTop = sourceCards.scrollTop;
        moveDragImage(event.clientX, event.clientY);

        const transparent = kanbanDocument.createElement("canvas");
        transparent.width = 1;
        transparent.height = 1;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "");
        event.dataTransfer.setDragImage(transparent, 0, 0);
      };

      const handleDragStart = (event) => {
        if (!board.contains(event.target)) return;
        if (event.target.matches(".card")) {
          drag = event.target;
          dragType = "card";
          suppressOpenRef.current = Number(drag.dataset.sheetRow) || null;
        } else {
          const header = event.target.closest(".kanban-column-header");
          if (!header || !board.contains(header)) return;
          drag = header.closest(".kanban-column");
          dragType = "column";
          columnMoveAnchor = null;
        }
        createDragImage(drag, event);
        drag.classList.add("dragging");
      };

      const handleDrag = (event) => {
        if (dragImage && (event.clientX || event.clientY)) {
          queueDragImageMove(event.clientX, event.clientY);
        }
      };

      const handleDragOver = (event) => {
        if (!drag) return;
        event.preventDefault();
        queueDragImageMove(event.clientX, event.clientY);

        if (dragType === "column") {
          if (columnMoveAnchor && Math.hypot(
            event.clientX - columnMoveAnchor.x,
            event.clientY - columnMoveAnchor.y
          ) < 16) return;

          const hovered = event.target.closest(".kanban-column");
          if (hovered === drag) return;
          const candidates = [...board.querySelectorAll(".kanban-column:not(.dragging)")];
          if (!candidates.length) return;
          const target = hovered || candidates.reduce((nearest, column) => {
            const rect = column.getBoundingClientRect();
            const dx = event.clientX < rect.left
              ? rect.left - event.clientX
              : event.clientX > rect.right ? event.clientX - rect.right : 0;
            const dy = event.clientY < rect.top
              ? rect.top - event.clientY
              : event.clientY > rect.bottom ? event.clientY - rect.bottom : 0;
            const distance = dx * dx + dy * dy;
            return !nearest || distance < nearest.distance ? { column, distance } : nearest;
          }, null).column;
          const ordered = [...board.querySelectorAll(".kanban-column")];
          if (ordered.indexOf(drag) < ordered.indexOf(target)) target.after(drag);
          else target.before(drag);
          columnMoveAnchor = { x: event.clientX, y: event.clientY };
          return;
        }

        let cards = event.target.closest(".cards");
        if (!cards) {
          const column = event.target.closest(".column");
          cards = column?.querySelector(".cards");
        }
        if (!cards || !board.contains(cards)) return;

        const next = [...cards.querySelectorAll(".card:not(.dragging)")].find((card) => {
          const rect = card.getBoundingClientRect();
          return event.clientY < rect.top + rect.height / 2;
        });
        if (drag.parentElement === cards) {
          let followingCard = drag.nextElementSibling;
          while (followingCard && !followingCard.matches(".card:not(.dragging)")) {
            followingCard = followingCard.nextElementSibling;
          }
          if (followingCard === (next || null)) return;
        }
        cards.insertBefore(drag, next || null);
      };

      const handleDragEnd = () => {
        if (!drag) return;
        if (dragType === "column") {
          const nextGroupOrder = [...board.querySelectorAll(".kanban-column[data-kanban-group]")]
            .map((column) => String(column.dataset.kanbanGroup || ""))
            .filter(Boolean);
          drag.classList.remove("dragging");
          removeDragImage();
          drag = null;
          dragType = "";
          columnMoveAnchor = null;
          captureBoardScroll();
          flushSync(() => {
            setGroupOrder(nextGroupOrder);
            setBoardRevision((current) => current + 1);
          });
          onLayoutChange?.("kanbanGroupOrder", nextGroupOrder);
          return;
        }
        const draggedCard = drag;
        const rowNumber = Number(draggedCard.dataset.sheetRow);
        const destination = draggedCard.closest("[data-kanban-group]");
        const group = groups.find((candidate) => candidate.id === destination?.dataset.kanbanGroup);
        const row = rows.find((candidate) => candidate.number === rowNumber);
        const visibleOrder = [...board.querySelectorAll(".card[data-sheet-row]")]
          .map((card) => Number(card.dataset.sheetRow))
          .filter(Number.isFinite);
        const nextRowOrder = [
          ...visibleOrder,
          ...rowOrder.filter((currentRow) => !visibleOrder.includes(currentRow)),
          ...rows.map((candidate) => candidate.number)
            .filter((currentRow) => !visibleOrder.includes(currentRow) && !rowOrder.includes(currentRow))
        ];

        draggedCard.classList.remove("dragging");
        removeDragImage();
        drag = null;
        dragType = "";
        captureBoardScroll();
        flushSync(() => {
          if (group) setRowGroups((current) => ({ ...current, [rowNumber]: group.id }));
          setRowOrder(nextRowOrder);
          setBoardRevision((current) => current + 1);
        });
        onLayoutChange?.("kanbanRowOrder", nextRowOrder);
        releaseSuppressedOpen();

        if (!row || !group) return;
        const nextValue = group.id === "__empty__" ? "" : group.label;
        void onMoveRow(row, statusColumn, nextValue);
      };

      kanbanDocument.addEventListener("dragstart", handleDragStart);
      kanbanDocument.addEventListener("drag", handleDrag);
      kanbanDocument.addEventListener("dragover", handleDragOver);
      kanbanDocument.addEventListener("dragend", handleDragEnd);
      return () => {
        drag?.classList.remove("dragging");
        removeDragImage();
        kanbanDocument.removeEventListener("dragstart", handleDragStart);
        kanbanDocument.removeEventListener("drag", handleDrag);
        kanbanDocument.removeEventListener("dragover", handleDragOver);
        kanbanDocument.removeEventListener("dragend", handleDragEnd);
      };
    }, [boardRevision, columnId, rowNumbersKey, rowOrder.join("|"), statusColumn.id, movingRows.join("|"), groups.map((group) => group.id).join("|")]);

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
        React.createElement(
          "div",
          { className: "kanban-settings" },
          React.createElement(Select, {
            value: statusColumn.id,
            onChange: selectColumn,
            options: statusColumns.map((column) => ({ value: column.id, label: column.name })),
            style: { minWidth: 190 }
          }),
          React.createElement(Select, {
            className: "kanban-view-mode",
            value: viewMode,
            "aria-label": "Visualizacion del Kanban",
            options: [
              { value: "grid", label: "Mostrar como grid" },
              { value: "row", label: "Mostrar en una fila" }
            ],
            onChange: changeViewMode
          }),
          ...(viewMode === "grid" ? [
            React.createElement(
              "label",
              { className: "kanban-setting", key: "columns" },
              React.createElement("span", null, "Columnas por fila"),
              React.createElement(InputNumber, {
                min: 1,
                max: 10,
                precision: 0,
                value: columnsPerRow,
                "aria-label": "Columnas por fila",
                "data-kanban-columns": "",
                onChange: changeColumnsPerRow
              })
            ),
            React.createElement(
              "label",
              { className: "kanban-setting", key: "height" },
              React.createElement("span", null, "Alto"),
              React.createElement(InputNumber, {
                min: 150,
                precision: 0,
                value: boardHeight,
                addonAfter: "px",
                "aria-label": "Alto del tablero",
                "data-kanban-height": "",
                onChange: changeBoardHeight
              })
            )
          ] : [])
        )
      ),
      React.createElement(
        "div",
        {
          className: `kanban-board kanban-board--${viewMode} kanban`,
          key: `${columnId}:${boardRevision}`,
          ref: boardRef,
          style: {
            "--kanban-columns": columnsPerRow,
            "--kanban-height": viewMode === "grid" ? `${boardHeight}px` : undefined
          }
        },
        ...groups.map((group) => {
          const groupRows = groupedRows[group.id] || [];
          const visibleRows = groupRows.slice((safePage - 1) * pageSize, safePage * pageSize);
          return React.createElement(KanbanColumn, {
            columns: displayColumns,
            group,
            groupRows,
            key: group.id,
            movingRows,
            onOpenRow,
            statusColumn,
            suppressOpenRef,
            titleColumn,
            total: sheetViewKanbanTotal(columns, groupRows),
            visibleRows
          });
        })
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

  function SheetCalendar({ table, columns, visibleColumnIds, initialColumnId, onColumnChange, onOpenRow }) {
    const dateColumns = columns.filter((column) => column.type === "date");
    const visibleIds = Array.isArray(visibleColumnIds) ? new Set(visibleColumnIds) : null;
    const displayColumns = visibleIds ? columns.filter((column) => visibleIds.has(column.id)) : columns;
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
                    onDoubleClick: () => onOpenRow(row.number),
                    onKeyDown: (event) => {
                      if (event.key === "Enter" || event.key === " ") onOpenRow(row.number);
                    }
                  },
                  sheetViewRowTitle(row, displayColumns)
                ))
              )
            );
          })
        )
      )
    );
  }

  function workspaceDocumentName() {
    const title = String(document.title || "").replace(/\s+-\s+Hojas de c[aá]lculo de Google.*$/i, "").trim();
    return title || "Documento actual";
  }

  function workspaceSheetList() {
    const configured = state.workspace?.sheets || {};
    const result = [];
    const used = new Set();
    for (const visible of visibleSheets()) {
      const configuredEntry = Object.entries(configured).find(([, sheet]) => normalizedColumn(sheet.name) === normalizedColumn(visible.name));
      const gid = String(visible.gid || configuredEntry?.[0] || "");
      const key = gid || normalizedColumn(visible.name);
      if (!key || used.has(key)) continue;
      used.add(key);
      result.push({ gid, name: visible.name });
    }
    if (!result.length) {
      for (const [gid, sheet] of Object.entries(configured)) {
        const key = String(gid);
        if (!sheet?.name || used.has(key)) continue;
        used.add(key);
        result.push({ gid: key, name: sheet.name });
      }
    }
    return result;
  }

  function SheetViewActions({ sheetKey, sheetName, columns, settings, refreshKey }) {
    const [view, setView] = React.useState("");
    const [table, setTable] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState("");
    const movingRows = [];
    const [workspaceTarget, setWorkspaceTarget] = React.useState(() => ({ gid: drawerGid(), name: sheetName }));
    const [workspaceColumns, setWorkspaceColumns] = React.useState(columns);
    const [workspaceLoadRevision, setWorkspaceLoadRevision] = React.useState(0);
    const sheetViewDraftsRef = React.useRef(new Map());
    const sourceSheetKeyRef = React.useRef(sheetKey);
    const [, setSheetViewDraftVersion] = React.useState(0);
    const [sheetViewSaving, setSheetViewSaving] = React.useState(false);
    const [sheetViewSaveError, setSheetViewSaveError] = React.useState(false);
    const [, setColumnVisibilityRevision] = React.useState(0);
    const sourceColumns = visibleColumnsForSheet(drawerGid(), columns, sheetName);
    const statusColumns = columns.filter((column) => column.type === "status");
    const dateColumns = columns.filter((column) => column.type === "date");

    React.useEffect(() => {
      if (sourceSheetKeyRef.current === sheetKey || view) return;
      sourceSheetKeyRef.current = sheetKey;
      setView("");
      setTable(null);
      setError("");
      sheetViewDraftsRef.current.clear();
      setSheetViewDraftVersion((current) => current + 1);
      setSheetViewSaving(false);
      setSheetViewSaveError(false);
      setWorkspaceTarget({ gid: drawerGid(), name: sheetName });
      setWorkspaceColumns(columns);
    }, [sheetKey, view]);

    const activeTarget = view === "table" ? workspaceTarget : { gid: drawerGid(), name: sheetName };
    const pendingSheetViewDrafts = () => [...sheetViewDraftsRef.current.values()].filter((draft) => draft.pending);
    const hasSheetViewChanges = pendingSheetViewDrafts().length > 0;
    const sheetViewSaveMode = sheetViewSaveError
      ? "error"
      : sheetViewSaving
        ? "saving"
        : hasSheetViewChanges
          ? "pending"
          : "saved";
    const sheetViewSaveLabel = sheetViewSaveMode === "error"
      ? "Error al guardar"
      : sheetViewSaveMode === "saving"
        ? "Guardando"
        : sheetViewSaveMode === "pending"
          ? "Cambios pendientes"
          : "Guardado";

    const sheetViewTargetKey = (target = activeTarget) => `${String(target.gid)}:${normalizedColumn(target.name)}`;
    const sheetViewRowKey = (target, rowNumber) => `${sheetViewTargetKey(target)}:${Number(rowNumber)}`;
    const sheetViewDraftKey = (target, rowNumber, propertyIndex) => `${sheetViewRowKey(target, rowNumber)}:${Number(propertyIndex)}`;
    const hasDraftForRow = (target, rowNumber) => {
      const prefix = `${sheetViewRowKey(target, rowNumber)}:`;
      return [...sheetViewDraftsRef.current.entries()].some(([key, draft]) => key.startsWith(prefix) && draft.pending);
    };
    const bumpSheetViewDrafts = () => setSheetViewDraftVersion((current) => current + 1);
    const changeHiddenColumnIds = (gid, sheetName, hiddenColumnIds) => {
      const targetGid = configuredSheetGid(gid, sheetName);
      setSheetViewSetting(targetGid, "hiddenColumnIds", hiddenColumnIds);
      setColumnVisibilityRevision((current) => current + 1);
      queueMicrotask(() => {
        if (
          targetGid === configuredSheetGid(drawerGid(), state.sheetName)
          && state.fields.length
        ) {
          renderFields(new Map([...state.primaryDrafts.values()].map((draft) => [draft.index, draft.value])));
        }
        notifyRelatedDrafts();
      });
    };

    const tableWithSheetViewDrafts = (nextTable, target = activeTarget) => {
      if (!nextTable) return nextTable;
      const targetKey = sheetViewTargetKey(target);
      const draftsByRow = new Map();
      for (const draft of sheetViewDraftsRef.current.values()) {
        if (draft.targetKey !== targetKey) continue;
        if (!draftsByRow.has(draft.row)) draftsByRow.set(draft.row, []);
        draftsByRow.get(draft.row).push(draft);
      }
      return {
        ...nextTable,
        rows: nextTable.rows
          .filter((row) => !draftsByRow.get(row.number)?.some((draft) => draft.pending && draft.removesRow))
          .map((row) => {
            const drafts = draftsByRow.get(row.number);
            if (!drafts?.length) return row;
            const cells = [...row.cells];
            for (const draft of drafts) cells[draft.property.index] = draft.value;
            return { ...row, cells };
          })
      };
    };

    const sheetViewDocumentColumnValues = (property, target = activeTarget) => {
      const valuesByRow = new Map((table?.rows || []).map((row) => [
        Number(row.number),
        String(row.cells[property.index] || "")
      ]));
      const targetKey = sheetViewTargetKey(target);
      for (const draft of sheetViewDraftsRef.current.values()) {
        if (
          draft.targetKey === targetKey
          && draft.pending
          && Number(draft.property.index) === Number(property.index)
        ) valuesByRow.set(Number(draft.row), String(draft.originalValue || ""));
      }
      return [...valuesByRow.values()];
    };

    const syncSheetViewTable = (target = activeTarget) => {
      setTable((current) => tableWithSheetViewDrafts(current, target));
    };

    const stageSheetViewValue = (row, property, nextValue, target = activeTarget, allowProtected = false) => {
      if (!row || (property.protected && !allowProtected)) return false;
      const normalizedValue = String(nextValue ?? "");
      const draftKey = sheetViewDraftKey(target, row.number, property.index);
      const existingDraft = sheetViewDraftsRef.current.get(draftKey);
      const originalValue = existingDraft?.originalValue ?? String(row.cells[property.index] || "");
      const originalRow = existingDraft?.originalRow || { ...row, cells: [...row.cells] };
      sheetViewDraftsRef.current.set(draftKey, {
        targetKey: sheetViewTargetKey(target),
        target: { gid: String(target.gid), name: String(target.name) },
        row: Number(row.number),
        property,
        value: normalizedValue,
        originalValue,
        originalRow,
        pending: !valuesEqualForProperty(normalizedValue, originalValue, property),
        removesRow: existingDraft?.removesRow || false
      });
      if (sheetViewTargetKey(target) === sheetViewTargetKey(activeTarget)) {
        setTable((current) => {
          if (!current) return current;
          return {
            ...current,
            rows: current.rows.map((currentRow) => {
              if (currentRow.number !== row.number) return currentRow;
              const cells = [...currentRow.cells];
              cells[property.index] = normalizedValue;
              return { ...currentRow, cells };
            })
          };
        });
      }
      setError("");
      setSheetViewSaveError(false);
      bumpSheetViewDrafts();
      return true;
    };

    const cancelSheetViewChanges = () => {
      if (sheetViewSaving || !hasSheetViewChanges) return;
      const drafts = pendingSheetViewDrafts();
      setTable((current) => {
        if (!current) return current;
        const rows = new Map(current.rows.map((row) => [row.number, row]));
        for (const draft of drafts) {
          const currentRow = rows.get(draft.row) || { ...draft.originalRow, cells: [...draft.originalRow.cells] };
          const cells = [...currentRow.cells];
          cells[draft.property.index] = draft.originalValue;
          rows.set(draft.row, { ...currentRow, cells });
        }
        return { ...current, rows: [...rows.values()].sort((left, right) => left.number - right.number) };
      });
      sheetViewDraftsRef.current.clear();
      setSheetViewSaveError(false);
      setError("");
      bumpSheetViewDrafts();
    };

    const saveSheetViewChanges = async () => {
      if (sheetViewSaving || !hasSheetViewChanges) return;
      const drafts = pendingSheetViewDrafts();
      const latestTable = tableWithSheetViewDrafts(table, activeTarget);
      setTable(latestTable);
      const rowsByNumber = new Map((latestTable?.rows || []).map((row) => [row.number, row]));
      setSheetViewSaving(true);
      setSheetViewSaveError(false);
      setError("");
      try {
        await Promise.all(drafts.map((draft) => {
          const rowValues = rowsByNumber.get(draft.row)?.cells
            || (draft.removesRow
              ? draft.originalRow.cells.map(() => "")
              : draft.originalRow.cells);
          return writeSheetViewValue(draft.row, draft.property, draft.value, rowValues, draft.target, rowsByNumber);
        }));
        const verificationKeys = new Set(drafts.map((draft) => `sheet-view:${draft.target.gid}:${draft.row}:${draft.property.index}`));
        const deadline = Date.now() + 9_000;
        while (Date.now() < deadline && [...verificationKeys].some((key) => state.sheetViewWrites.has(key))) await wait(80);
        for (const draft of drafts) {
          const draftKey = sheetViewDraftKey(draft.target, draft.row, draft.property.index);
          if (sheetViewDraftsRef.current.get(draftKey) === draft) sheetViewDraftsRef.current.delete(draftKey);
        }
        bumpSheetViewDrafts();
      } catch (saveError) {
        setSheetViewSaveError(true);
        setError(saveError.message);
      } finally {
        setSheetViewSaving(false);
      }
    };

    const requestSheetViewClose = () => {
      if (hasSheetViewChanges || sheetViewSaving) {
        setError("Guarda o cancela los cambios pendientes antes de cerrar la vista.");
        return;
      }
      sheetViewDraftsRef.current.clear();
      setView("");
    };

    React.useLayoutEffect(() => {
      const title = view === "table"
        ? workspaceDocumentName()
        : `${view === "kanban" ? "Kanban" : "Calendario"} · ${sheetName}`;
      setSheetViewHostOpen(Boolean(view), title);
      return () => setSheetViewHostOpen(false);
    }, [Boolean(view)]);

    React.useEffect(() => {
      if (!view) return;
      sheetViewFrame.title = view === "table"
        ? workspaceDocumentName()
        : `${view === "kanban" ? "Kanban" : "Calendario"} · ${sheetName}`;
    }, [view, workspaceTarget.name, sheetName]);

    React.useEffect(() => {
      if (!view) return undefined;
      const controller = new AbortController();
      let active = true;
      setLoading(true);
      setError("");
      setActivity("views", true);
      cachedSheetTable(activeTarget.name, true, controller.signal).then((nextTable) => {
        if (!active) return;
        if (view === "table") {
          const configured = reconcileSheetConfiguration(activeTarget.gid, activeTarget.name, nextTable.headers);
          setWorkspaceColumns((configured.columns || []).filter((column) => String(column.sourceHeader || "").trim()));
        }
        setTable(tableWithSheetViewDrafts(nextTable, activeTarget));
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
    }, [view, refreshKey, activeTarget.gid, activeTarget.name, workspaceLoadRevision]);

    React.useEffect(() => {
      if (view === "kanban" && !statusColumns.length) setView("");
      if (view === "calendar" && !dateColumns.length) setView("");
    }, [view, statusColumns.length, dateColumns.length]);

    const openSheetViewRow = async (rowNumber, target = workspaceTarget) => {
      if (hasSheetViewChanges || sheetViewSaving) {
        setError("Guarda o cancela los cambios pendientes antes de abrir otra fila.");
        return;
      }
      if (state.primaryDrafts.size || state.relatedDrafts.size) {
        setError("Guarda o cancela los cambios pendientes antes de abrir otra fila.");
        return;
      }
      try {
        await drainSheetViewMutations();
        setError("");
        await focusSheetRange(qualifiedReference(target.name, `A${rowNumber}`));
        openWorkspaceRecordOverlay();
        setStatus(`Leyendo la fila ${rowNumber} desde tu sesiÃ³n de Googleâ€¦`, "busy");
        ui.fields.inert = true;
        ui.fields.setAttribute("aria-busy", "true");
        const deadline = Date.now() + 2_500;
        while (
          Date.now() < deadline
          && (
            selectedRow(nameBoxValue()) !== Number(rowNumber)
            || normalizedColumn(activeSheetName()) !== normalizedColumn(target.name)
          )
        ) await wait(50);
        state.lastSelection = "";
        if (
          selectedRow(nameBoxValue()) === Number(rowNumber)
          && normalizedColumn(activeSheetName()) === normalizedColumn(target.name)
        ) await loadRow(Number(rowNumber), true, target);
        else pollSelection();
      } catch (focusError) {
        closeWorkspaceRecordOverlay();
        setError(focusError.message);
      }
    };

    const moveRow = (row, property, nextValue) => {
      if (property.protected) return;
      if (state.primaryDrafts.size || state.relatedDrafts.size) {
        setError("Guarda o cancela los cambios pendientes antes de mover una ficha.");
        return;
      }
      stageSheetViewValue(row, property, nextValue, activeTarget);
    };

    const editWorkspaceCell = (row, property, nextEditorValue) => {
      if (property.protected) return;
      const nextValue = serializeEditorValue(nextEditorValue, property);
      const previousValue = String(row.cells[property.index] || "");
      if (valuesEqualForProperty(nextValue, previousValue, property)) return;
      stageSheetViewValue(row, property, nextValue, workspaceTarget);
    };

    const addWorkspaceRow = async () => {
      if (!table) return;
      if (hasSheetViewChanges || sheetViewSaving) {
        setError("Guarda o cancela los cambios pendientes antes de agregar un registro.");
        return;
      }
      if (state.primaryDrafts.size || state.relatedDrafts.size) {
        setError("Guarda o cancela los cambios pendientes antes de agregar un registro.");
        return;
      }
      try {
        await drainSheetViewMutations();
        await focusSheetRange(qualifiedReference(workspaceTarget.name, "A1"));
        const deadline = Date.now() + 2_500;
        while (Date.now() < deadline && normalizedColumn(activeSheetName()) !== normalizedColumn(workspaceTarget.name)) {
          await wait(50);
        }
        if (normalizedColumn(activeSheetName()) !== normalizedColumn(workspaceTarget.name)) {
          throw new Error(`Sheets no activÃ³ la hoja ${workspaceTarget.name}`);
        }
        openWorkspaceRecordOverlay();
        await beginPrimaryRecordCreation(workspaceTarget);
      } catch (creationError) {
        closeWorkspaceRecordOverlay();
        setError(creationError.message);
      }
    };

    const clearWorkspaceRows = async (rowNumbers) => {
      if (!table) return;
      const targets = new Set(rowNumbers.map(Number));
      const previousRows = table.rows.filter((row) => targets.has(row.number));
      for (const row of previousRows) {
        for (const property of workspaceColumns) stageSheetViewValue(row, property, "", workspaceTarget, true);
        if (hasDraftForRow(workspaceTarget, row.number)) {
          for (const draft of sheetViewDraftsRef.current.values()) {
            if (draft.pending && draft.targetKey === sheetViewTargetKey(workspaceTarget) && draft.row === row.number) draft.removesRow = true;
          }
        }
      }
      syncSheetViewTable(workspaceTarget);
      bumpSheetViewDrafts();
    };

    const selectWorkspaceSheet = (sheet) => {
      if (!sheet?.name) return;
      if (hasSheetViewChanges || sheetViewSaving) {
        setError("Guarda o cancela los cambios pendientes antes de cambiar de hoja.");
        return;
      }
      const gid = String(sheet.gid || "");
      const sameTarget = gid === String(workspaceTarget.gid)
        && normalizedColumn(sheet.name) === normalizedColumn(workspaceTarget.name);
      if (sameTarget) {
        setError("");
        setWorkspaceLoadRevision((current) => current + 1);
        return;
      }
      const configured = state.workspace?.sheets?.[gid];
      setWorkspaceTarget({ gid, name: sheet.name });
      setWorkspaceColumns((configured?.columns || []).filter((column) => String(column.sourceHeader || "").trim()));
      setTable(null);
      setError("");
    };

    const content = view === "table"
      ? React.createElement(WorkspaceSheetView, {
        columns: workspaceColumns,
        error,
        hiddenColumnIds: sheetHiddenColumnIds(workspaceTarget.gid, workspaceTarget.name),
        loading: loading && !table,
        onAddRow: addWorkspaceRow,
        onCellChange: editWorkspaceCell,
        onClearRows: clearWorkspaceRows,
        onHiddenColumnIdsChange: (hiddenColumnIds) => changeHiddenColumnIds(workspaceTarget.gid, workspaceTarget.name, hiddenColumnIds),
        onOpenRow: openSheetViewRow,
        renderCalendar: (openWorkspaceRow, visibleColumns) => React.createElement(SheetCalendar, {
          table,
          columns: workspaceColumns,
          visibleColumnIds: visibleColumns.map((column) => column.id),
          initialColumnId: state.workspace?.sheetViews?.[workspaceTarget.gid]?.calendarColumnId,
          onColumnChange: (columnId) => setSheetViewSetting(workspaceTarget.gid, "calendarColumnId", columnId),
          onOpenRow: openWorkspaceRow
        }),
        renderEditor: (property, value, onChange) => React.createElement(PropertyEditorControl, { property, value, onChange }),
        renderTypeIcon: (property) => typeBadge(property.type, 12),
        renderKanban: (openWorkspaceRow, visibleColumns) => React.createElement(SheetKanban, {
          table,
          columns: workspaceColumns,
          visibleColumnIds: visibleColumns.map((column) => column.id),
          getDocumentColumnValues: (property) => sheetViewDocumentColumnValues(property, workspaceTarget),
          initialColumnId: state.workspace?.sheetViews?.[workspaceTarget.gid]?.kanbanColumnId,
          initialColumnsPerRow: state.workspace?.sheetViews?.[workspaceTarget.gid]?.kanbanColumns,
          initialGroupOrder: state.workspace?.sheetViews?.[workspaceTarget.gid]?.kanbanGroupOrder,
          initialHeight: state.workspace?.sheetViews?.[workspaceTarget.gid]?.kanbanHeight,
          initialRowOrder: state.workspace?.sheetViews?.[workspaceTarget.gid]?.kanbanRowOrder,
          initialView: state.workspace?.sheetViews?.[workspaceTarget.gid]?.kanbanView,
          movingRows,
          onColumnChange: (columnId) => setSheetViewSetting(workspaceTarget.gid, "kanbanColumnId", columnId),
          onLayoutChange: (name, value) => setSheetViewSetting(workspaceTarget.gid, name, value),
          onMoveRow: moveRow,
          onOpenRow: openWorkspaceRow
        }),
        selectedSheetGid: workspaceTarget.gid,
        sheetName: workspaceTarget.name,
        table,
        toEditorValue: editorValueFromRaw
      })
      : loading && !table
        ? React.createElement("div", { className: "sheet-view-loading" }, React.createElement(Spin, { size: "large" }))
        : error && !table
          ? React.createElement(SheetViewEmpty, { description: error })
          : view === "kanban"
          ? React.createElement(SheetKanban, {
            table,
            columns,
            visibleColumnIds: sourceColumns.map((column) => column.id),
            getDocumentColumnValues: (property) => sheetViewDocumentColumnValues(property, activeTarget),
            initialColumnId: currentSheetViewSettings().kanbanColumnId || settings.kanbanColumnId,
            initialColumnsPerRow: currentSheetViewSettings().kanbanColumns || settings.kanbanColumns,
            initialGroupOrder: currentSheetViewSettings().kanbanGroupOrder,
            initialHeight: currentSheetViewSettings().kanbanHeight || settings.kanbanHeight,
            initialRowOrder: currentSheetViewSettings().kanbanRowOrder,
            initialView: currentSheetViewSettings().kanbanView || settings.kanbanView,
            movingRows,
            onColumnChange: (columnId) => setCurrentSheetViewSetting("kanbanColumnId", columnId),
            onLayoutChange: (name, value) => setCurrentSheetViewSetting(name, value),
            onMoveRow: moveRow,
            onOpenRow: (rowNumber) => openSheetViewRow(rowNumber, activeTarget)
          })
          : view === "calendar"
            ? React.createElement(SheetCalendar, {
              table,
              columns,
              visibleColumnIds: sourceColumns.map((column) => column.id),
              initialColumnId: currentSheetViewSettings().calendarColumnId || settings.calendarColumnId,
              onColumnChange: (columnId) => setCurrentSheetViewSetting("calendarColumnId", columnId),
              onOpenRow: (rowNumber) => openSheetViewRow(rowNumber, activeTarget)
            })
            : null;

    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Button, {
        type: "text",
        shape: "circle",
        size: "small",
        icon: React.createElement(PlusOutlined),
        title: "Agregar registro",
        "aria-label": "Agregar registro",
        "data-add-record": "current",
        onClick: () => void beginPrimaryRecordCreation()
      }),
      React.createElement(Button, {
        type: "text",
        shape: "circle",
        size: "small",
        icon: React.createElement(TableOutlined),
        title: "Abrir vista Tabla",
        "aria-label": "Abrir vista Tabla",
        "data-sheet-view": "table",
        onClick: () => setView("table")
      }),
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
      view ? createPortal(
        sheetViewTree(React.createElement(
          "section",
          {
            className: `sheet-view-panel ${sheetViewSaving ? "is-saving" : ""}`.trim(),
            "data-sheet-view-panel": view
          },
          React.createElement(
            "header",
            { className: "sheet-view-panel-header" },
            React.createElement(
              "div",
              { className: "sheet-view-panel-title" },
              React.createElement(view === "table" ? TableOutlined : view === "kanban" ? AppstoreOutlined : CalendarOutlined),
              React.createElement("span", { className: view === "table" ? "workspace-document-name" : undefined }, view === "table"
                ? workspaceDocumentName()
                : `${view === "kanban" ? "Kanban" : "Calendario"} · ${sheetName}`),
              view === "table" ? React.createElement(
                "nav",
                { className: "workspace-browser-sheets", "aria-label": "Hojas del documento" },
                ...workspaceSheetList().map((sheet) => {
                  const active = String(sheet.gid) === String(workspaceTarget.gid)
                    && normalizedColumn(sheet.name) === normalizedColumn(workspaceTarget.name);
                  return React.createElement(
                    "button",
                    {
                      className: `workspace-browser-sheet ${active ? "is-active" : ""}`.trim(),
                      type: "button",
                      key: `${sheet.gid}:${sheet.name}`,
                      onClick: () => selectWorkspaceSheet(sheet)
                    },
                    React.createElement(TableOutlined),
                    React.createElement("span", null, sheet.name)
                  );
                })
              ) : null
            ),
            React.createElement(
              "div",
              { className: "sheet-view-panel-actions" },
              React.createElement(Button, {
                disabled: sheetViewSaving || !hasSheetViewChanges,
                "data-sheet-view-cancel": "",
                onClick: cancelSheetViewChanges
              }, "Cancelar"),
              React.createElement(Button, {
                type: "primary",
                disabled: sheetViewSaving || !hasSheetViewChanges,
                "data-sheet-view-save": "",
                onClick: () => void saveSheetViewChanges()
              }, "Guardar cambios"),
              React.createElement(
                "span",
                {
                  className: `save-state is-${sheetViewSaveMode}`,
                  title: sheetViewSaveLabel,
                  role: "status",
                  "aria-label": sheetViewSaveLabel,
                  "aria-live": "polite",
                  "data-sheet-view-save-state": sheetViewSaveMode
                },
                React.createElement("span", { className: "save-state-spinner", "aria-hidden": "true" }),
                React.createElement(CheckCircleOutlined, { className: "save-state-check", "aria-hidden": "true" }),
                React.createElement("span", { className: "save-state-error", "aria-hidden": "true" }, "!")
              ),
              React.createElement(ThemeToggleControl),
              React.createElement(Button, {
                type: "text",
                shape: "circle",
                icon: React.createElement(CloseOutlined),
                title: "Cerrar",
                "aria-label": "Cerrar vista",
                "data-close-sheet-view": view,
                onClick: requestSheetViewClose
              })
            )
          ),
          React.createElement(
            "div",
            { className: "sheet-view-panel-body" },
            React.createElement(
              "div",
              { className: "sheet-view-surface", "data-active-sheet-view": view },
              error && table && view !== "table" ? React.createElement("div", { className: "status error" }, error) : null,
              content
            )
          )
        )),
        sheetViewRoot
      ) : null
    );
  }

  function renderSheetViewActions() {
    if (!ui.sheetViewActions?._reactRoot) return;
    const sheet = currentSheetConfiguration();
    const columns = (sheet?.columns || []).filter((column) => String(column.sourceHeader || "").trim());
    flushSync(() => ui.sheetViewActions._reactRoot.render(antdTree(React.createElement(SheetViewActions, {
      sheetKey: `${drawerGid()}:${normalizedColumn(sheet?.name || state.sheetName || activeSheetName())}`,
      sheetName: sheet?.name || state.sheetName || activeSheetName() || `Hoja ${drawerGid()}`,
      columns,
      settings: { ...currentSheetViewSettings() },
      refreshKey: state.sheetDataRevision
    }))));
  }

  function updateAntdControl(host, property, nextValue, refresh) {
    host._editorValue = nextValue;
    host._value = serializeEditorValue(nextValue, property);
    host.dataset.serializedValue = host._value;
    const index = Number(host.dataset.column) - 1;
    if (valuesEqualForProperty(host._value, state.values[index], property)) {
      state.primaryDrafts.delete(index);
    } else {
      state.primaryDrafts.set(index, { index, value: host._value });
    }
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

  async function writeClipboardText(value) {
    const text = String(value ?? "");
    const clipboards = [panelFrame.contentWindow?.navigator?.clipboard, window.navigator?.clipboard].filter(Boolean);
    for (const clipboard of [...new Set(clipboards)]) {
      try {
        await clipboard.writeText(text);
        return;
      } catch {}
    }

    const textarea = panelDocument.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    panelDocument.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = panelDocument.execCommand?.("copy");
    textarea.remove();
    if (!copied) throw new Error("El navegador no permitió copiar el valor");
  }

  function CopyablePropertyControl({ property, value, editor, actions = [] }) {
    const [copied, setCopied] = React.useState(false);
    const resetTimer = React.useRef(0);
    const copyValue = serializeEditorValue(value, property);

    React.useEffect(() => {
      setCopied(false);
    }, [copyValue]);

    React.useEffect(() => () => {
      if (resetTimer.current) panelFrame.contentWindow.clearTimeout(resetTimer.current);
    }, []);

    const copy = async () => {
      try {
        await writeClipboardText(copyValue);
        setCopied(true);
        if (resetTimer.current) panelFrame.contentWindow.clearTimeout(resetTimer.current);
        resetTimer.current = panelFrame.contentWindow.setTimeout(() => setCopied(false), 1_500);
      } catch (error) {
        setStatus(error?.message || "No se pudo copiar el valor", "error");
      }
    };

    const label = property.name || property.sourceHeader || "valor";
    const copyButton = React.createElement(
      Tooltip,
      { title: copied ? "Copiado" : "Copiar" },
      React.createElement(Button, {
        className: `field-copy-button${copied ? " is-copied" : ""}`,
        disabled: !String(copyValue).length,
        icon: React.createElement(copied ? CheckOutlined : CopyOutlined),
        title: copied ? "Copiado" : `Copiar ${label}`,
        "aria-label": copied ? `${label} copiado` : `Copiar ${label}`,
        "data-copy-field-value": property.id || property.sourceHeader || label,
        "data-copy-state": copied ? "copied" : "ready",
        onClick: copy
      })
    );

    return React.createElement(
      Space.Compact,
      { block: true, className: `property-value-compact${property.type === "checkbox" ? " is-checkbox" : ""}` },
      editor,
      copyButton,
      ...actions
    );
  }

  function PropertyEditorControl({ property, value, onChange }) {
    const protectedField = property.protected === true;
    const update = protectedField ? () => {} : onChange;
    const fullWidth = { width: "100%" };
    const copyable = (editor, actions = []) => React.createElement(CopyablePropertyControl, {
      property,
      value,
      editor,
      actions
    });

    if (property.type === "longText") {
      return copyable(React.createElement(Input.TextArea, {
        value: String(value ?? ""),
        disabled: protectedField,
        autoSize: { minRows: 2, maxRows: 6 },
        onChange: (event) => update(event.target.value)
      }));
    }

    if (property.type === "number") {
      return copyable(React.createElement(InputNumber, {
        value: value === "" ? null : value,
        disabled: protectedField,
        controls: true,
        onChange: update,
        style: fullWidth
      }));
    }

    if (property.type === "currency") {
      return copyable(React.createElement(InputNumber, {
        value: value === "" ? null : value,
        disabled: protectedField,
        prefix: property.currencySymbol || "$",
        precision: Number(property.currencyDecimals ?? 2),
        controls: true,
        onChange: update,
        style: fullWidth
      }));
    }

    if (["select", "status"].includes(property.type)) {
      const entries = propertyOptionEntries(property);
      if (value && !entries.some((entry) => entry.label === String(value))) {
        entries.push({ label: String(value), color: "" });
      }
      return copyable(React.createElement(Select, {
        allowClear: true,
        disabled: protectedField,
        value: value || undefined,
        onChange: (nextValue) => update(nextValue || ""),
        options: entries.map((entry) => ({
          value: entry.label,
          title: entry.label,
          label: optionTag(entry.label, entry.color)
        })),
        style: fullWidth
      }));
    }

    if (property.type === "multiSelect") {
      const selected = Array.isArray(value) ? value : [];
      const entries = propertyOptionEntries(property);
      for (const selectedValue of selected) {
        if (!entries.some((entry) => entry.label === selectedValue)) entries.push({ label: selectedValue, color: "" });
      }
      return copyable(React.createElement(Select, {
        mode: "multiple",
        allowClear: true,
        disabled: protectedField,
        value: selected,
        onChange: update,
        options: entries.map((entry) => ({ value: entry.label, label: entry.label, title: entry.label })),
        tagRender: ({ value: selectedValue, label, closable, onClose }) => {
          const entry = entries.find((item) => item.label === selectedValue);
          return optionTag(label || selectedValue, entry?.color, { closable, onClose });
        },
        style: fullWidth
      }));
    }

    if (["date", "datetime"].includes(property.type)) {
      const usesTime = property.type === "datetime";
      const uses12Hours = property.timeFormat === "12";
      const timeFormat = uses12Hours ? "h:mm A" : "HH:mm";
      const format = usesTime ? `${property.dateFormat} ${timeFormat}` : property.dateFormat;
      const pickerValue = value && dayjs(value).isValid() ? dayjs(value) : null;
      return copyable(React.createElement(DatePicker, {
        value: pickerValue,
        disabled: protectedField,
        locale: datePickerLocale,
        popupClassName: "workspace-date-picker-popup",
        placement: "bottomRight",
        showTime: usesTime ? { format: timeFormat, use12Hours: uses12Hours } : false,
        format,
        onChange: (date) => update(date ? date.format(usesTime ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD") : ""),
        style: fullWidth
      }));
    }

    if (property.type === "time") {
      const uses12Hours = property.timeFormat === "12";
      const timeFormat = uses12Hours ? "h:mm A" : "HH:mm";
      const pickerValue = value && dayjs(`2000-01-01T${value}`).isValid() ? dayjs(`2000-01-01T${value}`) : null;
      return copyable(React.createElement(TimePicker, {
        value: pickerValue,
        disabled: protectedField,
        locale: datePickerLocale,
        format: timeFormat,
        use12Hours: uses12Hours,
        onChange: (time) => update(time ? time.format("HH:mm") : ""),
        style: fullWidth
      }));
    }

    if (property.type === "checkbox") {
      return copyable(React.createElement(Checkbox, {
        checked: Boolean(value),
        disabled: protectedField,
        onChange: (event) => update(event.target.checked)
      }));
    }

    const textValue = String(value ?? "");
    const input = React.createElement(Input, {
      value: textValue,
      disabled: protectedField,
      type: property.type === "email" ? "email" : property.type === "phone" ? "tel" : "text",
      placeholder: property.type === "url" ? "https://" : property.type === "email" ? "correo@dominio.com" : property.type === "phone" ? "+506" : undefined,
      onChange: (event) => update(event.target.value)
    });

    if (!["url", "phone", "email"].includes(property.type)) return copyable(input);
    const action = {
      url: { label: "Abrir", icon: React.createElement(LinkOutlined), href: /^https?:\/\//i.test(textValue) ? textValue : `https://${textValue}` },
      phone: { label: "Llamar", icon: React.createElement(PhoneOutlined), href: `tel:${textValue}` },
      email: { label: "Enviar", icon: React.createElement(MailOutlined), href: `mailto:${textValue}` }
    }[property.type];
    return copyable(input, [React.createElement(Button, {
        key: "field-action",
        disabled: !textValue.trim(),
        icon: action.icon,
        onClick: () => panelFrame.contentWindow.open(action.href, property.type === "url" ? "_blank" : "_self", "noopener,noreferrer")
      }, action.label)]);
  }

  function AntFieldControl({ host, property }) {
    const [, refresh] = React.useReducer((value) => value + 1, 0);
    return React.createElement(PropertyEditorControl, {
      property,
      value: host._editorValue,
      onChange: (nextValue) => updateAntdControl(host, property, nextValue, refresh)
    });
  }

  const workspaceRecordMask = element("div", "workspace-record-mask");
  workspaceRecordMask.hidden = true;
  workspaceRecordMask.setAttribute("aria-hidden", "true");
  const drawer = element("aside", "drawer");
  drawer.setAttribute("aria-label", "Detalles de la fila");
  const panelHeader = element("header");
  const drawerTitle = element("div", "drawer-title");
  const title = element("h1", "", "Abrir CRM");
  const byline = element("p", "", "By ");
  const brandLink = element("a", "", "Kodelr");
  brandLink.href = "https://kodelr.com";
  brandLink.target = "_blank";
  brandLink.rel = "noopener noreferrer";
  byline.appendChild(brandLink);
  drawerTitle.append(title, byline);
  const headerActions = element("div", "header-actions");
  const sheetViewActions = element("div", "sheet-view-actions");
  const themeToggle = element("div", "theme-toggle");
  themeToggle._reactRoot = createRoot(themeToggle);
  flushSync(() => themeToggle._reactRoot.render(antdTree(React.createElement(ThemeToggleControl))));
  const accountButton = element("button", "icon-button account-button");
  accountButton.type = "button";
  accountButton.title = "Cuenta";
  accountButton.setAttribute("aria-label", "Abrir cuenta");
  accountButton.dataset.authenticated = "false";
  const accountSvg = panelDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  accountSvg.setAttribute("viewBox", "0 0 24 24");
  accountSvg.setAttribute("fill", "none");
  accountSvg.setAttribute("stroke", "currentColor");
  accountSvg.setAttribute("stroke-width", "2");
  accountSvg.setAttribute("stroke-linecap", "round");
  accountSvg.setAttribute("stroke-linejoin", "round");
  accountSvg.setAttribute("aria-hidden", "true");
  for (const [tag, attributes] of [
    ["circle", { cx: "12", cy: "8", r: "4" }],
    ["path", { d: "M4 21a8 8 0 0 1 16 0" }]
  ]) {
    const node = panelDocument.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    accountSvg.appendChild(node);
  }
  accountButton.appendChild(accountSvg);
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
  headerActions.append(sheetViewActions, saveState, themeToggle, accountButton, close);
  panelHeader.append(drawerTitle, headerActions);

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
  const cloudAccountUi = state.cloudRequired ? createCloudAccountUi({
    document: panelDocument,
    send: cloudMessage,
    openExternal: (url) => panelFrame.contentWindow.open(url, "_blank", "noopener,noreferrer"),
    onSessionChange: handleCloudSessionChange,
    onAccountDataCleared: async () => {
      resetWorkspaceForAccount();
      state.headerCache.clear();
      state.sheetCache.clear();
      state.persistentFallback.clear();
      await ensureWorkspaceLoaded();
      await refreshOpenSheetData();
      await hydrateCloudWorkspace();
    },
    onBlockedClose: () => { panelFrame.hidden = true; },
    createFormControl: createCloudFormControl
  }) : null;
  panelDocument.body.append(workspaceRecordMask, drawer, propertyDrawer);
  if (cloudAccountUi) panelDocument.body.appendChild(cloudAccountUi.element);

  const ui = {
    frame: panelFrame,
    drawer,
    workspaceRecordMask,
    close,
    reopen,
    accountButton,
    cloudAccountUi,
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

  function openWorkspaceRecordOverlay() {
    state.workspaceRecordOverlay = true;
    panelFrame.hidden = false;
    ui.workspaceRecordMask.hidden = false;
    ui.drawer.classList.add("is-workspace-record-overlay");
    ui.close.title = "Cerrar detalles";
    ui.close.setAttribute("aria-label", "Cerrar detalles");
  }

  function closeWorkspaceRecordOverlay() {
    state.workspaceRecordOverlay = false;
    ui.workspaceRecordMask.hidden = true;
    ui.drawer.classList.remove("is-workspace-record-overlay");
    ui.close.title = "Cerrar";
    ui.close.setAttribute("aria-label", "Cerrar");
    if (state.sheetViewOpen) panelFrame.hidden = true;
  }

  async function requestWorkspaceRecordOverlayClose() {
    if (!state.workspaceRecordOverlay) return;
    if (state.primaryCreation) await cancelPrimaryRecordCreation();
    if (state.primaryDrafts.size || state.relatedDrafts.size) {
      setStatus("Guarda o cancela los cambios pendientes antes de cerrar los detalles.", "error");
      return;
    }
    closeWorkspaceRecordOverlay();
  }

  ui.close.addEventListener("click", () => {
    if (state.workspaceRecordOverlay) {
      void requestWorkspaceRecordOverlayClose();
      return;
    }
    ui.frame.hidden = true;
  });
  ui.workspaceRecordMask.addEventListener("click", () => void requestWorkspaceRecordOverlayClose());
  panelDocument.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.workspaceRecordOverlay) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void requestWorkspaceRecordOverlayClose();
  }, true);
  ui.reopen.addEventListener("click", async () => {
    ui.frame.hidden = false;
    if (state.cloudRequired) {
      await refreshCloudAccess();
      if (!cloudAccessAllowed()) ui.cloudAccountUi.open();
    }
  });
  ui.accountButton.addEventListener("click", () => ui.cloudAccountUi?.open());
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

  function cloudMessage(type, payload = {}) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) return Promise.resolve({ ok: true, authenticated: true, local: true });
    return new Promise((resolve) => {
      try {
        runtime.sendMessage({ source: "sheets-row-drawer-cloud", type, payload }, (response) => {
          const runtimeError = globalThis.chrome?.runtime?.lastError;
          resolve(runtimeError
            ? { ok: false, status: 0, code: "RUNTIME_ERROR", error: runtimeError.message }
            : response || { ok: false, status: 0, error: "El servicio no devolvió una respuesta." });
        });
      } catch (error) {
        resolve({ ok: false, status: 0, code: "RUNTIME_ERROR", error: error?.message || "No se pudo contactar al servicio." });
      }
    });
  }

  function cloudAccessAllowed(session = state.cloudSession) {
    if (!state.cloudRequired) return true;
    if (!session?.authenticated || !session.user || session.user.active === false) return false;
    if (session.user.role === "superadmin") return true;
    return session.account?.status === "active" && !session.account?.expired;
  }

  function cloudAccountId(session = state.cloudSession) {
    return session?.user?.accountId || session?.account?.id || "";
  }

  function resetWorkspaceForAccount() {
    window.clearTimeout(state.cloudWorkspaceTimer);
    state.cloudWorkspaceTimer = null;
    state.cloudWorkspaceRevision = 0;
    state.cloudWorkspaceHydrated = false;
    state.workspace = null;
    state.workspacePromise = null;
    state.lastSelection = "";
  }

  function handleCloudSessionChange(session) {
    const previousAccountId = cloudAccountId();
    state.cloudSession = session;
    const nextAccountId = cloudAccountId(session);
    ui.accountButton.dataset.authenticated = String(Boolean(session?.authenticated));
    ui.accountButton.title = session?.authenticated ? `Cuenta · ${session.user?.name || session.user?.email || "Usuario"}` : "Iniciar sesión";
    host.dataset.cloudAccess = cloudAccessAllowed(session) ? "allowed" : session?.serviceError ? "unavailable" : "blocked";
    if (String(previousAccountId || "") !== String(nextAccountId || "")) resetWorkspaceForAccount();
    if (!cloudAccessAllowed(session)) {
      state.request?.abort();
      ui.fields.replaceChildren();
      clearRelations();
      syncPendingActions();
      return;
    }
    ui.cloudAccountUi?.close();
    void ensureWorkspaceLoaded().then(() => hydrateCloudWorkspace());
  }

  async function refreshCloudAccess() {
    if (!state.cloudRequired) return true;
    await ui.cloudAccountUi.refresh();
    return cloudAccessAllowed();
  }

  function currentGid() {
    const activeTabGid = sheetTabGid(document.querySelector(".docs-sheet-active-tab .docs-sheet-tab-name"));
    const searchGid = new URLSearchParams(location.search).get("gid");
    const hashGid = new URLSearchParams(location.hash.slice(1)).get("gid");
    return activeTabGid || hashGid || searchGid || "0";
  }

  function drawerGid() {
    return String(state.gid ?? currentGid());
  }

  function activeSheetName() {
    return document.querySelector(".docs-sheet-active-tab .docs-sheet-tab-name")?.textContent.trim() || "";
  }

  function sheetTabGid(nameNode) {
    if (!nameNode) return "";
    const tab = nameNode.closest(".docs-sheet-tab");
    if (!tab) return "";
    const candidates = [
      tab.id,
      tab.getAttribute("data-gid"),
      tab.getAttribute("data-sheet-id"),
      tab.getAttribute("aria-controls"),
      tab.querySelector("[href*='gid=']")?.getAttribute("href")
    ];
    for (const candidate of candidates) {
      const text = String(candidate || "");
      const match = text.match(/sheet-button-(\d+)/i)
        || text.match(/(?:^|[?&#])gid=(\d+)/i)
        || text.match(/^(\d+)$/);
      if (match) return match[1];
    }
    return "";
  }

  function visibleSheets() {
    const sheets = [];
    const usedNames = new Set();
    for (const nameNode of document.querySelectorAll(".docs-sheet-tab-name")) {
      const name = nameNode.textContent.trim();
      const key = normalizedColumn(name);
      if (!name || usedNames.has(key)) continue;
      usedNames.add(key);
      sheets.push({ name, gid: sheetTabGid(nameNode) });
    }
    return sheets;
  }

  function visibleSheetNames() {
    return visibleSheets().map((sheet) => sheet.name);
  }

  function selectedRow(reference) {
    const ref = String(reference || "").trim().split("!").pop().replace(/\$/g, "");
    const rowRange = ref.match(/^(\d+):(\d+)$/);
    if (rowRange) return Number(rowRange[1]);
    const cell = ref.match(/[A-Z]+(\d+)/i);
    return cell ? Number(cell[1]) : null;
  }

  function rowSelectionSignature(gid, sheetName, row) {
    return `${gid}:${normalizedColumn(sheetName)}:row:${row}`;
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

  const RANDOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

  function randomIdValue(length) {
    const size = Math.min(64, Math.max(1, Number(length) || 12));
    const values = new Uint32Array(size);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => RANDOM_ID_ALPHABET[value % RANDOM_ID_ALPHABET.length]).join("");
  }

  function randomIdDrafts(properties, rows) {
    const drafts = new Map();
    for (const property of properties) {
      if (property.type !== "text" || !property.randomId) continue;
      const used = new Set((rows || []).map((row) => comparable(row.cells?.[property.index])).filter(Boolean));
      let value = "";
      for (let attempt = 0; attempt < 20 && (!value || used.has(value)); attempt += 1) {
        value = randomIdValue(property.randomIdLength);
      }
      drafts.set(property.index, { index: property.index, value, systemGenerated: true });
    }
    return drafts;
  }

  function nextRecordRowNumber(table) {
    return Math.max(1, ...(table?.rows || [])
      .filter((row) => row.cells?.some((value) => comparable(value)))
      .map((row) => Number(row.number) || 1)) + 1;
  }

  async function waitForRecordCreationReady() {
    await drainSheetViewMutations();
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && (state.loading || state.saving || hasPendingWriteVerification())) {
      await wait(100);
    }
    if (state.loading || state.saving || hasPendingWriteVerification()) {
      throw new Error("Espera a que termine la operación actual antes de agregar un registro.");
    }
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
    const owner = state.cloudRequired ? `account:${encodeURIComponent(cloudAccountId() || "signed-out")}` : "local";
    return `${WORKSPACE_PREFIX}:${owner}:${encodeURIComponent(spreadsheetId())}`;
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
      version: 2,
      spreadsheetId: spreadsheetId(),
      sheets: {},
      relationViews: {},
      sheetViews: {},
      updatedAt: Date.now()
    };
  }

  function defaultProperty(index, header = "") {
    return {
      id: stablePropertyId(header, index),
      index,
      sourceHeader: header,
      name: header || `Columna ${columnName(index + 1)}`,
      customName: false,
      protected: false,
      randomId: false,
      randomIdLength: 12,
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
      id: fallback.id,
      index,
      sourceHeader: String(header || source.sourceHeader || ""),
      name: String(source.name || header || fallback.name),
      customName: Boolean(source.customName),
      protected: source.protected === true,
      type: FIELD_TYPE_VALUES.has(source.type) ? source.type : "text",
      randomId: source.type === "text" && source.randomId === true,
      randomIdLength: Math.min(64, Math.max(1, Number(source.randomIdLength ?? 12) || 12)),
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

  function propertyHeaderKey(header) {
    const name = String(header || "").trim().normalize("NFC").toLocaleLowerCase("es");
    return name ? `header:${name}` : "";
  }

  function rememberPropertyDefinition(definitions, property) {
    const key = propertyHeaderKey(property?.sourceHeader);
    if (!key) return;
    definitions[key] = normalizeProperty(property, Number(property.index) || 0, property.sourceHeader);
  }

  function stablePropertyId(header, index) {
    const seed = propertyHeaderKey(header) || `column:${Number(index) + 1}`;
    let hash = 2166136261;
    for (let position = 0; position < seed.length; position += 1) {
      hash ^= seed.charCodeAt(position);
      hash = Math.imul(hash, 16777619);
    }
    return `field-${(hash >>> 0).toString(36)}`;
  }

  function assignCurrentPropertyIds(properties) {
    const occurrences = new Map();
    return properties.map((property, index) => {
      const base = stablePropertyId(property?.sourceHeader, index);
      const occurrence = (occurrences.get(base) || 0) + 1;
      occurrences.set(base, occurrence);
      return { ...property, id: occurrence === 1 ? base : `${base}-${occurrence}` };
    });
  }

  function normalizeWorkspace(workspace) {
    const clean = createWorkspace();
    if (!workspace || typeof workspace !== "object" || Number(workspace.version) !== clean.version) return clean;
    clean.updatedAt = Number(workspace.updatedAt || Date.now());
    for (const [key, view] of Object.entries(workspace.relationViews || {})) {
      if (view === "deck" || view === "table") clean.relationViews[String(key)] = view;
    }
    for (const [gid, sheet] of Object.entries(workspace.sheets || {})) {
      if (!sheet || typeof sheet !== "object") continue;
      const columns = assignCurrentPropertyIds(Array.isArray(sheet.columns)
        ? sheet.columns.map((column, index) => normalizeProperty(column, index, column?.sourceHeader || ""))
        : []);
      const propertyDefinitions = {};
      for (const definition of Object.values(sheet.propertyDefinitions || {})) {
        if (!definition || typeof definition !== "object") continue;
        const sourceHeader = String(definition.sourceHeader || "");
        const key = propertyHeaderKey(sourceHeader);
        if (!key) continue;
        propertyDefinitions[key] = normalizeProperty(definition, Number(definition.index) || 0, sourceHeader);
      }
      clean.sheets[String(gid)] = {
        name: String(sheet.name || ""),
        columns,
        propertyDefinitions,
        updatedAt: Number(sheet.updatedAt || clean.updatedAt)
      };
    }
    for (const [key, view] of Object.entries(workspace.sheetViews || {})) {
      if (!view || typeof view !== "object") continue;
      const columns = clean.sheets[String(key)]?.columns || [];
      const ids = new Set(columns.map((column) => column.id));
      const calendarColumnId = String(view.calendarColumnId || "");
      const kanbanColumnId = String(view.kanbanColumnId || "");
      clean.sheetViews[String(key)] = {
        calendarColumnId: columns.some((column) => column.id === calendarColumnId && column.type === "date") ? calendarColumnId : "",
        kanbanColumnId: columns.some((column) => column.id === kanbanColumnId && column.type === "status") ? kanbanColumnId : "",
        kanbanColumns: Math.min(10, Math.max(1, Math.round(Number(view.kanbanColumns) || 3))),
        kanbanGroupOrder: [...new Set((Array.isArray(view.kanbanGroupOrder) ? view.kanbanGroupOrder : [])
          .map((groupId) => String(groupId || "").trim())
          .filter(Boolean))],
        kanbanHeight: Math.max(150, Math.round(Number(view.kanbanHeight) || 600)),
        kanbanRowOrder: [...new Set((Array.isArray(view.kanbanRowOrder) ? view.kanbanRowOrder : [])
          .map(Number)
          .filter((rowNumber) => Number.isInteger(rowNumber) && rowNumber > 0))],
        kanbanView: view.kanbanView === "row" ? "row" : "grid",
        hiddenColumnIds: [...new Set((Array.isArray(view.hiddenColumnIds) ? view.hiddenColumnIds : [])
          .map((id) => String(id || "").trim())
          .filter((id) => ids.has(id)))]
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
    scheduleCloudWorkspaceWrite();
    return state.workspaceWriteQueue;
  }

  function applyCloudWorkspace(workspace, revision = 0) {
    state.workspace = normalizeWorkspace(workspace);
    state.workspacePromise = Promise.resolve(state.workspace);
    state.cloudWorkspaceRevision = Number(revision) || 0;
    const area = storageArea();
    if (area) {
      const key = workspaceKey();
      state.workspaceWriteQueue = state.workspaceWriteQueue.then(() => area.set({ [key]: state.workspace })).catch(() => {});
    }
    if (state.fields.length) {
      reconcileSheetConfiguration(currentGid(), state.sheetName || activeSheetName() || `Hoja ${currentGid()}`, state.fields);
      discardProtectedDrafts();
      renderFields(new Map([...state.primaryDrafts.values()].map((draft) => [draft.index, draft.value])));
      renderSheetViewActions();
      if (state.row && state.values.length) startRelationships(state.fields, state.values, state.request?.signal, true);
    }
  }

  async function hydrateCloudWorkspace() {
    if (!state.cloudRequired || !cloudAccessAllowed() || state.cloudWorkspaceHydrated) return state.workspace;
    await ensureWorkspaceLoaded();
    const result = await cloudMessage("workspace.get", { spreadsheetId: spreadsheetId() });
    if (!result?.ok) {
      host.dataset.cloudSync = "error";
      if ([401, 403].includes(result?.status)) await refreshCloudAccess();
      return state.workspace;
    }
    state.cloudWorkspaceHydrated = true;
    if (!result.found) {
      await persistCloudWorkspace();
      return state.workspace;
    }
    const remote = normalizeWorkspace(result.workspace);
    state.cloudWorkspaceRevision = Number(result.revision) || 0;
    if (Number(remote.updatedAt || 0) >= Number(state.workspace?.updatedAt || 0)) {
      applyCloudWorkspace(remote, result.revision);
    } else {
      await persistCloudWorkspace();
    }
    host.dataset.cloudSync = "ready";
    return state.workspace;
  }

  function scheduleCloudWorkspaceWrite() {
    if (!state.cloudRequired || !cloudAccessAllowed() || !state.cloudWorkspaceHydrated) return;
    window.clearTimeout(state.cloudWorkspaceTimer);
    state.cloudWorkspaceTimer = window.setTimeout(() => {
      state.cloudWorkspaceTimer = null;
      void persistCloudWorkspace();
    }, 350);
  }

  function persistCloudWorkspace() {
    if (!state.cloudRequired || !cloudAccessAllowed() || !state.workspace) return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify(state.workspace));
    state.cloudWorkspaceWriteQueue = state.cloudWorkspaceWriteQueue.then(async () => {
      host.dataset.cloudSync = "saving";
      let result = await cloudMessage("workspace.put", {
        spreadsheetId: spreadsheetId(),
        name: panelDocument.title || document.title || activeSheetName(),
        workspace: snapshot,
        revision: state.cloudWorkspaceRevision
      });
      if (!result?.ok && result?.code === "WORKSPACE_CONFLICT") {
        const latest = await cloudMessage("workspace.get", { spreadsheetId: spreadsheetId() });
        if (latest?.ok && latest.found) {
          const remote = normalizeWorkspace(latest.workspace);
          if (Number(remote.updatedAt || 0) > Number(snapshot.updatedAt || 0)) {
            applyCloudWorkspace(remote, latest.revision);
            host.dataset.cloudSync = "ready";
            return;
          }
          result = await cloudMessage("workspace.put", {
            spreadsheetId: spreadsheetId(),
            name: document.title || activeSheetName(),
            workspace: snapshot,
            revision: latest.revision
          });
        }
      }
      if (!result?.ok) {
        host.dataset.cloudSync = "error";
        if ([401, 403].includes(result?.status)) await refreshCloudAccess();
        return;
      }
      state.cloudWorkspaceRevision = Number(result.revision) || state.cloudWorkspaceRevision;
      host.dataset.cloudSync = "ready";
    }).catch(() => { host.dataset.cloudSync = "error"; });
    return state.cloudWorkspaceWriteQueue;
  }

  function reconcileSheetConfiguration(gid, sheetName, headers) {
    if (!state.workspace) state.workspace = createWorkspace();
    const key = String(gid);
    const previous = state.workspace.sheets[key];
    const propertyDefinitions = { ...(previous?.propertyDefinitions || {}) };
    const columns = assignCurrentPropertyIds(headers.map((header, index) => {
      const cleanHeader = String(header || "");
      const headerKey = propertyHeaderKey(cleanHeader);
      const candidate = headerKey ? propertyDefinitions[headerKey] : null;
      if (!candidate) return defaultProperty(index, cleanHeader);
      const normalized = normalizeProperty(candidate, index, cleanHeader);
      if (!normalized.customName) normalized.name = cleanHeader || defaultProperty(index).name;
      return normalized;
    }));
    for (const column of columns) rememberPropertyDefinition(propertyDefinitions, column);
    const changed = !previous
      || previous.name !== sheetName
      || !sameValues(previous.columns, columns)
      || !sameValues(previous.propertyDefinitions || {}, propertyDefinitions);
    const next = {
      name: sheetName,
      columns,
      propertyDefinitions,
      updatedAt: changed ? Date.now() : Number(previous.updatedAt || Date.now())
    };
    state.workspace.sheets[key] = next;
    if (changed) void writeWorkspace();
    return next;
  }

  function currentSheetConfiguration() {
    return state.workspace?.sheets?.[configuredSheetGid(drawerGid(), state.sheetName)] || null;
  }

  function currentSheetViewSettings() {
    return state.workspace?.sheetViews?.[configuredSheetGid(drawerGid(), state.sheetName)] || {};
  }

  function configuredSheetGid(gid = drawerGid(), sheetName = "") {
    const key = String(gid ?? "");
    const configured = state.workspace?.sheets || {};
    const exact = configured[key];
    if (exact && (!sheetName || normalizedColumn(exact.name) === normalizedColumn(sheetName))) return key;
    if (sheetName) {
      const named = Object.entries(configured).find(([, sheet]) =>
        normalizedColumn(sheet?.name) === normalizedColumn(sheetName)
      );
      if (named) return String(named[0]);
    }
    return key;
  }

  function sheetHiddenColumnIds(gid = drawerGid(), sheetName = "") {
    const ids = state.workspace?.sheetViews?.[configuredSheetGid(gid, sheetName)]?.hiddenColumnIds;
    return Array.isArray(ids) ? ids : [];
  }

  function visibleColumnsForSheet(gid, columns, sheetName = "") {
    const hidden = new Set(sheetHiddenColumnIds(gid, sheetName));
    return (columns || []).filter((column) => !hidden.has(column.id));
  }

  function setCurrentSheetViewSetting(name, value) {
    setSheetViewSetting(configuredSheetGid(drawerGid(), state.sheetName), name, value);
  }

  function setSheetViewSetting(gid, name, value) {
    if (!state.workspace) state.workspace = createWorkspace();
    if (!state.workspace.sheetViews) state.workspace.sheetViews = {};
    const key = String(gid);
    const previous = state.workspace.sheetViews[key] || {};
    const nextValue = Array.isArray(value)
      ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
      : typeof value === "boolean" ? value : String(value || "");
    if (sameValues(previous[name], nextValue)) return;
    state.workspace.sheetViews[key] = {
      ...previous,
      [name]: nextValue
    };
    void writeWorkspace();
  }

  function relationViewKey(sheetName) {
    return `${drawerGid()}:${normalizedColumn(sheetName)}`;
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

  function propertyEditorSheet() {
    if (state.propertyTarget?.gid) {
      return state.workspace?.sheets?.[String(state.propertyTarget.gid)] || null;
    }
    return currentSheetConfiguration();
  }

  function propertyForEditorColumn(index) {
    const sheet = propertyEditorSheet();
    return sheet?.columns?.[index]
      || defaultProperty(index, state.propertyTarget ? "" : (state.fields[index] || ""));
  }

  function currentSourceLabels() {
    const columns = currentSheetConfiguration()?.columns || [];
    return state.fields.map((label, index) => String(columns[index]?.sourceHeader ?? label));
  }

  function sameValues(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function usedCellWidth(...rows) {
    let width = 0;
    for (const cells of rows) {
      for (let index = 0; index < (cells?.length || 0); index += 1) {
        if (String(cells[index] ?? "").trim()) width = Math.max(width, index + 1);
      }
    }
    return width;
  }

  function fitCells(cells, width) {
    return Array.from({ length: width }, (_, index) => String(cells?.[index] ?? ""));
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

  async function readNamedSheetRow(sheetName, rowNumber, signal, gid = null) {
    if (gid !== null && gid !== undefined) {
      const rows = await readRange(
        `A${rowNumber}:${MAX_COLUMN}${rowNumber}`,
        signal,
        String(gid),
        { allowEmpty: true }
      );
      return rows.find((row) => row.number === rowNumber)?.cells || [];
    }
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

  function relationSheetConfiguration(relation) {
    const configuredSheets = state.workspace?.sheets || {};
    const targetName = normalizedColumn(relation.sheetName);
    const columns = displayRelationColumns(relation);
    const headerMatchCount = (sheet) => columns.reduce((count, column) => {
      const sourceHeader = sheet.columns?.[column.propertyIndex]?.sourceHeader;
      return count + (normalizedColumn(sourceHeader) === normalizedColumn(column.header) ? 1 : 0);
    }, 0);
    const minimumHeaderMatches = Math.max(1, Math.ceil(columns.length * 0.6));
    const direct = relation.sheetGid ? configuredSheets[String(relation.sheetGid)] : null;
    if (
      direct
      && (
        normalizedColumn(direct.name) === targetName
        || headerMatchCount(direct) >= minimumHeaderMatches
      )
    ) return direct;

    const candidates = Object.values(configuredSheets)
      .map((sheet) => ({
        sheet,
        nameMatches: normalizedColumn(sheet.name) === targetName,
        headerMatches: headerMatchCount(sheet)
      }));
    const namedCandidates = candidates.filter((candidate) => candidate.nameMatches);
    const matchingCandidates = namedCandidates.length
      ? namedCandidates
      : candidates.filter((candidate) => candidate.headerMatches >= minimumHeaderMatches);
    matchingCandidates.sort((left, right) =>
      right.headerMatches - left.headerMatches
      || Number(right.sheet.updatedAt || 0) - Number(left.sheet.updatedAt || 0)
    );
    return matchingCandidates[0]?.sheet || null;
  }

  function relatedProperty(relation, column) {
    return relationSheetConfiguration(relation)?.columns?.[column.propertyIndex]
      || defaultProperty(column.propertyIndex, column.header);
  }

  function relationConfiguredGid(relation, configured = relationSheetConfiguration(relation)) {
    let gid = String(relation.sheetGid || "");
    if (!gid) {
      gid = String(visibleSheets().find((sheet) =>
        normalizedColumn(sheet.name) === normalizedColumn(relation.sheetName)
      )?.gid || "");
    }
    if (!gid && configured) {
      gid = String(Object.entries(state.workspace?.sheets || {}).find(([, sheet]) => sheet === configured)?.[0] || "");
    }
    return gid;
  }

  function visibleRelationColumns(relation) {
    const configured = relationSheetConfiguration(relation);
    const hidden = new Set(sheetHiddenColumnIds(relationConfiguredGid(relation, configured), relation.sheetName));
    return displayRelationColumns(relation).filter((column) => {
      const property = configured?.columns?.[column.propertyIndex]
        || defaultProperty(column.propertyIndex, column.header);
      return !hidden.has(property.id);
    });
  }

  function relationConfigurationHeaders(relation, configured = relationSheetConfiguration(relation)) {
    const columns = displayRelationColumns(relation);
    const width = Math.max(
      configured?.columns?.length || 0,
      ...columns.map((column) => column.propertyIndex + 1),
      0
    );
    const headers = Array.from(
      { length: width },
      (_, index) => String(configured?.columns?.[index]?.sourceHeader || "")
    );
    for (const column of columns) headers[column.propertyIndex] = String(column.header || "");
    return headers;
  }

  function relationPropertyTarget(relation) {
    const configured = relationSheetConfiguration(relation);
    const gid = relationConfiguredGid(relation, configured);
    if (!gid) return null;
    const headers = relationConfigurationHeaders(relation, configured);
    reconcileSheetConfiguration(gid, relation.sheetName, headers);
    return { kind: "related", gid, sheetName: relation.sheetName };
  }

  function openRelatedPropertyEditor(relation, column) {
    const target = relationPropertyTarget(relation);
    if (!target) {
      setStatus(`No pude identificar la configuración de ${relation.sheetName}`, "error");
      return;
    }
    openPropertyEditor(column.propertyIndex, target);
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

  function cancelScheduledRelatedDraftNotification() {
    if (!state.relatedDraftNotifyTimer) return;
    panelFrame.contentWindow.clearTimeout(state.relatedDraftNotifyTimer);
    state.relatedDraftNotifyTimer = null;
  }

  function notifyRelatedDrafts() {
    cancelScheduledRelatedDraftNotification();
    state.relatedDraftVersion += 1;
    for (const listener of state.relatedDraftListeners) listener();
    syncPendingActions();
  }

  function scheduleRelatedDraftNotification() {
    cancelScheduledRelatedDraftNotification();
    state.relatedDraftNotifyTimer = panelFrame.contentWindow.setTimeout(() => {
      state.relatedDraftNotifyTimer = null;
      notifyRelatedDrafts();
    }, 180);
  }

  function subscribeRelatedDraftCell(key, listener) {
    if (!state.relatedDraftCellListeners.has(key)) state.relatedDraftCellListeners.set(key, new Set());
    const listeners = state.relatedDraftCellListeners.get(key);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) state.relatedDraftCellListeners.delete(key);
    };
  }

  function notifyRelatedDraftCell(key) {
    for (const listener of state.relatedDraftCellListeners.get(key) || []) listener();
  }

  function useRelatedDraftVersion() {
    return React.useSyncExternalStore(subscribeRelatedDrafts, relatedDraftSnapshot, relatedDraftSnapshot);
  }

  function useRelatedDraftValue(relation, row, column) {
    const key = relatedDraftKey(relation.sheetName, row.number, column.propertyIndex);
    const fallback = String(row.cells[column.index] ?? "");
    const subscribe = React.useCallback((listener) => subscribeRelatedDraftCell(key, listener), [key]);
    const snapshot = React.useCallback(() => state.relatedDrafts.get(key)?.value ?? fallback, [fallback, key]);
    return React.useSyncExternalStore(subscribe, snapshot, snapshot);
  }

  function relatedDraftValue(relation, row, column) {
    const key = relatedDraftKey(relation.sheetName, row.number, column.propertyIndex);
    return state.relatedDrafts.get(key)?.value ?? String(row.cells[column.index] ?? "");
  }

  function setRelatedDraft(relation, row, column, editorValue) {
    const property = relatedProperty(relation, column);
    if (property.protected || (row.isNew && column.propertyIndex === Number(relation.matchIndex))) return;
    const key = relatedDraftKey(relation.sheetName, row.number, column.propertyIndex);
    const existing = state.relatedDrafts.get(key);
    const hadDraft = Boolean(existing);
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
    notifyRelatedDraftCell(key);
    syncPendingActions();
    if (hadDraft !== state.relatedDrafts.has(key)) notifyRelatedDrafts();
    else scheduleRelatedDraftNotification();
  }

  function relatedDraftsForRow(sheetName, rowNumber) {
    return [...state.relatedDrafts.values()].filter((draft) =>
      draft.sheetName === sheetName && draft.rowNumber === rowNumber
    );
  }

  function discardRelatedDrafts(predicate = () => true) {
    let changed = false;
    const changedKeys = [];
    for (const [key, draft] of state.relatedDrafts) {
      if (!predicate(draft)) continue;
      state.relatedDrafts.delete(key);
      changedKeys.push(key);
      changed = true;
    }
    if (changed) {
      for (const key of changedKeys) notifyRelatedDraftCell(key);
      notifyRelatedDrafts();
    }
  }

  function RelatedCellEditor({ relation, row, column }) {
    const property = relatedProperty(relation, column);
    const relationKeyLocked = row.isNew && column.propertyIndex === Number(relation.matchIndex);
    const editorProperty = relationKeyLocked ? { ...property, protected: true } : property;
    const rawValue = useRelatedDraftValue(relation, row, column);
    return React.createElement(
      "div",
      {
        className: "related-cell-editor",
        "data-related-sheet": relation.sheetName,
        "data-related-row": String(row.number),
        "data-related-column": String(column.propertyIndex + 1),
        "data-field-type": property.type,
        "data-protected": editorProperty.protected ? "true" : "false"
      },
      React.createElement(PropertyEditorControl, {
        property: editorProperty,
        value: editorValueFromRaw(rawValue, editorProperty),
        onChange: (nextValue) => setRelatedDraft(relation, row, column, nextValue)
      })
    );
  }

  function RelatedRecordCard({ relation, columns, row, onOpen }) {
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
          const property = relatedProperty(relation, column);
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

  function RelatedRecordDrawer({ relation, columns, row, open, onClose, onReopen }) {
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
    const save = () => {
      const currentRowDrafts = relatedDraftsForRow(relation.sheetName, row.number);
      const pendingSave = saveRelatedChanges(currentRowDrafts, { onVerificationFailed: onReopen });
      onClose();
      void pendingSave.then((saved) => {
        if (!saved) onReopen();
      }).catch((error) => {
        setStatus(error?.message || "No se pudo guardar el registro relacionado", "error");
        onReopen();
      });
    };

    return React.createElement(
      Drawer,
      {
        open,
        onClose: row.isNew ? discard : onClose,
        width: 720,
        destroyOnClose: true,
        className: "record-drawer related-record-drawer",
        rootClassName: "related-record-drawer-root",
        getContainer: () => panelDocument.body,
        title: row.isNew
          ? `Nuevo registro · ${relation.sheetName}`
          : `${relation.sheetName} · fila ${row.number}`,
        footer: React.createElement(
          "div",
          { className: "related-drawer-footer" },
          React.createElement(Button, { onClick: discard, disabled: state.saving || !rowDrafts.length }, "Cancelar"),
          React.createElement(Button, {
            type: "primary",
            disabled: state.saving || !rowDrafts.length,
            onClick: save
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
            const property = relatedProperty(relation, column);
            return React.createElement(
              "div",
              { className: "field", key: `${column.propertyIndex}:${column.header}` },
              React.createElement(
                "div",
                { className: "field-label" },
                React.createElement(
                  "button",
                  {
                    className: "field-configure property-type-icon related-field-icon",
                    type: "button",
                    title: `Configurar ${property.name || column.header}`,
                    "aria-label": `Configurar ${property.name || column.header}`,
                    "data-configure-related-column": String(column.propertyIndex + 1),
                    onClick: () => openRelatedPropertyEditor(relation, column)
                  },
                  typeBadge(property.type)
                ),
                React.createElement(
                  "div",
                  { className: "field-label-copy" },
                  React.createElement(
                    "button",
                    {
                      className: "field-label-text",
                      type: "button",
                      title: `Configurar ${property.name || column.header}`,
                      onClick: () => openRelatedPropertyEditor(relation, column)
                    },
                    property.name || column.header
                  ),
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

  function relationAllowsCreation(relation) {
    return relation.creationMode === "child" || (
      !relation.creationMode && String(relation.description || "").startsWith("Lista relacionada")
    );
  }

  async function prepareRelatedRecord(relation) {
    if (!relationAllowsCreation(relation)) {
      throw new Error("Esta relación apunta a un registro principal existente y no admite altas desde aquí.");
    }
    if (state.primaryDrafts.size || state.relatedDrafts.size) {
      throw new Error("Guarda o cancela los cambios pendientes antes de agregar un registro relacionado.");
    }

    setActivity("creation", true);
    try {
      await waitForRecordCreationReady();
      const table = await readSheetTable(relation.sheetName, `A1:${MAX_COLUMN}`, undefined);
      const width = usedCellWidth(table.headers);
      if (!width) throw new Error(`La hoja ${relation.sheetName} necesita encabezados antes de agregar registros.`);
      if (relation.sheetGid) reconcileSheetConfiguration(relation.sheetGid, relation.sheetName, fitCells(table.headers, width));
      const configured = relationSheetConfiguration(relation);
      const properties = Array.from({ length: width }, (_, index) => (
        configured?.columns?.[index] || defaultProperty(index, table.headers[index] || "")
      ));
      const seeded = randomIdDrafts(properties, table.rows);
      const matchIndex = Number(relation.matchIndex);
      if (!Number.isInteger(matchIndex) || matchIndex < 0 || !relation.matchValue) {
        throw new Error("No pude determinar la columna que vincula este relacionado.");
      }
      seeded.set(matchIndex, {
        index: matchIndex,
        value: String(relation.matchValue),
        systemGenerated: true
      });

      const columns = displayRelationColumns(relation);
      const row = {
        number: nextRecordRowNumber(table),
        cells: Array.from({ length: relation.headers.length }, () => ""),
        isNew: true
      };
      for (const [columnIndex, seed] of seeded) {
        const column = columns.find((candidate) => candidate.propertyIndex === columnIndex);
        if (!column) continue;
        const property = properties[columnIndex];
        const key = relatedDraftKey(relation.sheetName, row.number, columnIndex);
        state.relatedDrafts.set(key, {
          key,
          sheetName: relation.sheetName,
          rowNumber: row.number,
          columnIndex,
          cellIndex: column.index,
          value: seed.value,
          previousValue: "",
          property,
          relation,
          row,
          systemGenerated: true,
          isNewRecord: true
        });
      }
      notifyRelatedDrafts();
      return row;
    } finally {
      setActivity("creation", false);
    }
  }

  function RelationSection({ relation, initialView }) {
    useRelatedDraftVersion();
    const [expanded, setExpanded] = React.useState(true);
    const [view, setView] = React.useState(initialView);
    const [page, setPage] = React.useState(1);
    const [openRow, setOpenRow] = React.useState(null);
    const [recordDrawerOpen, setRecordDrawerOpen] = React.useState(false);
    const creating = React.useRef(false);
    const openingFrame = React.useRef(0);
    const mounted = React.useRef(true);
    const columns = visibleRelationColumns(relation);
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

    const closeRecordDrawer = () => {
      if (openingFrame.current) panelFrame.contentWindow.cancelAnimationFrame(openingFrame.current);
      openingFrame.current = 0;
      setRecordDrawerOpen(false);
    };

    const openRecordDrawer = (row) => {
      if (!row || !mounted.current) return;
      if (openingFrame.current) panelFrame.contentWindow.cancelAnimationFrame(openingFrame.current);
      setRecordDrawerOpen(false);
      setOpenRow(row);
      openingFrame.current = panelFrame.contentWindow.requestAnimationFrame(() => {
        openingFrame.current = 0;
        setRecordDrawerOpen(true);
      });
    };

    React.useEffect(() => () => {
      mounted.current = false;
      if (openingFrame.current) panelFrame.contentWindow.cancelAnimationFrame(openingFrame.current);
    }, []);

    const addRelatedRecord = async () => {
      if (creating.current) return;
      creating.current = true;
      try {
        openRecordDrawer(await prepareRelatedRecord(relation));
        setStatus("");
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        creating.current = false;
      }
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
          relationAllowsCreation(relation) ? React.createElement(Button, {
            type: "text",
            shape: "circle",
            size: "small",
            icon: React.createElement(PlusOutlined),
            title: `Agregar registro en ${relation.sheetName}`,
            "aria-label": `Agregar registro en ${relation.sheetName}`,
            "data-add-related-record": relation.sheetName,
            onClick: () => void addRelatedRecord()
          }) : null,
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
            onOpen: () => openRecordDrawer(row),
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
        open: recordDrawerOpen,
        onClose: closeRecordDrawer,
        onReopen: () => openRecordDrawer(openRow)
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
        sheetGid: String(relation.sheetGid || ""),
        description: relation.description,
        matchIndex: Number(relation.matchIndex),
        matchValue: String(relation.matchValue || ""),
        creationMode: relation.creationMode === "reference" ? "reference" : "child",
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
    const signature = JSON.stringify({
      relations: storedRelations(relations),
      configurations: relations.map((relation) => ({
        sheetName: relation.sheetName,
        sheetGid: String(relation.sheetGid || ""),
        updatedAt: Number(relationSheetConfiguration(relation)?.updatedAt || 0)
      }))
    });
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
    const currentSheet = state.sheetName || activeSheetName();
    const persistentKey = cacheKey("relations", drawerGid(), state.row);
    const cached = await readPersistentCache(persistentKey);
    if (signal?.aborted) return;
    const usableCache = cached?.currentSheet === currentSheet && Array.isArray(cached.relations);
    if (usableCache) {
      showRelations(cached.relations);
      setRelatedStatus("Mostrando relacionados guardados · comprobando cambios…", true);
    } else {
      setRelatedStatus("Detectando relaciones por columnas ID…", true);
    }

    const otherSheets = visibleSheets().filter((sheet) => sheet.name !== currentSheet);
    if (!otherSheets.length) {
      showRelations([]);
      setRelatedStatus("No hay otras hojas visibles en este documento.");
      void writePersistentCache(persistentKey, { currentSheet, relations: [], updatedAt: Date.now() });
      return;
    }

    try {
      const metadataResults = await Promise.allSettled(
        otherSheets.map(async (sheet) => ({
          ...await cachedSheetTable(sheet.name, false, signal),
          gid: sheet.gid
        }))
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
              sheetGid: table.gid,
              matchIndex: foreignIndex,
              matchValue: keyValue,
              creationMode: "child",
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
              sheetGid: table.gid,
              matchIndex: otherPrimary,
              matchValue: keyValue,
              creationMode: "reference",
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

  async function headers(signal, force = false, gid = currentGid()) {
    const key = `${spreadsheetId()}:${gid}`;
    if (!force && state.headerCache.has(key)) return state.headerCache.get(key);
    const rows = await readRange(`A1:${MAX_COLUMN}1`, signal, gid);
    const rawLabels = rows.find((row) => row.number === 1)?.cells || [];
    const labels = fitCells(rawLabels, usedCellWidth(rawLabels));
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
    if (["status", "select"].includes(property.type)) {
      return String(left ?? "").trim() === String(right ?? "").trim();
    }
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

  function discardProtectedDrafts() {
    let primaryChanged = false;
    let relatedChanged = false;
    for (const [index] of state.primaryDrafts) {
      if (!propertyForColumn(index).protected) continue;
      if (state.primaryDrafts.get(index)?.systemGenerated) continue;
      state.primaryDrafts.delete(index);
      primaryChanged = true;
    }
    for (const [key, draft] of state.relatedDrafts) {
      const property = relatedProperty(draft.relation, {
        propertyIndex: draft.columnIndex,
        header: draft.property?.sourceHeader || draft.property?.name || ""
      });
      if (!property.protected) continue;
      if (draft.systemGenerated) continue;
      state.relatedDrafts.delete(key);
      relatedChanged = true;
    }
    if (relatedChanged) notifyRelatedDrafts();
    else if (primaryChanged) syncPendingActions();
  }

  function collectPendingChanges() {
    discardProtectedDrafts();
    return [...state.primaryDrafts.values()].sort((left, right) => left.index - right.index);
  }

  function syncPendingActions() {
    const ready = Boolean(state.row && state.viewRow === state.row && state.viewGid === state.gid);
    const hasChanges = ready && (state.primaryDrafts.size > 0 || state.relatedDrafts.size > 0);
    const blocked = state.saving || hasPendingWriteVerification();
    ui.save.disabled = blocked || !hasChanges;
    ui.cancel.disabled = blocked || (!hasChanges && !state.primaryCreation);
    host.dataset.hasPendingChanges = hasChanges ? "true" : "false";
  }

  function cancelChanges() {
    if (state.primaryCreation) {
      void cancelPrimaryRecordCreation();
      return;
    }
    if (state.saving || state.viewRow !== state.row || state.viewGid !== state.gid) return;
    state.primaryDrafts.clear();
    renderFields();
    discardRelatedDrafts();
    setStatus(`Cambios descartados · fila ${state.row}`);
    syncPendingActions();
  }

  function applyRowData(labels, values, row, signal) {
    const width = usedCellWidth(labels, values);
    const sourceLabels = fitCells(labels, width);
    state.values = fitCells(values, width);
    state.fields = sourceLabels.map((label, index) => label || `Columna ${columnName(index + 1)}`);
    reconcileSheetConfiguration(drawerGid(), state.sheetName || activeSheetName() || `Hoja ${drawerGid()}`, sourceLabels);
    renderSheetViewActions();
    setEmptyState(false);
    renderFields(new Map([...state.primaryDrafts.values()].map((draft) => [draft.index, draft.value])));
    state.viewRow = row;
    state.viewGid = drawerGid();
    host.dataset.row = String(row);
    ui.fields.inert = false;
    ui.fields.removeAttribute("aria-busy");
    syncPendingActions();
    startRelationships(sourceLabels, state.values, signal);
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
    const width = usedCellWidth(labels);
    const sourceLabels = fitCells(labels, width);
    state.fields = sourceLabels.map((label, index) => label || `Columna ${columnName(index + 1)}`);
    state.values = Array.from({ length: width }, () => "");
    state.primaryDrafts.clear();
    reconcileSheetConfiguration(drawerGid(), state.sheetName || activeSheetName() || `Hoja ${drawerGid()}`, sourceLabels);
    renderSheetViewActions();
    state.viewRow = row;
    state.viewGid = drawerGid();
    host.dataset.row = String(row);
    clearRenderedFields();
    clearRelations();
    setRelatedStatus("", true);
    setEmptyState(true);
    ui.fields.inert = false;
    ui.fields.removeAttribute("aria-busy");
    syncPendingActions();
  }

  async function beginPrimaryRecordCreation(target = null) {
    if (state.primaryDrafts.size || state.relatedDrafts.size) {
      setStatus("Guarda o cancela los cambios pendientes antes de agregar un registro.", "error");
      return;
    }

    const gid = String(target?.gid || currentGid());
    const sheetName = String(target?.name || activeSheetName() || state.sheetName || `Hoja ${gid}`);
    setActivity("creation", true);
    try {
      await waitForRecordCreationReady();
      const table = await readSheetTable(sheetName, `A1:${MAX_COLUMN}`, undefined);
      const width = usedCellWidth(table.headers);
      if (!width) throw new Error("La hoja necesita encabezados antes de agregar registros.");
      const sourceLabels = fitCells(table.headers, width);
      const configured = reconcileSheetConfiguration(gid, sheetName, sourceLabels);
      const properties = sourceLabels.map((label, index) => configured.columns[index] || defaultProperty(index, label));
      const drafts = randomIdDrafts(properties, table.rows);
      const row = nextRecordRowNumber(table);

      state.request?.abort();
      state.relationRequest?.abort();
      state.request = null;
      state.relationRequest = null;
      state.primaryCreation = {
        gid,
        sheetName,
        row,
        returnRow: state.row,
        returnGid: state.gid
      };
      state.row = row;
      state.gid = gid;
      state.sheetName = sheetName;
      state.viewRow = row;
      state.viewGid = gid;
      state.fields = sourceLabels.map((label, index) => label || `Columna ${columnName(index + 1)}`);
      state.values = Array.from({ length: width }, () => "");
      state.primaryDrafts = drafts;
      host.dataset.row = String(row);
      host.dataset.creatingRecord = "true";
      ui.meta.textContent = `${sheetName} · nuevo registro en fila ${row}`;
      clearRelations();
      setRelatedStatus("Guarda el registro para buscar sus relaciones.", false);
      setEmptyState(false);
      ui.fields.inert = false;
      ui.fields.removeAttribute("aria-busy");
      renderFields(new Map([...drafts].map(([index, draft]) => [index, draft.value])));
      setStatus(`Nuevo registro preparado en la fila ${row}`);
      syncPendingActions();
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setActivity("creation", false);
    }
  }

  async function cancelPrimaryRecordCreation() {
    if (state.saving) return;
    const creation = state.primaryCreation;
    state.primaryCreation = null;
    delete host.dataset.creatingRecord;
    state.primaryDrafts.clear();
    syncPendingActions();
    const selected = selectedRow(nameBoxValue());
    const row = creation?.returnGid === currentGid() && creation?.returnRow > 1
      ? creation.returnRow
      : selected > 1
        ? selected
        : null;
    if (row) await loadRow(row, true);
    else {
      state.lastSelection = "";
      pollSelection();
    }
  }

  async function loadRow(row, force = false, target = null) {
    const gid = String(target?.gid || currentGid());
    const sheetName = String(target?.name || activeSheetName() || `Hoja ${gid}`);
    if (
      !force
      && state.loading
      && row === state.row
      && gid === state.gid
      && normalizedColumn(sheetName) === normalizedColumn(state.sheetName)
    ) return;
    if (state.row !== row || state.gid !== gid) state.primaryDrafts.clear();
    if (state.gid !== null && gid !== state.gid) state.sheetCache.clear();
    state.request?.abort();
    const request = new AbortController();
    state.request = request;
    state.loading = true;
    setActivity("row", true);
    state.row = row;
    state.gid = gid;
    state.sheetName = sheetName;
    renderSheetViewActions();
    syncPendingActions();
    ui.fields.inert = true;
    ui.fields.setAttribute("aria-busy", "true");
    setRelatedStatus("Detectando hojas y relaciones…", true);
    ui.meta.textContent = `${sheetName} · fila ${row}`;
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
        headers(request.signal, true, gid),
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
      const cachedPendingChanges = Array.isArray(cached?.pendingChanges) ? cached.pendingChanges : [];
      const pendingSince = Number(cached?.pendingSince || cached?.updatedAt || 0);
      const pendingChanges = Date.now() - pendingSince < 20_000 ? cachedPendingChanges : [];
      const pendingWidth = pendingChanges.reduce((width, change) => Math.max(width, Number(change.index) + 1 || 0), 0);
      const width = Math.max(usedCellWidth(labels, values), pendingWidth);
      const freshValues = fitCells(values, width);
      const freshLabels = fitCells(labels, width);
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
        const draftCount = state.primaryDrafts.size;
        applyRowData(freshLabels, effectiveValues, row, request.signal);
        setStatus(draftCount
          ? `Datos actualizados en segundo plano · ${draftCount} cambio(s) tuyos conservados`
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
    const hiddenColumnIds = new Set(sheetHiddenColumnIds(drawerGid(), state.sheetName));
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
      wrapper.dataset.protected = property.protected ? "true" : "false";
      wrapper.dataset.columnId = property.id;
      wrapper.hidden = hiddenColumnIds.has(property.id);
      let control = editor.querySelector("[data-column]");
      if (!control || control.dataset.fieldType !== property.type) {
        if (control?._reactRoot) flushSync(() => control._reactRoot.unmount());
        control = createFieldControl(property, index);
        editor.replaceChildren(control);
      }
      control.dataset.column = String(index + 1);
      control.dataset.protected = property.protected ? "true" : "false";
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

  function PropertyProtectionControl({ initialValue }) {
    return React.createElement(Checkbox, {
      defaultChecked: initialValue === true,
      name: "protected"
    }, "Proteger");
  }

  function PropertyRandomIdControl({ initialEnabled, initialLength }) {
    const [enabled, setEnabled] = React.useState(initialEnabled === true);
    const [length, setLength] = React.useState(Math.min(64, Math.max(1, Number(initialLength) || 12)));
    return React.createElement(
      "div",
      { className: "property-random-id" },
      React.createElement(Checkbox, {
        checked: enabled,
        name: "randomId",
        onChange: (event) => setEnabled(event.target.checked)
      }, "Usar como ID aleatorio"),
      React.createElement(
        "label",
        { className: "property-random-id-length" },
        React.createElement("span", null, "Longitud de caracteres"),
        React.createElement(InputNumber, {
          min: 1,
          max: 64,
          precision: 0,
          value: length,
          disabled: !enabled,
          onChange: (value) => setLength(Math.min(64, Math.max(1, Number(value) || 12)))
        })
      ),
      React.createElement("input", {
        type: "hidden",
        name: "randomIdLength",
        value: String(length),
        readOnly: true
      }),
      React.createElement(
        "div",
        { className: "property-help" },
        "Al crear un registro, completa este campo con letras y números generados al azar."
      )
    );
  }

  function renderPropertyTypeSelect() {
    if (!ui.propertyTypeHost._reactRoot) ui.propertyTypeHost._reactRoot = createRoot(ui.propertyTypeHost);
    const selector = React.createElement(PropertyTypeControl, {
      key: `${state.propertyTarget?.gid || drawerGid()}:${state.propertyColumn}:${ui.propertyType.value}`,
      initialValue: ui.propertyType.value
    });
    flushSync(() => ui.propertyTypeHost._reactRoot.render(antdTree(selector)));
  }

  function renderPropertySettings(reset = false) {
    const index = state.propertyColumn;
    if (index === null) return;
    const property = propertyForEditorColumn(index);
    const type = ui.propertyType.value;
    const existingProtection = ui.propertyForm.elements.namedItem("protected");
    const protectedValue = reset || !(existingProtection instanceof panelFrame.contentWindow.HTMLInputElement)
      ? property.protected
      : existingProtection.checked;
    const existingRandomId = ui.propertyForm.elements.namedItem("randomId");
    const existingRandomIdLength = ui.propertyForm.elements.namedItem("randomIdLength");
    const randomIdValue = reset || !(existingRandomId instanceof panelFrame.contentWindow.HTMLInputElement)
      ? property.randomId
      : existingRandomId.checked;
    const randomIdLengthValue = reset || !(existingRandomIdLength instanceof panelFrame.contentWindow.HTMLInputElement)
      ? property.randomIdLength
      : existingRandomIdLength.value;
    ui.propertySettings._optionsRoot?.unmount();
    ui.propertySettings._protectionRoot?.unmount();
    ui.propertySettings._randomIdRoot?.unmount();
    delete ui.propertySettings._optionsRoot;
    delete ui.propertySettings._protectionRoot;
    delete ui.propertySettings._randomIdRoot;
    ui.propertySettings.replaceChildren();

    if (type === "text") {
      const randomIdHost = element("div");
      ui.propertySettings.appendChild(randomIdHost);
      ui.propertySettings._randomIdRoot = createRoot(randomIdHost);
      flushSync(() => ui.propertySettings._randomIdRoot.render(antdTree(
        React.createElement(PropertyRandomIdControl, {
          initialEnabled: randomIdValue,
          initialLength: randomIdLengthValue
        })
      )));
    }

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

    const protection = element("div", "property-protection");
    const protectionControl = element("div");
    protection.append(
      protectionControl,
      element("div", "property-help", "Deshabilita la edición de este campo para evitar cambios accidentales.")
    );
    ui.propertySettings.appendChild(protection);
    ui.propertySettings._protectionRoot = createRoot(protectionControl);
    flushSync(() => ui.propertySettings._protectionRoot.render(antdTree(
      React.createElement(PropertyProtectionControl, { initialValue: protectedValue })
    )));
  }

  function openPropertyEditor(index, target = null) {
    state.propertyTarget = target;
    const property = propertyForEditorColumn(index);
    state.propertyColumn = index;
    const sheetLabel = target?.sheetName ? `${target.sheetName} · ` : "";
    ui.propertySource.textContent = `${sheetLabel}Columna ${columnName(index + 1)} · encabezado en Sheets: ${property.sourceHeader || "sin encabezado"}`;
    ui.propertyName.value = property.name;
    ui.propertyType.value = property.type;
    renderPropertyTypeSelect();
    renderPropertySettings(true);
    ui.propertyDrawer.hidden = false;
    requestAnimationFrame(() => ui.propertyName.focus());
  }

  function closePropertyEditor() {
    ui.propertyDrawer.hidden = true;
    state.propertyColumn = null;
    state.propertyTarget = null;
  }

  async function savePropertyConfiguration(event) {
    event.preventDefault();
    const index = state.propertyColumn;
    const target = state.propertyTarget;
    const editingRelated = target?.kind === "related";
    const sheet = propertyEditorSheet();
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
      protected: formData.has("protected"),
      type,
      randomId: type === "text" && formData.has("randomId"),
      randomIdLength: formData.get("randomIdLength") ?? previous.randomIdLength,
      options,
      optionColors,
      currencySymbol: formData.get("currencySymbol") ?? previous.currencySymbol,
      currencyDecimals: formData.get("currencyDecimals") ?? previous.currencyDecimals,
      dateFormat: formData.get("dateFormat") ?? previous.dateFormat,
      timeFormat: formData.get("timeFormat") ?? previous.timeFormat,
      checkedValue: formData.get("checkedValue") ?? previous.checkedValue,
      uncheckedValue: formData.get("uncheckedValue") ?? previous.uncheckedValue
    }, index, previous.sourceHeader);
    const drafts = editingRelated
      ? null
      : new Map(currentInputValues().map((value, columnIndex) => [columnIndex, value]));
    if (!editingRelated && next.protected) {
      if (!state.primaryDrafts.get(index)?.systemGenerated) state.primaryDrafts.delete(index);
      drafts.set(index, state.primaryDrafts.get(index)?.value ?? state.values[index] ?? "");
    }
    sheet.columns[index] = next;
    if (!sheet.propertyDefinitions) sheet.propertyDefinitions = {};
    rememberPropertyDefinition(sheet.propertyDefinitions, next);
    sheet.updatedAt = Date.now();
    state.activity.config = true;
    syncSaveState();
    if (editingRelated) {
      for (const [key, draft] of state.relatedDrafts) {
        if (
          normalizedColumn(draft.sheetName) !== normalizedColumn(target.sheetName)
          || draft.columnIndex !== index
        ) continue;
        if (next.protected) state.relatedDrafts.delete(key);
        else draft.property = next;
      }
      notifyRelatedDrafts();
    } else {
      renderFields(drafts);
      renderSheetViewActions();
    }
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
      }, 12_000);

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

  function writeRanges(operations, selectionReference = "") {
    state.writeInteractionDepth += 1;
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${++state.writeRequest}`;
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        state.writeInteractionDepth = Math.max(0, state.writeInteractionDepth - 1);
        return true;
      };
      const timeout = setTimeout(() => {
        if (!finish()) return;
        window.removeEventListener("message", receive);
        reject(new Error("Sheets no respondió al intento de escritura"));
      }, Math.max(8_000, operations.length * 700 + 5_000));

      function receive(event) {
        const message = event.data;
        if (event.source !== window || message?.source !== "sheets-row-drawer" || message?.type !== "write-result" || message.requestId !== requestId) return;
        if (!finish()) return;
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
        selectionReference
      }, location.origin);
    });
  }

  function hasPendingWriteVerification() {
    return state.pendingWrites.size > 0
      || state.sheetViewWrites.size > 0
      || state.sheetViewMutationRunning
      || state.sheetViewMutationQueue.length > 0;
  }

  function syncSheetViewMutationState() {
    const active = state.sheetViewMutationRunning
      || state.sheetViewMutationQueue.length > 0
      || state.sheetViewWrites.size > 0;
    setActivity("viewWrites", active);
    if (active) host.dataset.writeVerification = "pending";
  }

  function activeSheetViewWrite(entry) {
    return !entry.controller.signal.aborted && state.sheetViewWrites.get(entry.key) === entry;
  }

  function confirmSheetViewWrite(entry, values) {
    if (!activeSheetViewWrite(entry)) return;
    state.sheetViewWrites.delete(entry.key);
    if (state.gid !== entry.gid || state.row !== entry.row) return;
    const confirmedValues = Array.from(
      { length: Math.max(state.fields.length, usedCellWidth(values)) },
      (_, index) => index === entry.property.index ? entry.value : String(values[index] ?? state.values[index] ?? "")
    );
    state.values = confirmedValues;
    void writePersistentCache(cacheKey("row", entry.gid, entry.row), {
      labels: currentSourceLabels(),
      values: confirmedValues,
      updatedAt: Date.now()
    });
  }

  function settleUnconfirmedSheetViewWrite(entry) {
    if (!activeSheetViewWrite(entry)) return false;
    state.sheetViewWrites.delete(entry.key);
    return true;
  }

  async function verifyCellMutations(mutations, options = {}) {
    const delays = options.delays || [400, 800, 1_200];
    const isActive = options.isActive || (() => true);
    const valuesEqual = options.valuesEqual || valuesEqualForProperty;
    const confirmed = new Set();
    const observedRows = new Map();
    let verificationError = null;
    const activeMutations = () => mutations.filter((mutation) => !confirmed.has(mutation) && isActive(mutation));

    const verifyPass = async () => {
      for (const delay of delays) {
        let remaining = activeMutations();
        if (!remaining.length) return;
        await wait(delay);
        remaining = activeMutations();
        const groups = new Map();
        for (const mutation of remaining) {
          const key = `${mutation.gid}:${encodeURIComponent(mutation.sheetName)}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(mutation);
        }
        for (const [groupKey, group] of groups) {
          const firstRow = Math.min(...group.map((mutation) => mutation.row));
          const lastRow = Math.max(...group.map((mutation) => mutation.row));
          try {
            const valuesByRow = options.readGroup
              ? await options.readGroup(group, firstRow, lastRow)
              : new Map((await readRange(
                `A${firstRow}:${MAX_COLUMN}${lastRow}`,
                options.signal,
                String(group[0].gid),
                { allowEmpty: true }
              )).map((row) => [row.number, row.cells]));
            for (const [row, values] of valuesByRow) observedRows.set(`${groupKey}:${row}`, values);
            for (const mutation of group) {
              if (!isActive(mutation)) continue;
              const values = valuesByRow.get(mutation.row) || [];
              const columnIndex = Number(mutation.columnIndex ?? mutation.property?.index);
              if (!valuesEqual(values[columnIndex], mutation.value, mutation.property)) continue;
              confirmed.add(mutation);
              options.onConfirm?.(mutation, values);
            }
          } catch (error) {
            verificationError = error;
          }
        }
      }
    };

    await verifyPass();
    const missingBeforeRetry = activeMutations();
    if (missingBeforeRetry.length && options.retry !== false) {
      try {
        await writeRanges(cellMutationOperations(missingBeforeRetry), options.selectionReference || "");
        await verifyPass();
      } catch (error) {
        verificationError = error;
      }
    }

    return {
      confirmed: mutations.filter((mutation) => confirmed.has(mutation)),
      unconfirmed: activeMutations(),
      observedRows,
      error: verificationError,
      retried: missingBeforeRetry.length
    };
  }

  async function verifySheetViewWrites(entries, selectionReference = "") {
    const result = await verifyCellMutations(entries.map((entry) => ({
      ...entry,
      columnIndex: entry.property.index,
      sourceEntry: entry
    })), {
      isActive: (mutation) => activeSheetViewWrite(mutation.sourceEntry),
      onConfirm: (mutation, values) => confirmSheetViewWrite(mutation.sourceEntry, values),
      selectionReference
    });
    const unconfirmed = result.unconfirmed
      .map((mutation) => mutation.sourceEntry)
      .filter(settleUnconfirmedSheetViewWrite);
    state.sheetCache.clear();
    host.dataset.writeVerification = hasPendingWriteVerification()
      ? "pending"
      : unconfirmed.length
        ? "unconfirmed"
        : "verified";
    syncSheetViewMutationState();
    return unconfirmed;
  }

  function registerSheetViewWrites(tasks) {
    const entries = [];
    let renderCurrentRow = false;
    for (const task of tasks) {
      const key = `sheet-view:${task.gid}:${task.row}:${task.property.index}`;
      state.sheetViewWrites.get(key)?.controller.abort();
      const entry = {
        key,
        gid: task.gid,
        sheetName: task.sheetName,
        row: task.row,
        property: task.property,
        value: task.value,
        controller: new AbortController()
      };
      state.sheetViewWrites.set(key, entry);
      entries.push(entry);
      const optimisticValues = task.rowValues.length
        ? [...task.rowValues]
        : state.gid === entry.gid && state.row === entry.row
          ? [...state.values]
          : [];
      if (optimisticValues.length) {
        optimisticValues[entry.property.index] = entry.value;
        void writePersistentCache(cacheKey("row", entry.gid, entry.row), {
          labels: currentSourceLabels(),
          values: optimisticValues,
          updatedAt: Date.now(),
          pendingChanges: [{ index: entry.property.index, value: entry.value }],
          pendingSince: Date.now()
        });
      }
      if (state.gid === entry.gid && state.row === entry.row) {
        state.values = optimisticValues.length ? optimisticValues : [...state.values];
        state.values[entry.property.index] = entry.value;
        renderCurrentRow = true;
      }
    }
    state.sheetCache.clear();
    if (renderCurrentRow) {
      state.primaryDrafts.clear();
      renderFields();
    }
    syncSheetViewMutationState();
    return entries;
  }

  function cellMutationOperations(inputMutations) {
    const mutations = inputMutations.map((mutation) => ({
      ...mutation,
      columnIndex: Number(mutation.columnIndex ?? mutation.property?.index),
      value: String(mutation.value ?? "")
    })).filter((mutation) => (
      Number.isInteger(mutation.row)
      && mutation.row > 0
      && Number.isInteger(mutation.columnIndex)
      && mutation.columnIndex >= 0
    ));
    const groups = new Map();
    for (const mutation of mutations) {
      const key = `${mutation.gid}:${encodeURIComponent(mutation.sheetName)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mutation);
    }

    const operations = [];
    const pushClearOperations = (group) => {
      const rowRuns = [];
      const byRow = new Map();
      for (const mutation of group.filter((candidate) => candidate.value === "")) {
        if (!byRow.has(mutation.row)) byRow.set(mutation.row, []);
        byRow.get(mutation.row).push(mutation);
      }
      for (const [row, rowMutations] of [...byRow].sort((left, right) => left[0] - right[0])) {
        const columns = [...new Set(rowMutations.map((mutation) => mutation.columnIndex))].sort((left, right) => left - right);
        let firstColumn = columns[0];
        let lastColumn = columns[0];
        for (const column of columns.slice(1)) {
          if (column === lastColumn + 1) {
            lastColumn = column;
            continue;
          }
          rowRuns.push({ row, firstColumn, lastColumn });
          firstColumn = column;
          lastColumn = column;
        }
        if (columns.length) rowRuns.push({ row, firstColumn, lastColumn });
      }

      const rectangles = [];
      for (const run of rowRuns) {
        const previous = rectangles[rectangles.length - 1];
        if (
          previous
          && run.row === previous.lastRow + 1
          && run.firstColumn === previous.firstColumn
          && run.lastColumn === previous.lastColumn
        ) {
          previous.lastRow = run.row;
        } else {
          rectangles.push({
            firstRow: run.row,
            lastRow: run.row,
            firstColumn: run.firstColumn,
            lastColumn: run.lastColumn
          });
        }
      }
      for (const rectangle of rectangles) {
        const firstCell = `${columnName(rectangle.firstColumn + 1)}${rectangle.firstRow}`;
        const lastCell = `${columnName(rectangle.lastColumn + 1)}${rectangle.lastRow}`;
        operations.push({
          action: "clear",
          reference: qualifiedReference(group[0].sheetName, firstCell === lastCell ? firstCell : `${firstCell}:${lastCell}`)
        });
      }
    };
    const pushExactWriteOperations = (group) => {
      const filled = group.filter((mutation) => mutation.value !== "");
      const distinctColumns = new Set(filled.map((mutation) => mutation.columnIndex));
      if (distinctColumns.size === 1) {
        const ordered = [...filled].sort((left, right) => left.row - right.row);
        let run = [];
        const flush = () => {
          if (!run.length) return;
          const first = run[0];
          operations.push({
            reference: qualifiedReference(first.sheetName, `${columnName(first.columnIndex + 1)}${first.row}`),
            rows: run.map((mutation) => [mutation.value])
          });
          run = [];
        };
        for (const mutation of ordered) {
          const previous = run[run.length - 1];
          if (previous && mutation.row !== previous.row + 1) flush();
          run.push(mutation);
        }
        flush();
        return;
      }

      const byRow = new Map();
      for (const mutation of filled) {
        if (!byRow.has(mutation.row)) byRow.set(mutation.row, []);
        byRow.get(mutation.row).push(mutation);
      }
      for (const rowMutations of byRow.values()) {
        rowMutations.sort((left, right) => left.columnIndex - right.columnIndex);
        let run = [];
        const flush = () => {
          if (!run.length) return;
          const first = run[0];
          operations.push({
            reference: qualifiedReference(first.sheetName, `${columnName(first.columnIndex + 1)}${first.row}`),
            rows: [run.map((mutation) => mutation.value)]
          });
          run = [];
        };
        for (const mutation of rowMutations) {
          const previous = run[run.length - 1];
          if (previous && mutation.columnIndex !== previous.columnIndex + 1) flush();
          run.push(mutation);
        }
        flush();
      }
    };
    const pushMutationBatch = (group) => {
      const filled = group.filter((mutation) => mutation.value !== "");
      if (filled.length) {
        const firstRow = Math.min(...filled.map((mutation) => mutation.row));
        const lastRow = Math.max(...filled.map((mutation) => mutation.row));
        const firstColumn = Math.min(...filled.map((mutation) => mutation.columnIndex));
        const lastColumn = Math.max(...filled.map((mutation) => mutation.columnIndex));
        const height = lastRow - firstRow + 1;
        const width = lastColumn - firstColumn + 1;
        const mutationsByCell = new Map(group.map((mutation) => [`${mutation.row}:${mutation.columnIndex}`, mutation]));
        const knownRows = [...group]
          .sort((left, right) => (right.lastQueuedIndex ?? -1) - (left.lastQueuedIndex ?? -1))
          .find((mutation) => mutation.knownRows instanceof Map)?.knownRows;
        let complete = height * width <= 5_000;
        const rows = [];
        for (let row = firstRow; complete && row <= lastRow; row += 1) {
          const knownRow = knownRows?.get(row);
          const values = [];
          for (let column = firstColumn; column <= lastColumn; column += 1) {
            const mutation = mutationsByCell.get(`${row}:${column}`);
            if (mutation) values.push(mutation.value);
            else if ((height === 1 || width === 1) && knownRow) values.push(String(knownRow.cells[column] ?? ""));
            else {
              complete = false;
              break;
            }
          }
          if (complete) rows.push(values);
        }
        if (complete) {
          operations.push({
            reference: qualifiedReference(group[0].sheetName, `${columnName(firstColumn + 1)}${firstRow}`),
            rows
          });
        } else {
          pushExactWriteOperations(group);
        }
      }
      pushClearOperations(group);
    };

    for (const group of groups.values()) {
      group.sort((left, right) => left.row - right.row || left.columnIndex - right.columnIndex);
      let batch = [];
      for (const mutation of group) {
        if (batch.length && mutation.row - batch[0].row >= 500) {
          pushMutationBatch(batch);
          batch = [];
        }
        batch.push(mutation);
      }
      pushMutationBatch(batch);
    }
    return operations;
  }

  function sheetViewBatchOperations(tasks) {
    return cellMutationOperations(tasks.map((task) => ({
      ...task,
      columnIndex: task.property.index
    })));
  }

  function scheduleSheetViewMutationFlush(delay = 180) {
    if (state.sheetViewMutationRunning) return;
    if (state.sheetViewMutationTimer) clearTimeout(state.sheetViewMutationTimer);
    state.sheetViewMutationTimer = setTimeout(() => {
      state.sheetViewMutationTimer = null;
      void flushSheetViewMutations();
    }, delay);
  }

  function coalesceSheetViewMutationTasks(queuedTasks) {
    const latestByCell = new Map();
    queuedTasks.forEach((task, index) => {
      const key = `${task.gid}:${encodeURIComponent(task.sheetName)}:${task.row}:${task.property.index}`;
      const current = latestByCell.get(key);
      if (!current) {
        latestByCell.set(key, { ...task, waitingTasks: [task], lastQueuedIndex: index });
        return;
      }
      current.property = task.property;
      current.value = task.value;
      current.rowValues = task.rowValues;
      current.knownRows = task.knownRows;
      current.waitingTasks.push(task);
      current.lastQueuedIndex = index;
    });
    return [...latestByCell.values()].sort((left, right) => left.lastQueuedIndex - right.lastQueuedIndex);
  }

  async function flushSheetViewMutations() {
    if (state.sheetViewMutationRunning) return state.sheetViewMutationPromise;
    if (!state.sheetViewMutationQueue.length) return;
    state.sheetViewMutationRunning = true;
    const queuedTasks = state.sheetViewMutationQueue.splice(0);
    const tasks = coalesceSheetViewMutationTasks(queuedTasks);
    const lastTask = tasks[tasks.length - 1];
    const selectionReference = qualifiedReference(
      lastTask.sheetName,
      `${columnName(lastTask.property.index + 1)}${lastTask.row}`
    );
    let completeMutation;
    state.sheetViewMutationPromise = new Promise((resolve) => {
      completeMutation = resolve;
    });
    syncSheetViewMutationState();
    try {
      await writeRanges(sheetViewBatchOperations(tasks), selectionReference);
      const unconfirmed = await verifySheetViewWrites(registerSheetViewWrites(tasks), selectionReference);
      if (unconfirmed.length) {
        throw new Error(`Google Sheets no confirmó ${unconfirmed.length} cambio${unconfirmed.length === 1 ? "" : "s"}. Intenta guardar nuevamente.`);
      }
      for (const task of tasks) {
        for (const waitingTask of task.waitingTasks) waitingTask.resolve();
      }
    } catch (error) {
      for (const task of tasks) {
        const key = `sheet-view:${task.gid}:${task.row}:${task.property.index}`;
        const entry = state.sheetViewWrites.get(key);
        if (!entry || entry.value !== task.value) continue;
        entry.controller.abort();
        state.sheetViewWrites.delete(key);
      }
      for (const task of tasks) {
        for (const waitingTask of task.waitingTasks) waitingTask.reject(error);
      }
    } finally {
      state.sheetViewMutationRunning = false;
      completeMutation();
      state.sheetViewMutationPromise = null;
      syncSheetViewMutationState();
      syncPendingActions();
      if (state.sheetViewMutationQueue.length) scheduleSheetViewMutationFlush(0);
    }
  }

  async function drainSheetViewMutations() {
    if (state.sheetViewMutationTimer) {
      clearTimeout(state.sheetViewMutationTimer);
      state.sheetViewMutationTimer = null;
    }
    while (state.sheetViewMutationRunning || state.sheetViewMutationQueue.length) {
      if (state.sheetViewMutationRunning) await state.sheetViewMutationPromise;
      else await flushSheetViewMutations();
      if (state.sheetViewMutationTimer) {
        clearTimeout(state.sheetViewMutationTimer);
        state.sheetViewMutationTimer = null;
      }
    }
  }

  function writeSheetViewValue(row, property, value, rowValues = [], target = {}, knownRows = null) {
    const gid = String(target.gid ?? currentGid());
    const sheetName = String(target.sheetName || target.name || activeSheetName() || state.sheetName || `Hoja ${gid}`);
    return new Promise((resolve, reject) => {
      state.sheetViewMutationQueue.push({
        gid,
        sheetName,
        row,
        property,
        value: String(value ?? ""),
        rowValues: rowValues.map((cell) => String(cell ?? "")),
        knownRows,
        resolve,
        reject
      });
      syncSheetViewMutationState();
      scheduleSheetViewMutationFlush();
    });
  }

  async function verifyPendingWrite(entry) {
    let verificationError = null;
    try {
      const mutations = entry.writtenCells.map(({ index, value }) => ({
        gid: entry.gid,
        sheetName: entry.sheetName,
        row: entry.row,
        columnIndex: index,
        property: entry.properties[index],
        value
      }));
      const verification = await verifyCellMutations(mutations, {
        signal: entry.controller.signal,
        isActive: () => !entry.controller.signal.aborted && state.pendingWrites.get(entry.key) === entry
      });
      verificationError = verification.error;
      if (entry.controller.signal.aborted || state.pendingWrites.get(entry.key) !== entry) return;
      if (!verification.unconfirmed.length) {
          const groupKey = `${entry.gid}:${encodeURIComponent(entry.sheetName)}:${entry.row}`;
          const values = verification.observedRows.get(groupKey) || [];
          const width = Math.max(entry.labels.length, usedCellWidth(values));
          const freshValues = Array.from({ length: width }, (_, index) => values[index] || "");
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
            if (entry.creation) {
              state.primaryCreation = null;
              delete host.dataset.creatingRecord;
              state.lastSelection = rowSelectionSignature(entry.gid, entry.creation.sheetName, entry.row);
              ui.meta.textContent = `${entry.creation.sheetName} · fila ${entry.row}`;
              setStatus(`Registro creado en la fila ${entry.row}`);
            }
            state.sheetDataRevision += 1;
            renderSheetViewActions();
            host.dataset.writeVerification = hasPendingWriteVerification() ? "pending" : "verified";
            syncPendingActions();
            const relationshipKeyChanged = entry.writtenCells.some(({ index }) => /^id[a-z0-9]*/.test(normalizedColumn(entry.labels[index])));
            if (relationshipKeyChanged) startRelationships(state.fields, state.values, state.request?.signal, true);
          }
          return;
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
        state.primaryDrafts = new Map(entry.writtenCells.map(({ index, value }) => [index, { index, value }]));
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
    discardProtectedDrafts();
    const groupedRows = new Map();
    for (const requestedDraft of drafts) {
      const draft = state.relatedDrafts.get(requestedDraft.key);
      if (!draft) continue;
      const rowKey = `${encodeURIComponent(draft.sheetName)}:${draft.rowNumber}`;
      if (!groupedRows.has(rowKey)) groupedRows.set(rowKey, []);
      groupedRows.get(rowKey).push(draft);
    }

    const rowPlans = [];
    const mutations = [];
    for (const [rowKey, rowDrafts] of groupedRows) {
      rowDrafts.sort((left, right) => left.columnIndex - right.columnIndex);
      rowPlans.push({ key: `related:${rowKey}`, drafts: rowDrafts });
      for (const draft of rowDrafts) {
        mutations.push({
          gid: draft.relation.sheetGid || "",
          sheetName: draft.sheetName,
          row: draft.rowNumber,
          columnIndex: draft.columnIndex,
          property: draft.property,
          value: draft.value
        });
      }
    }
    return { operations: cellMutationOperations(mutations), rowPlans };
  }

  function registerPrimaryWrite(plan) {
    if (!plan) return;
    const { gid, sheetName, row, labels, properties, changes } = plan;
    const key = `${gid}:${row}`;
    const previousPending = state.pendingWrites.get(key);
    previousPending?.controller.abort();
    const optimisticValues = [...state.values];
    changes.forEach(({ index, value }) => {
      optimisticValues[index] = String(value ?? "");
    });
    const writtenByIndex = new Map((previousPending?.writtenCells || []).map((cell) => [cell.index, cell]));
    changes.forEach(({ index, value }) => {
      writtenByIndex.set(index, { index, value: String(value ?? "") });
    });
    const writtenCells = [...writtenByIndex.values()].sort((left, right) => left.index - right.index);
    const controller = new AbortController();
    const pendingSince = previousPending?.pendingSince || Date.now();
    const entry = {
      key,
      cacheKey: cacheKey("row", gid, row),
      gid,
      sheetName,
      row,
      labels,
      properties,
      previousValues: previousPending?.previousValues || [...state.values],
      writtenCells,
      pendingSince,
      creation: state.primaryCreation ? { ...state.primaryCreation } : null,
      controller
    };
    state.pendingWrites.set(key, entry);
    state.values = optimisticValues;
    state.primaryDrafts.clear();
    void writePersistentCache(entry.cacheKey, {
      labels,
      values: optimisticValues,
      updatedAt: Date.now(),
      pendingChanges: writtenCells,
      pendingSince
    });
    void verifyPendingWrite(entry);
  }

  function registerRelatedWrites(rowPlans, options = {}) {
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
        drafts: [...plan.drafts],
        isNewRecord: firstDraft.row.isNew === true,
        previousCells: [...previousByIndex.values()],
        writtenCells: [...writtenByIndex.values()].sort((left, right) => left.index - right.index),
        onVerificationFailed: options.onVerificationFailed,
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
    let verificationError = null;
    try {
      const mutations = entry.writtenCells.map(({ index, value, property }) => ({
        gid: entry.relation.sheetGid || "",
        sheetName: entry.sheetName,
        row: entry.rowNumber,
        columnIndex: index,
        property,
        value
      }));
      const verification = await verifyCellMutations(mutations, {
        signal: entry.controller.signal,
        isActive: () => !entry.controller.signal.aborted && state.pendingWrites.get(entry.key) === entry,
        readGroup: async () => new Map([[
          entry.rowNumber,
          await readNamedSheetRow(entry.sheetName, entry.rowNumber, entry.controller.signal)
        ]])
      });
      verificationError = verification.error;
      if (entry.controller.signal.aborted || state.pendingWrites.get(entry.key) !== entry) return;
      if (!verification.unconfirmed.length) {
          const groupKey = `${entry.relation.sheetGid || ""}:${encodeURIComponent(entry.sheetName)}:${entry.rowNumber}`;
          const values = verification.observedRows.get(groupKey) || [];
          for (const column of displayRelationColumns(entry.relation)) {
            entry.row.cells[column.index] = String(values[column.propertyIndex] ?? "");
          }
          if (entry.isNewRecord && !entry.relation.rows.some((row) => row.number === entry.rowNumber)) {
            entry.row.isNew = false;
            entry.relation.rows.push(entry.row);
            entry.relation.rows.sort((left, right) => left.number - right.number);
            entry.relation.totalCount = Number(entry.relation.totalCount ?? entry.relation.rows.length - 1) + 1;
          }
          state.pendingWrites.delete(entry.key);
          state.sheetCache.clear();
          persistVisibleRelations();
          if (entry.isNewRecord) {
            showRelations([...state.relations]);
            startRelationships(state.fields, state.values, undefined, true);
          }
          host.dataset.writeVerification = hasPendingWriteVerification() ? "pending" : "verified";
          notifyRelatedDrafts();
          return;
      }

      if (state.pendingWrites.get(entry.key) !== entry) return;
      state.pendingWrites.delete(entry.key);
      for (const previous of entry.previousCells) {
        const column = displayRelationColumns(entry.relation).find((item) => item.propertyIndex === previous.index);
        if (column) entry.row.cells[column.index] = previous.value;
      }
      for (const draft of entry.drafts || []) state.relatedDrafts.set(draft.key, draft);
      state.sheetCache.clear();
      persistVisibleRelations();
      host.dataset.writeVerification = "failed";
      setStatus(verificationError?.message || `Sheets no confirmó la fila ${entry.rowNumber} de ${entry.sheetName}`, "error");
      notifyRelatedDrafts();
      entry.onVerificationFailed?.();
    } finally {
      if (state.pendingWrites.get(entry.key) === entry && entry.controller.signal.aborted) {
        state.pendingWrites.delete(entry.key);
      }
    }
  }

  function preparePrimaryWrite() {
    const properties = state.fields.map((_, index) => propertyForColumn(index));
    const changes = collectPendingChanges();
    if (!changes.length) return null;
    const rowValues = properties.map((property, index) => property.type === "checkbox"
      ? serializeEditorValue(checkboxEditorValue(state.values[index], property), property)
      : String(state.values[index] ?? ""));
    const knownRows = new Map([[state.row, { cells: rowValues }]]);
    const operations = cellMutationOperations(changes.map((change) => ({
      gid: state.gid,
      sheetName: state.sheetName,
      row: state.row,
      columnIndex: change.index,
      property: properties[change.index],
      value: change.value,
      knownRows
    })));
    return {
      gid: state.gid,
      sheetName: state.sheetName,
      row: state.row,
      labels: currentSourceLabels(),
      properties,
      changes,
      operations
    };
  }

  async function persistChanges(primaryPlan, requestedRelatedDrafts, options = {}) {
    const relatedPlan = buildRelatedWritePlans(requestedRelatedDrafts);
    const operations = [...(primaryPlan?.operations || []), ...relatedPlan.operations];
    if (!operations.length) {
      setStatus("No hay cambios pendientes");
      syncPendingActions();
      return false;
    }

    const changeCount = (primaryPlan?.changes.length || 0) + requestedRelatedDrafts.length;
    state.saving = true;
    notifyRelatedDrafts();
    setStatus(`Guardando ${changeCount} campo(s)…`, "busy");
    try {
      const createdRelatedDraft = relatedPlan.rowPlans
        .flatMap((plan) => plan.drafts)
        .find((draft) => draft.row.isNew);
      await writeRanges(operations);
      if (createdRelatedDraft) {
        const targetGid = createdRelatedDraft.relation.sheetGid
          || visibleSheets().find((sheet) => normalizedColumn(sheet.name) === normalizedColumn(createdRelatedDraft.sheetName))?.gid
          || currentGid();
        state.lastSelection = rowSelectionSignature(
          String(targetGid),
          createdRelatedDraft.sheetName,
          createdRelatedDraft.rowNumber
        );
      }
      registerPrimaryWrite(primaryPlan);
      registerRelatedWrites(relatedPlan.rowPlans, options);
      host.dataset.writeVerification = "pending";
      setStatus(changeCount === 1 ? "Cambio guardado" : `${changeCount} cambios guardados`);
      return true;
    } catch (error) {
      host.dataset.writeVerification = "failed";
      setStatus(error.message, "error");
      return false;
    } finally {
      state.saving = false;
      notifyRelatedDrafts();
      syncSaveState();
    }
  }

  async function saveRelatedChanges(drafts = [...state.relatedDrafts.values()], options = {}) {
    if (state.saving || !state.row || !drafts.length) return false;
    if (state.viewRow !== state.row || state.viewGid !== state.gid) {
      setStatus("Espera a que termine de cargar la fila seleccionada", "busy");
      return false;
    }
    return persistChanges(null, drafts, options);
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

  function bridgeValueEquivalent(actualValue, expectedValue) {
    const actual = String(actualValue ?? "").trim();
    const expected = String(expectedValue ?? "").trim();
    if (actual === expected) return true;
    const booleanValue = (value) => {
      const normalized = normalizedColumn(value);
      if (normalized === "true" || normalized === "verdadero") return true;
      if (normalized === "false" || normalized === "falso") return false;
      return null;
    };
    const actualBoolean = booleanValue(actual);
    const expectedBoolean = booleanValue(expected);
    if (actualBoolean !== null && expectedBoolean !== null) return actualBoolean === expectedBoolean;
    const plainNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
    return plainNumber.test(actual) && plainNumber.test(expected) && Number(actual) === Number(expected);
  }

  async function bridgeSheetHeaders(sheetName) {
    const rows = await readNamedBridgeRange(sheetName, `A1:${MAX_COLUMN}1`, undefined);
    return rows.find((row) => row.number === 1)?.cells || [];
  }

  function bridgeHeaderIndexes(headers) {
    const indexes = new Map();
    headers.forEach((header, index) => {
      const key = normalizedColumn(header);
      if (key && !indexes.has(key)) indexes.set(key, index);
    });
    return indexes;
  }

  function bridgeRecordRow(record, headers) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("El registro debe contener pares Columna=valor");
    }
    const indexes = bridgeHeaderIndexes(headers);
    const lastColumn = headers.reduce((last, header, index) => String(header || "").trim() ? index : last, -1);
    if (lastColumn < 0) throw new Error("La hoja no tiene encabezados configurados");
    const row = Array(lastColumn + 1).fill("");
    for (const [column, value] of Object.entries(record)) {
      const index = indexes.get(normalizedColumn(column));
      if (index === undefined) throw new Error(`La columna ${column} no existe en la hoja`);
      row[index] = value === null || value === undefined ? "" : String(value);
    }
    return row;
  }

  async function nextBridgeAppendRow(sheetName) {
    const table = await readSheetTable(sheetName, `A1:${MAX_COLUMN}`, undefined);
    let lastUsedRow = table.headers.some((value) => String(value || "").trim()) ? 1 : 0;
    for (const row of table.rows) {
      if (row.cells.some((value) => String(value || "").trim())) lastUsedRow = Math.max(lastUsedRow, row.number);
    }
    return Math.max(2, lastUsedRow + 1);
  }

  async function bridgeSheetRecords(sheetName, options = {}) {
    const table = await readSheetTable(sheetName, `A1:${MAX_COLUMN}`, undefined);
    const headers = table.headers;
    const indexes = bridgeHeaderIndexes(headers);
    const where = options.where && typeof options.where === "object" ? options.where : {};
    const conditions = Object.entries(where).map(([column, value]) => {
      const columnIndex = indexes.get(normalizedColumn(column));
      if (columnIndex === undefined) throw new Error(`La columna ${column} no existe en la hoja`);
      return { columnIndex, value: String(value ?? "") };
    });
    const fromRow = Math.max(2, Number(options.fromRow) || 2);
    const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
    const records = table.rows
      .filter((row) => row.number >= fromRow && row.cells.some((value) => String(value || "").trim()))
      .filter((row) => conditions.every((condition) =>
        bridgeValueEquivalent(row.cells[condition.columnIndex] ?? "", condition.value)
      ))
      .slice(0, limit)
      .map((row) => ({
        row: row.number,
        values: Object.fromEntries(headers.flatMap((header, index) =>
          String(header || "").trim() ? [[String(header), String(row.cells[index] ?? "")]] : []
        ))
      }));
    return { headers: headers.filter((header) => String(header || "").trim()), records };
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
    const requestedSheetIsActive = requestedSheet && normalizedColumn(requestedSheet) === normalizedColumn(activeName);
    const rows = requestedSheet
      ? await readNamedBridgeRange(requestedSheet, range, signal)
      : await readRange(range, signal, String(params.gid || currentGid()));
    return {
      spreadsheetId: spreadsheetId(),
      gid: requestedSheet ? (requestedSheetIsActive ? currentGid() : null) : String(params.gid || currentGid()),
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

  function bridgeMutationGid(params, sheetName) {
    return String(
      visibleSheets().find((sheet) => normalizedColumn(sheet.name) === normalizedColumn(sheetName))?.gid
      || params.gid
      || currentGid()
    );
  }

  function bridgeRangeMutations(params, sheetName, range, rows) {
    const bounds = bridgeRangeBounds(range);
    const gid = bridgeMutationGid(params, sheetName);
    return rows.flatMap((row, rowOffset) => row.map((value, columnOffset) => ({
      gid,
      sheetName,
      row: bounds.firstRow + rowOffset,
      columnIndex: bounds.firstColumn - 1 + columnOffset,
      value: String(value ?? "")
    })));
  }

  function bridgeMutationValues(verification, mutations, range, expectedRows) {
    if (!verification.unconfirmed.length) return expectedRows;
    const bounds = bridgeRangeBounds(range);
    const groupKey = `${mutations[0]?.gid || ""}:${encodeURIComponent(mutations[0]?.sheetName || "")}`;
    return expectedRows.map((row, rowOffset) => {
      const observed = verification.observedRows.get(`${groupKey}:${bounds.firstRow + rowOffset}`) || [];
      return row.map((_, columnOffset) => String(observed[bounds.firstColumn - 1 + columnOffset] ?? ""));
    });
  }

  async function executeBridgeMutations(params, sheetName, mutations, selectionReference = "") {
    await writeRanges(cellMutationOperations(mutations), selectionReference);
    state.headerCache.clear();
    state.sheetCache.clear();
    return verifyCellMutations(mutations, {
      delays: [500, 1_000, 2_000],
      valuesEqual: bridgeValueEquivalent,
      selectionReference,
      readGroup: async (_group, firstRow, lastRow) => {
        const result = await readBridgeRange({
          ...params,
          sheet: sheetName,
          range: `A${firstRow}:${MAX_COLUMN}${lastRow}`
        }, undefined);
        return new Map(result.rows.map((row) => [row.row, row.values]));
      }
    });
  }

  function bridgeMutationResult(verification, mutations, range, expectedRows) {
    return {
      verified: verification.unconfirmed.length === 0,
      values: bridgeMutationValues(verification, mutations, range, expectedRows),
      retried: verification.retried
    };
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
        capabilities: ["list", "read", "inspect", "write", "append", "update", "clear"]
      };
    }
    if (command.action === "list") {
      const sheet = String(params.sheet || activeSheetName()).trim();
      return {
        spreadsheetId: spreadsheetId(),
        sheet,
        ...(await bridgeSheetRecords(sheet, params))
      };
    }
    if (command.action === "read") return readBridgeRange(params, undefined);
    if (command.action === "inspect") return inspectBridgeRange(params, undefined);
    if (command.action !== "write" && command.action !== "append" && command.action !== "update" && command.action !== "clear") {
      throw new Error(`Operación no soportada: ${command.action}`);
    }

    const targetSheet = String(params.sheet || activeSheetName()).trim();

    if (command.action === "append") {
      const recordList = params.records || (params.record ? [params.record] : null);
      const headers = recordList ? await bridgeSheetHeaders(targetSheet) : null;
      const expectedRows = recordList
        ? recordList.map((record) => bridgeRecordRow(record, headers))
        : bridgeRows(params.values);
      const startRow = await nextBridgeAppendRow(targetSheet);
      const start = `A${startRow}`;
      const range = bridgeWriteRange(start, expectedRows);
      const mutations = bridgeRangeMutations(params, targetSheet, range, expectedRows);
      const verification = await executeBridgeMutations(
        params,
        targetSheet,
        mutations,
        qualifiedReference(targetSheet, start)
      );
      return {
        spreadsheetId: spreadsheetId(),
        gid: currentGid(),
        sheet: targetSheet,
        start,
        range,
        ...bridgeMutationResult(verification, mutations, range, expectedRows)
      };
    }

    if (command.action === "update") {
      let rowNumber = Number(params.row);
      if (params.where && typeof params.where === "object" && Object.keys(params.where).length) {
        const matches = (await bridgeSheetRecords(targetSheet, { where: params.where, limit: 2 })).records;
        if (!matches.length) throw new Error("No se encontró ningún registro que coincida con --where");
        if (matches.length > 1) throw new Error("--where coincide con más de un registro; usa una condición única");
        rowNumber = matches[0].row;
      }
      if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error("La fila debe ser igual o mayor que 2");
      const changes = params.changes;
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
        throw new Error("No hay cambios para aplicar");
      }
      const headers = await bridgeSheetHeaders(targetSheet);
      const indexes = bridgeHeaderIndexes(headers);
      const cells = Object.entries(changes).map(([column, value]) => {
        const columnIndex = indexes.get(normalizedColumn(column));
        if (columnIndex === undefined) throw new Error(`La columna ${column} no existe en la hoja`);
        return {
          column,
          columnIndex,
          value: value === null || value === undefined ? "" : String(value)
        };
      });
      const targetGid = bridgeMutationGid(params, targetSheet);
      const mutations = cells.map((cell) => ({
        gid: targetGid,
        sheetName: targetSheet,
        row: rowNumber,
        columnIndex: cell.columnIndex,
        value: cell.value
      }));
      const firstColumn = Math.min(...cells.map((cell) => cell.columnIndex));
      const lastColumn = Math.max(...cells.map((cell) => cell.columnIndex));
      const range = `${columnName(firstColumn + 1)}${rowNumber}:${columnName(lastColumn + 1)}${rowNumber}`;
      const verification = await executeBridgeMutations(
        params,
        targetSheet,
        mutations,
        qualifiedReference(targetSheet, `${columnName(lastColumn + 1)}${rowNumber}`)
      );
      const groupKey = `${mutations[0].gid}:${encodeURIComponent(targetSheet)}:${rowNumber}`;
      const observed = verification.observedRows.get(groupKey) || [];
      const actualValues = Object.fromEntries(cells.map((cell) => [
        cell.column,
        String(observed[cell.columnIndex] ?? "")
      ]));
      return {
        spreadsheetId: spreadsheetId(),
        gid: currentGid(),
        sheet: targetSheet,
        row: rowNumber,
        verified: verification.unconfirmed.length === 0,
        retried: verification.retried,
        values: verification.unconfirmed.length ? actualValues : Object.fromEntries(cells.map((cell) => [cell.column, cell.value]))
      };
    }

    let range;
    let expectedRows;
    if (command.action === "write") {
      expectedRows = bridgeRows(params.values);
      range = bridgeWriteRange(params.start, expectedRows);
    } else {
      range = normalizedBridgeRange(params.range);
      const [start, end = start] = range.split(":");
      const startMatch = start.match(/^([A-Z]+)(\d+)$/);
      const endMatch = end.match(/^([A-Z]+)(\d+)$/);
      const width = bridgeColumnNumber(endMatch[1]) - bridgeColumnNumber(startMatch[1]) + 1;
      const height = Number(endMatch[2]) - Number(startMatch[2]) + 1;
      if (width <= 0 || height <= 0) throw new Error("El rango de limpieza está invertido");
      expectedRows = Array.from({ length: height }, () => Array(width).fill(""));
    }

    const mutations = bridgeRangeMutations(params, targetSheet, range, expectedRows);
    const verification = await executeBridgeMutations(
      params,
      targetSheet,
      mutations,
      qualifiedReference(targetSheet, range.split(":").pop())
    );
    return {
      spreadsheetId: spreadsheetId(),
      gid: String(params.gid || currentGid()),
      sheet: targetSheet,
      range,
      ...bridgeMutationResult(verification, mutations, range, expectedRows)
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
      if (!cloudAccessAllowed()) {
        setTimeout(pollCodexBridge, CODEX_BRIDGE_POLL_MS);
        return;
      }
      const response = await runtimeBridgeMessage("poll", {
        spreadsheetId: spreadsheetId(),
        gid: currentGid(),
        sheet: activeSheetName()
      });
      if (response?.accessBlocked) {
        ui.cloudAccountUi?.setSession(response.session || {
          authenticated: false,
          serviceError: response.error || "Se requiere una sesión activa para usar el acceso de IA."
        });
        ui.cloudAccountUi?.open();
        return;
      }
      const command = response?.command;
      if (command) {
        try {
          if (!cloudAccessAllowed()) throw new Error("Se requiere una sesión activa de Abrir CRM para ejecutar esta orden.");
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

  async function refreshOpenSheetData() {
    if (panelFrame.hidden || state.saving || state.primaryCreation || state.writeInteractionDepth > 0 || !cloudAccessAllowed()) return true;
    const previousValues = [...state.values];
    state.sheetCache.clear();
    state.sheetDataRevision += 1;
    renderSheetViewActions();

    const reference = nameBoxValue();
    const row = selectedRow(reference);
    const gid = currentGid();
    const sheetName = activeSheetName();
    if (
      row > 1
      && row === state.row
      && gid === state.gid
      && normalizedColumn(sheetName) === normalizedColumn(state.sheetName)
    ) {
      await loadRow(row, true);
      return !sameValues(previousValues, state.values);
    }
    return true;
  }

  function scheduleOpenSheetRefresh() {
    const request = ++state.sheetChangeRequest;
    clearTimeout(state.sheetChangeTimer);
    state.sheetChangeTimer = setTimeout(async () => {
      state.sheetChangeTimer = null;
      const changed = await refreshOpenSheetData();
      if (changed || request !== state.sheetChangeRequest) return;
      state.sheetChangeTimer = setTimeout(() => {
        state.sheetChangeTimer = null;
        if (request === state.sheetChangeRequest) void refreshOpenSheetData();
      }, 650);
    }, 40);
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (
      event.source === window
      && event.origin === location.origin
      && message?.source === "sheets-row-drawer"
      && message?.type === "sheet-change"
    ) {
      scheduleOpenSheetRefresh();
    }
  });

  function pollSelection() {
    if (state.saving || state.primaryCreation || state.writeInteractionDepth > 0) return;
    if (!cloudAccessAllowed()) return;
    const reference = nameBoxValue();
    if (!reference) return;
    const gid = currentGid();
    const sheetName = activeSheetName();
    const normalizedReference = reference.split("!").pop().replace(/\$/g, "");
    const row = selectedRow(reference);
    const sheetSignature = normalizedColumn(sheetName);
    const signature = row
      ? rowSelectionSignature(gid, sheetName, row)
      : `${gid}:${sheetSignature}:reference:${normalizedReference}`;
    if (signature === state.lastSelection) return;
    state.lastSelection = signature;
    if (state.propertyColumn !== null) closePropertyEditor();
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

  void (async () => {
    if (state.cloudRequired) {
      await refreshCloudAccess();
      if (!cloudAccessAllowed()) {
        ui.cloudAccountUi.open();
        return;
      }
    } else {
      state.cloudSession = { authenticated: true, local: true };
    }
    await ensureWorkspaceLoaded();
    await hydrateCloudWorkspace();
  })().finally(() => {
    renderSheetViewActions();
    setInterval(pollSelection, POLL_MS);
    pollSelection();
    void pollCodexBridge();
  });
})();
