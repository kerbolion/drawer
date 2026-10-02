(() => {
  "use strict";

  if (!/\/spreadsheets\/d\/[^/]+\/edit/.test(location.pathname)) return;
  if (document.getElementById("sheets-session-probe")) return;

  const MAX_COLUMN = "ZZ";
  const POLL_MS = 250;
  const CACHE_PREFIX = "srd:v1";
  const CACHE_INDEX_KEY = `${CACHE_PREFIX}:index`;
  const MAX_PERSISTENT_ENTRIES = 120;
  const SHEET_MEMORY_TTL = 5_000;
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
    cacheWriteQueue: Promise.resolve()
  };

  const host = document.createElement("div");
  host.id = "sheets-session-probe";
  host.dataset.status = "starting";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const shellStyles = new CSSStyleSheet();
  shellStyles.replaceSync(`
    :host { all: initial; }
    .panel-frame {
      position: fixed; inset: 0 0 0 auto; z-index: 2147483647;
      width: min(380px, 92vw); height: 100vh; border: 0; background: #fff;
      box-shadow: -8px 0 24px rgba(25, 35, 45, .12);
    }
    .panel-frame[hidden], .reopen[hidden] { display: none; }
    .reopen { position: fixed; right: 16px; top: 82px; z-index: 2147483647; border: 0; border-radius: 999px; padding: 10px 14px; background: #0b8043; color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.2); font: 700 12px Arial, sans-serif; cursor: pointer; }
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
  panelDocument.documentElement.lang = "es";
  panelDocument.body.replaceChildren();
  const panelStyles = panelDocument.createElement("style");
  panelStyles.textContent = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #fff; }
    .drawer {
      width: 100%; height: 100%; background: #fff; color: #172033;
      border-left: 1px solid #dfe3e8;
      display: flex; flex-direction: column;
      font: 13px/1.45 Arial, sans-serif;
    }
    header { padding: 18px 18px 14px; border-bottom: 1px solid #e8ebef; }
    .eyebrow { color: #0b8043; font-size: 10px; font-weight: 700; letter-spacing: .16em; }
    .title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    h1 { margin: 6px 0 0; font-size: 19px; line-height: 1.25; }
    .icon-button { border: 0; background: transparent; color: #4b5563; font-size: 22px; cursor: pointer; }
    main { flex: 1; overflow: auto; padding: 16px 18px 24px; }
    .status { margin-bottom: 16px; padding: 10px 12px; border-radius: 8px; background: #eef7f2; color: #216e46; }
    .status.error { background: #fce8e6; color: #b3261e; }
    .status.busy { background: #eef3fc; color: #185abc; }
    .field { display: block; margin-bottom: 14px; }
    .field span { display: block; margin-bottom: 6px; color: #303846; font-weight: 700; }
    .field input {
      width: 100%; border: 1px solid #cfd6df; border-radius: 7px;
      padding: 10px 11px; background: #fff; color: #172033; font: inherit;
    }
    .field input:focus { border-color: #1a73e8; outline: 2px solid rgba(26, 115, 232, .15); }
    .related { margin-top: 24px; padding-top: 18px; border-top: 1px solid #e8ebef; }
    .related h2 { margin: 0 0 10px; font-size: 15px; }
    .related-status { color: #687386; font-size: 12px; }
    .relation { margin-top: 12px; border: 1px solid #dfe3e8; border-radius: 9px; overflow: hidden; }
    .relation-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px 12px; background: #f7f9fb; }
    .relation-title { font-weight: 700; }
    .relation-kind { margin-top: 2px; color: #687386; font-size: 10px; }
    .relation-count { min-width: 24px; border-radius: 999px; padding: 2px 7px; background: #e6f4ea; color: #137333; text-align: center; font-size: 11px; font-weight: 700; }
    .relation-empty { padding: 12px; color: #687386; font-size: 12px; }
    .relation-table { width: 100%; overflow-x: auto; }
    table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { max-width: 180px; padding: 7px 9px; border-top: 1px solid #edf0f3; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { color: #556070; background: #fff; font-weight: 700; }
    tbody tr:nth-child(even) { background: #fafbfc; }
    .relation-more { padding: 8px 10px; border-top: 1px solid #edf0f3; color: #687386; font-size: 11px; }
    footer { padding: 12px 18px 16px; border-top: 1px solid #e8ebef; background: #fff; }
    .meta { margin-bottom: 9px; color: #687386; font-size: 11px; }
    .save { width: 100%; border: 0; border-radius: 7px; padding: 11px 14px; background: #0b8043; color: #fff; font-weight: 700; cursor: pointer; }
    .save:disabled { background: #a8c9b8; cursor: default; }
  `;
  panelDocument.head.appendChild(panelStyles);

  function element(tag, className, text) {
    const node = panelDocument.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const drawer = element("aside", "drawer");
  drawer.setAttribute("aria-label", "Detalles de la fila");
  const panelHeader = element("header");
  const eyebrow = element("div", "eyebrow", "PRUEBA LOCAL · SESIÓN DE GOOGLE");
  const titleRow = element("div", "title-row");
  const title = element("h1", "", "Detalles de la fila");
  const close = element("button", "icon-button close", "×");
  close.type = "button";
  close.title = "Cerrar";
  close.setAttribute("aria-label", "Cerrar");
  titleRow.append(title, close);
  panelHeader.append(eyebrow, titleRow);

  const main = element("main");
  const status = element("div", "status busy", "Esperando una celda…");
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
  panelDocument.body.appendChild(drawer);

  const ui = {
    frame: panelFrame,
    drawer,
    close,
    reopen,
    status,
    fields,
    relatedStatus,
    relatedList,
    meta,
    save
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

  function cacheKey(kind, gid, row) {
    return `${CACHE_PREFIX}:${kind}:${encodeURIComponent(spreadsheetId())}:${encodeURIComponent(gid)}:${row}`;
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

  function sameValues(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function setStatus(message, kind = "ok") {
    ui.status.textContent = message;
    ui.status.className = `status ${kind === "ok" ? "" : kind}`.trim();
    host.dataset.status = kind;
  }

  function embedUrl(range) {
    const url = new URL(`/spreadsheets/d/${spreadsheetId()}/htmlembed/sheet`, location.origin);
    url.searchParams.set("gid", currentGid());
    url.searchParams.set("range", range);
    url.searchParams.set("_", Date.now().toString());
    return url;
  }

  function readRange(range, signal) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      frame.src = embedUrl(range).href;
      let finished = false;

      const timeout = setTimeout(() => finish(new Error("La vista HTML tardó demasiado en responder")), 12_000);
      const abort = () => finish(new DOMException("Lectura cancelada", "AbortError"));

      function finish(error, rows) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        frame.remove();
        if (error) reject(error);
        else resolve(rows);
      }

      frame.addEventListener("load", () => {
        try {
          const doc = frame.contentDocument;
          const rows = Array.from(doc?.querySelectorAll("tbody tr") || []).flatMap((tr) => {
            const rowHeader = tr.querySelector("th.row-headers-background");
            if (!rowHeader) return [];
            const number = Number(rowHeader.textContent.trim());
            const cells = Array.from(
              tr.querySelectorAll("td:not(.freezebar-cell)"),
              (cell) => cell.textContent.trim()
            );
            return Number.isFinite(number) ? [{ number, cells }] : [];
          });
          if (!rows.length) throw new Error("La vista HTML no devolvió filas; revisa que tu sesión tenga acceso");
          finish(null, rows);
        } catch (error) {
          finish(new Error(error instanceof Error ? error.message : String(error)));
        }
      }, { once: true });

      if (signal?.aborted) abort();
      else {
        signal?.addEventListener("abort", abort, { once: true });
        (document.body || document.documentElement).appendChild(frame);
      }
    });
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

  function readSheetTable(sheetName, range, signal) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      frame.src = sheetQueryUrl(sheetName, range).href;
      let finished = false;

      const timeout = setTimeout(() => finish(new Error(`La hoja ${sheetName} tardó demasiado en responder`)), 15_000);
      const abort = () => finish(new DOMException("Lectura cancelada", "AbortError"));

      function finish(error, table) {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        frame.remove();
        if (error) reject(error);
        else resolve(table);
      }

      frame.addEventListener("load", () => {
        try {
          const table = frame.contentDocument?.querySelector("table");
          if (!table) throw new Error(`Google no devolvió datos para la hoja ${sheetName}`);
          const rows = Array.from(table.querySelectorAll("tr"), (tr) =>
            Array.from(tr.querySelectorAll("td, th"), (cell) => cell.textContent.trim())
          ).filter((cells) => cells.length);
          const headers = rows[0] || [];
          finish(null, {
            name: sheetName,
            headers,
            rows: rows.slice(1).map((cells, index) => ({ number: index + 2, cells }))
          });
        } catch (error) {
          finish(new Error(error instanceof Error ? error.message : String(error)));
        }
      }, { once: true });

      if (signal?.aborted) abort();
      else {
        signal?.addEventListener("abort", abort, { once: true });
        (document.body || document.documentElement).appendChild(frame);
      }
    });
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

  function setRelatedStatus(message) {
    ui.relatedStatus.hidden = false;
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

  function startRelationships(currentHeaders, currentValues, parentSignal) {
    state.relationRequest?.abort();
    const controller = new AbortController();
    state.relationRequest = controller;
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", () => controller.abort(), { once: true });
    void loadRelationships(currentHeaders, currentValues, controller.signal);
  }

  async function loadRelationships(currentHeaders, currentValues, signal) {
    const currentSheet = activeSheetName();
    const persistentKey = cacheKey("relations", currentGid(), state.row);
    const cached = await readPersistentCache(persistentKey);
    if (signal?.aborted) return;
    const usableCache = cached?.currentSheet === currentSheet && Array.isArray(cached.relations);
    if (usableCache) {
      showRelations(cached.relations);
      setRelatedStatus("Mostrando relacionados guardados · comprobando cambios…");
    } else {
      setRelatedStatus("Detectando relaciones por columnas ID…");
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

  function currentInputValues() {
    return Array.from(ui.fields.querySelectorAll("input[data-column]"), (input) => input.value);
  }

  function applyRowData(labels, values, row, signal, drafts = []) {
    const width = Math.max(labels.length, values.length);
    state.values = Array.from({ length: width }, (_, index) => values[index] || "");
    state.fields = Array.from({ length: width }, (_, index) => labels[index] || `Columna ${columnName(index + 1)}`);
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
    state.row = row;
    state.gid = gid;
    ui.fields.inert = true;
    ui.fields.setAttribute("aria-busy", "true");
    setRelatedStatus("Detectando hojas y relaciones…");
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
      const width = Math.max(labels.length, values.length);
      const freshValues = Array.from({ length: width }, (_, index) => values[index] || "");
      const freshLabels = Array.from({ length: width }, (_, index) => labels[index] || "");
      const changed = !cached || !sameValues(cached.labels, freshLabels) || !sameValues(cached.values, freshValues);
      void writePersistentCache(persistentKey, {
        labels: freshLabels,
        values: freshValues,
        updatedAt: Date.now()
      });

      if (!cached) {
        applyRowData(freshLabels, freshValues, row, request.signal);
        setStatus(`Lectura automática confirmada · fila ${row}`);
      } else if (!changed) {
        setStatus(`Fila ${row} actualizada · sin cambios nuevos`);
      } else {
        const draftValues = currentInputValues();
        const dirty = draftValues.flatMap((value, index) =>
          value !== state.values[index] ? [{ index, value }] : []
        );
        applyRowData(freshLabels, freshValues, row, request.signal, dirty);
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
      if (state.request === request) state.loading = false;
    }
  }

  function renderFields(drafts = new Map()) {
    const existing = Array.from(ui.fields.children);
    state.fields.forEach((label, index) => {
      let wrapper = existing[index];
      let title = wrapper?.querySelector(":scope > span");
      let input = wrapper?.querySelector(":scope > input");

      if (!wrapper?.classList.contains("field") || !title || !input) {
        wrapper = element("label", "field");
        title = element("span");
        input = element("input");
        input.type = "text";
        input.autocomplete = "off";
        wrapper.append(title, input);
        ui.fields.appendChild(wrapper);
      }

      title.textContent = label;
      input.dataset.column = String(index + 1);
      const nextValue = drafts.has(index) ? drafts.get(index) : (state.values[index] || "");
      if (input.value !== nextValue) input.value = nextValue;
    });

    for (let index = existing.length - 1; index >= state.fields.length; index -= 1) {
      existing[index].remove();
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

  async function saveChanges() {
    if (state.saving || !state.row) return;
    if (state.viewRow !== state.row || state.viewGid !== state.gid) {
      setStatus("Espera a que termine de cargar la fila seleccionada", "busy");
      return;
    }
    const inputs = Array.from(ui.fields.querySelectorAll("input[data-column]"));
    const changes = inputs.flatMap((input) => {
      const index = Number(input.dataset.column) - 1;
      return input.value === state.values[index] ? [] : [{ index, value: input.value }];
    });
    if (!changes.length) {
      setStatus("No hay cambios pendientes");
      return;
    }

    state.saving = true;
    ui.save.disabled = true;
    setStatus(`Pegando ${changes.length} campo(s) en un solo bloque…`, "busy");
    try {
      const firstChanged = changes[0].index;
      const lastChanged = changes[changes.length - 1].index;
      const blockValues = inputs.slice(firstChanged, lastChanged + 1).map((input) => input.value);
      await writeRange(`${columnName(firstChanged + 1)}${state.row}`, blockValues);
      let verified = false;
      for (let attempt = 0; attempt < 4 && !verified; attempt += 1) {
        await wait(attempt === 0 ? 450 : 600);
        state.headerCache.delete(`${spreadsheetId()}:${currentGid()}`);
        state.sheetCache.clear();
        await loadRow(state.row, true);
        verified = changes.every((change) => state.values[change.index] === change.value);
      }
      if (!verified) throw new Error("Sheets no confirmó todos los valores; el pegado sintético puede estar bloqueado en este navegador");
      setStatus(`Guardado y verificado en la fila ${state.row}`);
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      state.saving = false;
      ui.save.disabled = false;
    }
  }

  function pollSelection() {
    if (state.saving) return;
    const reference = nameBoxValue();
    const gid = currentGid();
    const signature = `${gid}:${reference}`;
    if (!reference || signature === state.lastSelection) return;
    state.lastSelection = signature;
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

  setInterval(pollSelection, POLL_MS);
  pollSelection();
})();
