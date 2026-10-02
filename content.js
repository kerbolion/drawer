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
    headerCache: new Map()
  };

  const host = document.createElement("div");
  host.id = "sheets-session-probe";
  host.dataset.status = "starting";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styles = new CSSStyleSheet();
  styles.replaceSync(`
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .drawer {
      position: fixed; inset: 0 0 0 auto; z-index: 2147483647;
      width: min(380px, 92vw); background: #fff; color: #172033;
      border-left: 1px solid #dfe3e8; box-shadow: -8px 0 24px rgba(25, 35, 45, .12);
      display: flex; flex-direction: column;
      font: 13px/1.45 Arial, sans-serif;
    }
    .drawer[hidden], .reopen[hidden] { display: none; }
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
    footer { padding: 12px 18px 16px; border-top: 1px solid #e8ebef; background: #fff; }
    .meta { margin-bottom: 9px; color: #687386; font-size: 11px; }
    .save { width: 100%; border: 0; border-radius: 7px; padding: 11px 14px; background: #0b8043; color: #fff; font-weight: 700; cursor: pointer; }
    .save:disabled { background: #a8c9b8; cursor: default; }
    .reopen { position: fixed; right: 16px; top: 82px; z-index: 2147483647; border: 0; border-radius: 999px; padding: 10px 14px; background: #0b8043; color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.2); font: 700 12px Arial, sans-serif; cursor: pointer; }
  `);
  shadow.adoptedStyleSheets = [styles];

  function element(tag, className, text) {
    const node = document.createElement(tag);
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
  main.append(status, fields);

  const footer = element("footer");
  const meta = element("div", "meta", "Sin fila seleccionada");
  const save = element("button", "save", "Guardar cambios");
  save.type = "button";
  save.disabled = true;
  footer.append(meta, save);
  drawer.append(panelHeader, main, footer);

  const reopen = element("button", "reopen", "Abrir formulario");
  reopen.type = "button";
  reopen.hidden = true;
  shadow.append(drawer, reopen);

  const ui = { drawer, close, reopen, status, fields, meta, save };

  ui.close.addEventListener("click", () => {
    ui.drawer.hidden = true;
    ui.reopen.hidden = false;
  });
  ui.reopen.addEventListener("click", () => {
    ui.drawer.hidden = false;
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
    state.request?.abort();
    const request = new AbortController();
    state.request = request;
    state.loading = true;
    state.row = row;
    state.gid = gid;
    ui.save.disabled = true;
    ui.meta.textContent = `Hoja ${gid} · fila ${row}`;
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
    } catch (error) {
      if (error.name !== "AbortError") {
        ui.fields.replaceChildren();
        setStatus(error.message, "error");
      }
    } finally {
      if (state.request === request) state.loading = false;
    }
  }

  function renderFields() {
    ui.fields.replaceChildren();
    state.fields.forEach((label, index) => {
      const wrapper = document.createElement("label");
      wrapper.className = "field";
      const title = document.createElement("span");
      title.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.value = state.values[index] || "";
      input.dataset.column = String(index + 1);
      input.autocomplete = "off";
      wrapper.append(title, input);
      ui.fields.appendChild(wrapper);
    });
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function writeCell(reference, value) {
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
        type: "write-cell",
        requestId,
        reference,
        value
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
    setStatus(`Guardando ${changes.length} campo(s)…`, "busy");
    try {
      for (const change of changes) {
        await writeCell(`${columnName(change.index + 1)}${state.row}`, change.value);
      }
      let verified = false;
      for (let attempt = 0; attempt < 4 && !verified; attempt += 1) {
        await wait(attempt === 0 ? 450 : 600);
        state.headerCache.delete(`${spreadsheetId()}:${currentGid()}`);
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
      setStatus("Selecciona una celda de la fila que quieres abrir", "busy");
      return;
    }
    if (row === 1) {
      ui.fields.replaceChildren();
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
