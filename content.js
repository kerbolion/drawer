import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { StyleProvider } from "@ant-design/cssinjs";
import Button from "antd/es/button/index.js";
import Checkbox from "antd/es/checkbox/index.js";
import ConfigProvider from "antd/es/config-provider/index.js";
import DatePicker from "antd/es/date-picker/index.js";
import Input from "antd/es/input/index.js";
import InputNumber from "antd/es/input-number/index.js";
import Select from "antd/es/select/index.js";
import Space from "antd/es/space/index.js";
import Tag from "antd/es/tag/index.js";
import TimePicker from "antd/es/time-picker/index.js";
import {
  CalculatorOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  LinkOutlined,
  MailOutlined,
  PhoneOutlined,
  PlusOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";
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
    }
    .panel-frame[hidden], .reopen[hidden] { display: none; }
    .reopen {
      position: fixed; right: 16px; top: 82px; z-index: 2147483647;
      min-height: ${antdTokens.controlHeight}px; border: 0; border-radius: ${antdTokens.borderRadius}px;
      padding: 4px 15px; background: ${antdTokens.colorPrimary}; color: ${antdTokens.colorWhite};
      box-shadow: ${antdTokens.boxShadowSecondary};
      font: 600 ${antdTokens.fontSize}px/${antdTokens.lineHeight} ${antdTokens.fontFamily}; cursor: pointer;
    }
    .reopen:hover { background: ${antdTokens.colorPrimaryHover}; }
  `);
  shadow.adoptedStyleSheets = [shellStyles];

  const panelFrame = document.createElement("iframe");
  panelFrame.className = "panel-frame";
  panelFrame.title = "Detalles de la fila";
  const reopen = document.createElement("button");
  reopen.className = "reopen";
  reopen.type = "button";
  reopen.textContent = "Abrir formulario";
  reopen.hidden = true;
  shadow.append(panelFrame, reopen);

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
    .drawer > main { flex: 1; overflow: auto; padding: 20px 28px 32px; background: var(--workspace-bg); }
    .status {
      margin-bottom: 14px; padding: 9px 12px; border: 1px solid ${antdTokens.colorSuccessBorder};
      border-radius: ${antdTokens.borderRadiusLG}px; background: ${antdTokens.colorSuccessBg}; color: ${antdTokens.colorSuccessText};
      font-size: 12px;
    }
    .status.error { border-color: ${antdTokens.colorErrorBorder}; background: ${antdTokens.colorErrorBg}; color: ${antdTokens.colorErrorText}; }
    .status.busy { border-color: ${antdTokens.colorInfoBorder}; background: ${antdTokens.colorInfoBg}; color: ${antdTokens.colorInfoText}; }
    .status[hidden], .related-status[hidden] { display: none; }
    .fields {
      overflow: hidden; padding: 4px 14px;
      border: 1px solid var(--workspace-border); border-radius: 8px;
      background: var(--workspace-surface); box-shadow: 0 8px 24px var(--workspace-shadow-soft);
    }
    .field {
      display: grid; grid-template-columns: 190px minmax(0, 1fr); align-items: center; gap: 18px;
      min-height: 57px; padding: 12px 0; border-bottom: 1px solid var(--workspace-border-subtle);
    }
    .field:last-child { border-bottom: 0; }
    .field-label { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .field-label-text {
      min-width: 0; overflow: hidden; color: var(--workspace-text-secondary); font-size: 13px;
      font-weight: 700; text-overflow: ellipsis; white-space: nowrap;
    }
    .field-configure {
      display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: 0; border-radius: 50%;
      background: ${antdTokens.colorPrimaryBg}; color: ${antdTokens.colorPrimary}; cursor: pointer;
      line-height: 1; opacity: 1; transition: color ${antdTokens.motionDurationMid}, background ${antdTokens.motionDurationMid};
    }
    .field-configure svg { display: block; width: 14px; height: 14px; }
    .field-configure:hover, .field-configure:focus-visible { background: ${antdTokens.colorPrimaryBgHover}; color: ${antdTokens.colorPrimaryHover}; }
    .field-editor { min-width: 0; }
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
    .related {
      margin-top: 14px; padding: 0 14px 14px; overflow: hidden;
      border: 1px solid var(--workspace-border); border-radius: 8px;
      background: var(--workspace-surface); box-shadow: 0 8px 24px var(--workspace-shadow-soft);
    }
    .related h2 {
      margin: 0 -14px 10px; min-height: 46px; padding: 12px 14px;
      border-bottom: 1px solid var(--workspace-border-soft); background: var(--workspace-surface-raised);
      color: var(--workspace-text); font-size: 14px; line-height: 22px;
    }
    .related-status { padding: 3px 0; color: var(--workspace-text-muted); font-size: 12px; }
    .relation { margin-top: 12px; border: 1px solid var(--workspace-border); border-radius: 8px; overflow: hidden; }
    .relation-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px 12px; background: var(--workspace-surface-muted); }
    .relation-title { font-weight: 700; }
    .relation-kind { margin-top: 2px; color: var(--workspace-text-muted); font-size: 11px; }
    .relation-count { min-width: 24px; border-radius: ${antdTokens.borderRadiusSM}px; padding: 1px 7px; border: 1px solid ${antdTokens.colorBorder}; background: ${antdTokens.colorBgContainer}; color: ${antdTokens.colorTextSecondary}; text-align: center; font-size: 11px; }
    .relation-empty { padding: 12px; color: var(--workspace-text-muted); font-size: 12px; }
    .relation-table { width: 100%; overflow-x: auto; }
    .relation-table table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 11px; }
    .relation-table th, .relation-table td { max-width: 180px; padding: 8px 10px; border-top: 1px solid var(--workspace-border-soft); text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .relation-table th { color: ${antdTokens.colorTextSecondary}; background: ${workspaceTokens.surfaceMuted}; font-weight: 600; }
    .relation-table tbody tr:nth-child(even) { background: var(--workspace-surface-subtle); }
    .relation-more { padding: 8px 10px; border-top: 1px solid var(--workspace-border-soft); color: var(--workspace-text-muted); font-size: 11px; }
    .workspace-date-picker-popup .ant-picker-panel-container { max-width: calc(100vw - 16px); }
    .drawer > footer { padding: 12px 24px 16px; border-top: 1px solid ${antdTokens.colorBorderSecondary}; background: ${antdTokens.colorBgContainer}; }
    .meta { margin-bottom: 9px; color: ${antdTokens.colorTextTertiary}; font-size: 11px; }
    .save {
      width: 100%; min-height: ${antdTokens.controlHeightLG}px; border: 1px solid ${antdTokens.colorPrimary};
      border-radius: ${antdTokens.borderRadius}px; padding: 6px 15px; background: ${antdTokens.colorPrimary};
      color: ${antdTokens.colorWhite}; font-weight: 600; cursor: pointer;
      box-shadow: ${antdTokens.boxShadowTertiary}; transition: background ${antdTokens.motionDurationMid};
    }
    .save:hover { background: ${antdTokens.colorPrimaryHover}; border-color: ${antdTokens.colorPrimaryHover}; }
    .save:disabled { border-color: ${antdTokens.colorBgContainerDisabled}; background: ${antdTokens.colorBgContainerDisabled}; color: ${antdTokens.colorTextDisabled}; box-shadow: none; cursor: default; }
    @media (max-width: 640px) {
      .drawer > main { padding: 16px 14px 24px; }
      .drawer > header, .drawer > footer { padding-inline: 16px; }
      .field { grid-template-columns: minmax(86px, 34%) minmax(0, 1fr); gap: 10px; }
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
    flushSync(() => button._iconRoot.render(typeIcon(type)));
  }

  function updateAntdControl(host, property, nextValue, refresh) {
    host._editorValue = nextValue;
    host._value = serializeEditorValue(nextValue, property);
    host.dataset.serializedValue = host._value;
    refresh();
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

  function AntFieldControl({ host, property }) {
    const [, refresh] = React.useReducer((value) => value + 1, 0);
    const value = host._editorValue;
    const update = (nextValue) => updateAntdControl(host, property, nextValue, refresh);
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

  const drawer = element("aside", "drawer");
  drawer.setAttribute("aria-label", "Detalles de la fila");
  const panelHeader = element("header");
  const eyebrow = element("div", "eyebrow", "PRUEBA LOCAL · SESIÓN DE GOOGLE");
  const titleRow = element("div", "title-row");
  const title = element("h1", "", "Detalles de la fila");
  const headerActions = element("div", "header-actions");
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
  headerActions.append(saveState, close);
  titleRow.append(title, headerActions);
  panelHeader.append(eyebrow, titleRow);

  const main = element("main");
  const status = element("div", "status busy", "Esperando una celda…");
  status.hidden = true;
  const fields = element("div", "fields");
  const related = element("section", "related");
  const relatedTitle = element("h2", "", "Relacionados");
  const relatedStatus = element("div", "related-status", "Selecciona una fila para buscar relaciones.");
  const relatedList = element("div", "related-list");
  related.append(relatedTitle, relatedStatus, relatedList);
  main.append(status, fields, related);

  const footer = element("footer");
  const meta = element("div", "meta", "Sin fila seleccionada");
  const save = element("button", "save", "Guardar cambios");
  save.type = "button";
  save.disabled = true;
  footer.append(meta, save);
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
    saveState,
    status,
    fields,
    relatedStatus,
    relatedList,
    meta,
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

  ui.close.addEventListener("click", () => {
    ui.frame.hidden = true;
    ui.reopen.hidden = false;
  });
  ui.reopen.addEventListener("click", () => {
    ui.frame.hidden = false;
    ui.reopen.hidden = true;
  });
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
    const next = { name: sheetName, columns, updatedAt: Date.now() };
    const changed = !previous || previous.name !== sheetName || !sameValues(previous.columns, columns);
    state.workspace.sheets[key] = next;
    if (changed) void writeWorkspace();
    return next;
  }

  function currentSheetConfiguration() {
    return state.workspace?.sheets?.[String(currentGid())] || null;
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

  function readableCellText(cell) {
    const clone = cell.cloneNode(true);
    for (const lineBreak of clone.querySelectorAll("br")) {
      lineBreak.replaceWith(clone.ownerDocument.createTextNode("\n"));
    }
    return String(clone.textContent || "").trim();
  }

  async function fetchHtmlDocument(url, signal, timeoutMessage, timeoutMs) {
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
      const html = await response.text();
      const trustedHtml = trustedHtmlPolicy ? trustedHtmlPolicy.createHTML(html) : html;
      return new DOMParser().parseFromString(trustedHtml, "text/html");
    } catch (error) {
      if (timedOut) throw new Error(timeoutMessage);
      if (signal?.aborted) throw new DOMException("Lectura cancelada", "AbortError");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function readRange(range, signal, gid = currentGid()) {
    const doc = await fetchHtmlDocument(embedUrl(range, gid), signal, "La vista HTML tardó demasiado en responder", 12_000);
    const rows = Array.from(doc.querySelectorAll("tbody tr")).flatMap((tr) => {
      const rowHeader = tr.querySelector("th.row-headers-background");
      if (!rowHeader) return [];
      const number = Number(rowHeader.textContent.trim());
      const cells = Array.from(tr.querySelectorAll("td:not(.freezebar-cell)"), readableCellText);
      return Number.isFinite(number) ? [{ number, cells }] : [];
    });
    if (!rows.length) throw new Error("La vista HTML no devolvió filas; revisa que tu sesión tenga acceso");
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
      Array.from(tr.querySelectorAll("td, th"), (cell) => cell.textContent.trim())
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
      .filter(({ header }) => header.trim())
      .slice(0, 6);
  }

  function renderRelation(relation) {
    const totalCount = relation.totalCount ?? relation.rows.length;
    const article = element("article", "relation");
    const heading = element("div", "relation-head");
    const headingText = element("div");
    const title = element("div", "relation-title", relation.sheetName);
    const kind = element("div", "relation-kind", relation.description);
    const count = element("div", "relation-count", String(totalCount));
    headingText.append(title, kind);
    heading.append(headingText, count);
    article.appendChild(heading);

    if (!totalCount) {
      article.appendChild(element("div", "relation-empty", "No hay registros relacionados."));
      ui.relatedList.appendChild(article);
      return;
    }

    const columns = relationColumns(relation.headers);
    const wrapper = element("div", "relation-table");
    const table = element("table");
    const thead = element("thead");
    const headerRow = element("tr");
    for (const column of columns) headerRow.appendChild(element("th", "", column.header));
    thead.appendChild(headerRow);
    const tbody = element("tbody");
    for (const row of relation.rows.slice(0, 20)) {
      const tr = element("tr");
      for (const column of columns) {
        const value = row.cells[column.index] || "";
        const td = element("td", "", value);
        td.title = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    wrapper.appendChild(table);
    article.appendChild(wrapper);
    if (totalCount > 20) {
      article.appendChild(element("div", "relation-more", `Y ${totalCount - 20} registro(s) más.`));
    }
    ui.relatedList.appendChild(article);
  }

  function storedRelations(relations) {
    return relations.map((relation) => {
      const columns = relationColumns(relation.headers);
      return {
        sheetName: relation.sheetName,
        description: relation.description,
        headers: columns.map((column) => column.header),
        totalCount: relation.totalCount ?? relation.rows.length,
        rows: relation.rows.slice(0, 50).map((row) => ({
          number: row.number,
          cells: columns.map((column) => row.cells[column.index] || "")
        }))
      };
    });
  }

  function showRelations(relations) {
    const signature = JSON.stringify(storedRelations(relations));
    if (ui.relatedList.dataset.signature === signature) return;
    ui.relatedList.replaceChildren();
    for (const relation of relations) renderRelation(relation);
    ui.relatedList.dataset.signature = signature;
  }

  function clearRelations() {
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

  function applyRowData(labels, values, row, signal, drafts = []) {
    const width = Math.max(labels.length, values.length);
    state.values = Array.from({ length: width }, (_, index) => values[index] || "");
    state.fields = Array.from({ length: width }, (_, index) => labels[index] || `Columna ${columnName(index + 1)}`);
    reconcileSheetConfiguration(currentGid(), activeSheetName() || `Hoja ${currentGid()}`, state.fields);
    renderFields(new Map(drafts.map((draft) => [draft.index, draft.value])));
    state.viewRow = row;
    state.viewGid = currentGid();
    host.dataset.row = String(row);
    ui.fields.inert = false;
    ui.fields.removeAttribute("aria-busy");
    ui.save.disabled = false;
    startRelationships(labels, state.values, signal);
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

    if (cached?.labels && cached?.values) {
      applyRowData(cached.labels, cached.values, row, request.signal);
      setStatus(`Fila ${row} cargada desde caché · comprobando cambios…`);
    } else {
      ui.save.disabled = true;
      setStatus(`Leyendo la fila ${row} desde tu sesión de Google…`, "busy");
    }

    try {
      const [labels, rows] = await Promise.all([
        headers(request.signal, true),
        readRange(`A${row}:${MAX_COLUMN}${row}`, request.signal)
      ]);
      const values = rows.find((item) => item.number === row)?.cells || [];
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
      let editor = wrapper?.querySelector(":scope > .field-editor");

      if (!wrapper?.classList.contains("field") || !heading || !title || !configure || !editor) {
        wrapper = wrapper || element("div");
        wrapper.className = "field";
        wrapper.replaceChildren();
        heading = element("div", "field-label");
        title = element("span", "field-label-text");
        configure = element("button", "field-configure");
        configure.type = "button";
        configure.addEventListener("click", () => openPropertyEditor(Number(configure.dataset.configureColumn) - 1));
        heading.append(title, configure);
        editor = element("div", "field-editor");
        wrapper.append(heading, editor);
        if (!existing[index]) ui.fields.appendChild(wrapper);
      }

      title.textContent = property.name || sourceLabel;
      title.title = property.name || sourceLabel;
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

  function writeRange(reference, values) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${++state.writeRequest}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", receive);
        reject(new Error("Sheets no respondió al intento de escritura"));
      }, 4_000);

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
        reference,
        tsv: values.map(tsvValue).join("\t")
      }, location.origin);
    });
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
            host.dataset.writeVerification = "verified";
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
      }
    } finally {
      if (state.pendingWrites.get(entry.key) === entry && entry.controller.signal.aborted) {
        state.pendingWrites.delete(entry.key);
      }
    }
  }

  async function saveChanges() {
    if (state.saving || !state.row) return;
    if (state.viewRow !== state.row || state.viewGid !== state.gid) {
      setStatus("Espera a que termine de cargar la fila seleccionada", "busy");
      return;
    }
    const controls = currentControls();
    const properties = controls.map((control) => propertyForColumn(Number(control.dataset.column) - 1));
    const changes = controls.flatMap((control) => {
      const index = Number(control.dataset.column) - 1;
      const property = properties[index];
      const value = controlValue(control, property);
      return valuesEqualForProperty(value, state.values[index], property) ? [] : [{ index, value }];
    });
    if (!changes.length) {
      setStatus("No hay cambios pendientes");
      return;
    }

    const gid = state.gid;
    const row = state.row;
    const labels = [...state.fields];
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

    state.saving = true;
    ui.save.disabled = true;
    setStatus(`Pegando ${changes.length} campo(s) en un solo bloque…`, "busy");
    try {
      await writeRange(`${columnName(firstChanged + 1)}${row}`, blockValues);

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
      host.dataset.writeVerification = "pending";
      void writePersistentCache(entry.cacheKey, {
        labels,
        values: optimisticValues,
        updatedAt: Date.now(),
        pendingChanges: writtenCells,
        pendingSince
      });
      setStatus(`Guardado en la fila ${row}`);
      void verifyPendingWrite(entry);
    } catch (error) {
      host.dataset.writeVerification = "failed";
      setStatus(error.message, "error");
    } finally {
      state.saving = false;
      ui.save.disabled = false;
      syncSaveState();
    }
  }

  function pollSelection() {
    if (state.saving) return;
    const reference = nameBoxValue();
    const gid = currentGid();
    const signature = `${gid}:${reference}`;
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
      ui.save.disabled = true;
      ui.meta.textContent = "Fila de encabezados";
      setStatus("Selecciona una fila de datos debajo de los encabezados", "busy");
      return;
    }
    loadRow(row);
  }

  void ensureWorkspaceLoaded().finally(() => {
    setInterval(pollSelection, POLL_MS);
    pollSelection();
  });
})();
