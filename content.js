(() => {
  "use strict";

  if (!/\/spreadsheets\/d\/[^/]+\/edit/.test(location.pathname)) return;
  if (document.getElementById("sheets-session-probe")) return;

  const MAX_COLUMN = "ZZ";
  const POLL_MS = 250;
  const state = {
    row: null,
    gid: null,
    values: [],
    fields: [],
    loading: false,
    saving: false,
    request: null,
    writeRequest: 0,
    lastSelection: "",
    headerCache: new Map(),
    sheetCache: new Map()
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
    if (cached && Date.now() - cached.loadedAt < 30_000) return cached.table;
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
    const article = element("article", "relation");
    const heading = element("div", "relation-head");
    const headingText = element("div");
    const title = element("div", "relation-title", relation.sheetName);
    const kind = element("div", "relation-kind", relation.description);
    const count = element("div", "relation-count", String(relation.rows.length));
    headingText.append(title, kind);
    heading.append(headingText, count);
    article.appendChild(heading);

    if (!relation.rows.length) {
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
    if (relation.rows.length > 20) {
      article.appendChild(element("div", "relation-more", `Y ${relation.rows.length - 20} registro(s) más.`));
    }
    ui.relatedList.appendChild(article);
  }

  async function loadRelationships(currentHeaders, currentValues, signal) {
    ui.relatedList.replaceChildren();
    setRelatedStatus("Detectando relaciones por columnas ID…");
    const currentSheet = activeSheetName();
    const otherSheets = visibleSheetNames().filter((name) => name !== currentSheet);
    if (!otherSheets.length) {
      setRelatedStatus("No hay otras hojas visibles en este documento.");
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
        setRelatedStatus("No encontré columnas ID compartidas con las otras hojas.");
        return;
      }

      const relationResults = await Promise.allSettled(descriptors.map(async (descriptor) => {
        const table = await cachedSheetTable(descriptor.sheetName, true, signal);
        const rows = table.rows.filter((row) => comparable(row.cells[descriptor.matchIndex]) === descriptor.matchValue);
        return { ...descriptor, headers: table.headers, rows };
      }));
      if (signal?.aborted) return;

      const relations = relationResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      ui.relatedStatus.hidden = relations.length > 0;
      for (const relation of relations) renderRelation(relation);
      const failures = relationResults.length - relations.length;
      if (!relations.length) setRelatedStatus("No pude leer las hojas relacionadas con la sesión actual.");
      else if (failures) setRelatedStatus(`Se cargaron relaciones, pero ${failures} hoja(s) no respondieron.`);
    } catch (error) {
      if (error.name !== "AbortError") setRelatedStatus(error.message);
    }
  }

  async function headers(signal) {
    const key = `${spreadsheetId()}:${currentGid()}`;
    if (state.headerCache.has(key)) return state.headerCache.get(key);
    const rows = await readRange(`A1:${MAX_COLUMN}1`, signal);
    const labels = rows.find((row) => row.number === 1)?.cells || [];
    state.headerCache.set(key, labels);
    return labels;
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
    ui.save.disabled = true;
    ui.relatedList.replaceChildren();
    setRelatedStatus("Detectando hojas y relaciones…");
    ui.meta.textContent = `${activeSheetName() || `Hoja ${gid}`} · fila ${row}`;
    setStatus(`Leyendo la fila ${row} desde tu sesión de Google…`, "busy");

    try {
      const [labels, rows] = await Promise.all([
        headers(request.signal),
        readRange(`A${row}:${MAX_COLUMN}${row}`, request.signal)
      ]);
      const values = rows.find((item) => item.number === row)?.cells || [];
      const width = Math.max(labels.length, values.length);
      state.values = Array.from({ length: width }, (_, index) => values[index] || "");
      state.fields = Array.from({ length: width }, (_, index) => labels[index] || `Columna ${columnName(index + 1)}`);
      renderFields();
      setStatus(`Lectura automática confirmada · fila ${row}`);
      host.dataset.row = String(row);
      ui.save.disabled = false;
      void loadRelationships(labels, state.values, request.signal);
    } catch (error) {
      if (error.name !== "AbortError") {
        ui.fields.replaceChildren();
        ui.relatedList.replaceChildren();
        setRelatedStatus("No se pudieron buscar relaciones para esta fila.");
        setStatus(error.message, "error");
      }
    } finally {
      if (state.request === request) state.loading = false;
    }
  }

  function renderFields() {
    ui.fields.replaceChildren();
    state.fields.forEach((label, index) => {
      const wrapper = element("label", "field");
      const title = element("span", "", label);
      const input = element("input");
      input.type = "text";
      input.value = state.values[index] || "";
      input.dataset.column = String(index + 1);
      input.autocomplete = "off";
      wrapper.append(title, input);
      ui.fields.appendChild(wrapper);
    });
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
      ui.relatedList.replaceChildren();
      setRelatedStatus("Selecciona una fila para buscar relaciones.");
      setStatus("Selecciona una celda de la fila que quieres abrir", "busy");
      return;
    }
    if (row === 1) {
      ui.fields.replaceChildren();
      ui.relatedList.replaceChildren();
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
