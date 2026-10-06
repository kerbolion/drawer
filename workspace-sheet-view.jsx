import React from "react";
import Button from "antd/es/button/index.js";
import Checkbox from "antd/es/checkbox/index.js";
import Empty from "antd/es/empty/index.js";
import Input from "antd/es/input/index.js";
import Pagination from "antd/es/pagination/index.js";
import Select from "antd/es/select/index.js";
import Spin from "antd/es/spin/index.js";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CloseOutlined,
  DeleteOutlined,
  EyeInvisibleOutlined,
  FileTextOutlined,
  ProfileOutlined,
  PlusOutlined,
  SearchOutlined,
  TableOutlined,
  UnorderedListOutlined
} from "@ant-design/icons";

const PAGE_SIZES = [10, 20, 30, 40, 50];
const EMPTY_ROWS = [];

function text(value) {
  return String(value ?? "");
}

function normalized(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function useDebouncedValue(value, delay = 500) {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  React.useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => setDebouncedValue(value), delay);
    return () => globalThis.clearTimeout(timeoutId);
  }, [delay, value]);

  return debouncedValue;
}

function useStableEvent(callback) {
  const callbackRef = React.useRef(callback);
  React.useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return React.useCallback((...args) => callbackRef.current(...args), []);
}

function buildRowsSearchIndex(rows, columns) {
  return new Map(rows.map((row) => [
    String(row.number),
    normalized(columns.map((column) => row.cells[column.index]).join(" "))
  ]));
}

function filterRowsBySearchIndex(rows, search, searchIndex) {
  const query = normalized(search);
  if (!query) return rows;
  return rows.filter((row) => (searchIndex.get(String(row.number)) || "").includes(query));
}

function recordTitle(row, columns) {
  const preferred = columns.find((column) => column.type === "text" && text(row.cells[column.index]).trim())
    || columns.find((column) => text(row.cells[column.index]).trim());
  return preferred ? text(row.cells[preferred.index]) : `Fila ${row.number}`;
}

function fieldDisplay(value, property) {
  const source = text(value).trim();
  if (!source) return "—";
  if (property.type === "checkbox") {
    const checked = normalized(source) === normalized(property.checkedValue)
      || ["true", "verdadero", "si", "yes", "1"].includes(normalized(source));
    return checked ? "Sí" : "No";
  }
  return source.replace(/\s*\n\s*/g, " ");
}

function Filters({ columns, filters, onChange }) {
  const add = () => {
    const property = columns[0];
    if (!property) return;
    onChange([...filters, { id: `${Date.now()}-${Math.random()}`, columnId: property.id, value: "" }]);
  };
  return React.createElement(
    "div",
    { className: "workspace-table-filters" },
    ...filters.map((filter) => {
      const property = columns.find((column) => column.id === filter.columnId) || columns[0];
      return React.createElement(
        "div",
        { className: "workspace-table-filter", key: filter.id },
        React.createElement(Select, {
          size: "small",
          value: property?.id,
          options: columns.map((column) => ({ value: column.id, label: column.name })),
          onChange: (columnId) => onChange(filters.map((item) => item.id === filter.id ? { ...item, columnId } : item)),
          style: { width: 150 }
        }),
        React.createElement(Input, {
          allowClear: true,
          size: "small",
          placeholder: "Contiene",
          value: filter.value,
          onChange: (event) => onChange(filters.map((item) => item.id === filter.id ? { ...item, value: event.target.value } : item))
        }),
        React.createElement(Button, {
          type: "text",
          size: "small",
          icon: React.createElement(CloseOutlined),
          "aria-label": "Quitar filtro",
          onClick: () => onChange(filters.filter((item) => item.id !== filter.id))
        })
      );
    }),
    React.createElement(Button, { type: "text", size: "small", icon: React.createElement(PlusOutlined), onClick: add }, "Filtro")
  );
}

const IMMEDIATE_EDITOR_TYPES = new Set(["select", "status", "multiSelect", "date", "datetime", "time", "checkbox"]);

const WorkspaceCellEditor = React.memo(function WorkspaceCellEditor({ property, rawValue, row, renderEditor, toEditorValue, onCommit }) {
  const [editorValue, setEditorValue] = React.useState(() => toEditorValue(rawValue, property));
  const renderPendingRef = React.useRef(false);

  const flushDeferredCommit = React.useCallback(() => {
    if (!renderPendingRef.current) return;
    renderPendingRef.current = false;
    onCommit(row, property, undefined, { renderOnly: true });
  }, [onCommit, property, row]);

  React.useEffect(() => {
    renderPendingRef.current = false;
    setEditorValue(toEditorValue(rawValue, property));
  }, [property, rawValue, row, toEditorValue]);

  const handleChange = React.useCallback((nextValue) => {
    setEditorValue(nextValue);
    const immediate = IMMEDIATE_EDITOR_TYPES.has(property.type);
    onCommit(row, property, nextValue, { syncTable: immediate });
    renderPendingRef.current = !immediate;
  }, [onCommit, property, row]);

  return React.createElement(
    "div",
    {
      className: "workspace-table-cell-editor related-cell-editor",
      "data-workspace-row": String(row.number),
      "data-workspace-column": String(property.index + 1),
      "data-field-type": property.type,
      "data-protected": property.protected ? "true" : "false",
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) flushDeferredCommit();
      }
    },
    renderEditor(
      property,
      editorValue,
      handleChange
    )
  );
});

const WorkspaceTableRow = React.memo(function WorkspaceTableRow({
  onCellChange,
  onClearRows,
  onOpenRow,
  onToggleSelected,
  renderEditor,
  row,
  selected,
  toEditorValue,
  visibleColumns
}) {
  return React.createElement(
    "tr",
    { "data-workspace-row": String(row.number) },
    React.createElement("td", { className: "workspace-table-select" }, React.createElement(Checkbox, {
      checked: selected,
      onChange: (event) => onToggleSelected(row.number, event.target.checked)
    })),
    React.createElement("td", { className: "workspace-table-row-number" }, String(row.number)),
    ...visibleColumns.map((property) => React.createElement(
      "td",
      { key: `${property.id}:${property.index}`, "data-column-id": property.id },
      React.createElement(WorkspaceCellEditor, {
        property,
        rawValue: row.cells[property.index] ?? "",
        row,
        renderEditor,
        toEditorValue,
        onCommit: onCellChange
      })
    )),
    React.createElement(
      "td",
      { className: "workspace-table-actions" },
      React.createElement(Button, {
        size: "small",
        icon: React.createElement(FileTextOutlined),
        "data-workspace-open-row": String(row.number),
        onClick: () => onOpenRow(row.number)
      }, "Abrir"),
      React.createElement(Button, {
        danger: true,
        type: "text",
        size: "small",
        icon: React.createElement(DeleteOutlined),
        "aria-label": `Limpiar fila ${row.number}`,
        onClick: () => onClearRows([row.number])
      })
    )
  );
});

const WorkspaceTablePage = React.memo(function WorkspaceTablePage({
  active,
  onCellChange,
  onClearRows,
  onOpenRow,
  onToggleSelected,
  renderEditor,
  rows,
  selectedSet,
  toEditorValue,
  visibleColumns
}) {
  return React.createElement(
    "tbody",
    {
      hidden: !active,
      "aria-hidden": active ? undefined : "true"
    },
    ...rows.map((row) => React.createElement(WorkspaceTableRow, {
      key: row.number,
      onCellChange,
      onClearRows,
      onOpenRow,
      onToggleSelected,
      renderEditor,
      row,
      selected: selectedSet.has(row.number),
      toEditorValue,
      visibleColumns
    }))
  );
});

function DeckView({ columns, table, renderTypeIcon, onAddRow, onOpenRow }) {
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const query = normalized(search);
  const rows = (table?.rows || []).filter((row) => !query || normalized(row.cells.join(" ")).includes(query));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  React.useEffect(() => setPage(1), [search, pageSize, table?.name]);

  return React.createElement(
    "div",
    { className: "workspace-deck-view" },
    React.createElement(
      "div",
      { className: "workspace-deck-toolbar" },
      React.createElement(Input, {
        allowClear: true,
        prefix: React.createElement(SearchOutlined),
        placeholder: "Buscar registros",
        value: search,
        onChange: (event) => setSearch(event.target.value),
        style: { width: 280 }
      }),
      React.createElement(Button, {
        type: "primary",
        icon: React.createElement(PlusOutlined),
        "data-workspace-add-row": "",
        onClick: () => void onAddRow()
      }, "Nuevo registro")
    ),
    React.createElement(
      "div",
      { className: "workspace-deck-scroll" },
      pageRows.length ? React.createElement(
        "div",
        { className: "workspace-deck-grid" },
        ...pageRows.map((row) => {
          const title = recordTitle(row, columns);
          const titleColumn = columns.find((column) => text(row.cells[column.index]).trim());
          const previewColumns = columns
            .filter((column) => column.id !== titleColumn?.id && text(row.cells[column.index]).trim())
            .slice(0, 3);
          const open = () => onOpenRow(row.number);
          return React.createElement(
            "article",
            {
              className: "workspace-deck-card",
              key: row.number,
              role: "button",
              tabIndex: 0,
              "data-workspace-deck-row": String(row.number),
              onClick: (event) => {
                if (event.detail === 0 || globalThis.matchMedia?.("(pointer: coarse)").matches) open();
              },
              onDoubleClick: open,
              onKeyDown: (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                open();
              }
            },
            React.createElement(
              "div",
              { className: "workspace-deck-card-head" },
              React.createElement("strong", { title }, title),
              React.createElement(Button, {
                type: "text",
                size: "small",
                icon: React.createElement(FileTextOutlined),
                "aria-label": `Abrir fila ${row.number}`,
                "data-workspace-open-row": String(row.number),
                onClick: (event) => {
                  event.stopPropagation();
                  open();
                }
              })
            ),
            previewColumns.length ? React.createElement(
              "div",
              { className: "workspace-deck-fields" },
              ...previewColumns.map((property) => React.createElement(
                "div",
                { className: "workspace-deck-field", key: `${property.id}:${property.index}` },
                React.createElement("span", { className: "property-type-icon workspace-deck-field-icon" }, renderTypeIcon(property)),
                React.createElement("span", null, property.name),
                React.createElement("strong", { title: text(row.cells[property.index]) }, fieldDisplay(row.cells[property.index], property))
              ))
            ) : React.createElement("span", { className: "workspace-deck-empty" }, `Fila ${row.number}`)
          );
        })
      ) : React.createElement(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description: "No hay registros para mostrar" })
    ),
    React.createElement(
      "div",
      { className: "workspace-table-footer" },
      React.createElement("span", null, `${rows.length} registros`),
      React.createElement(Pagination, {
        current: safePage,
        pageSize,
        pageSizeOptions: PAGE_SIZES,
        showSizeChanger: true,
        total: rows.length,
        onChange: (nextPage, nextSize) => {
          setPage(nextPage);
          setPageSize(nextSize);
        }
      })
    )
  );
}

const TableView = React.memo(function TableView({ columns, hidden, hiddenColumnIds, table, renderEditor, renderTypeIcon, toEditorValue, onAddRow, onCellChange, onClearRows, onHiddenColumnIdsChange, onOpenRow }) {
  const [search, setSearch] = React.useState("");
  const debouncedSearch = useDebouncedValue(search, 500);
  const [filters, setFilters] = React.useState([]);
  const [selectedRows, setSelectedRows] = React.useState([]);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [mountedPages, setMountedPages] = React.useState([1]);
  const hiddenColumnsKey = (hiddenColumnIds || []).join("\u0000");
  const hiddenColumns = React.useMemo(() => hiddenColumnIds || [], [hiddenColumnsKey]);
  const hiddenColumnSet = React.useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const visibleColumns = React.useMemo(
    () => columns.filter((column) => !hiddenColumnSet.has(column.id)),
    [columns, hiddenColumnSet]
  );
  const columnsById = React.useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns]
  );
  const rows = table?.rows || EMPTY_ROWS;
  const searchIndex = React.useMemo(
    () => buildRowsSearchIndex(rows, visibleColumns),
    [rows, visibleColumns]
  );
  const searchedRows = React.useMemo(
    () => filterRowsBySearchIndex(rows, debouncedSearch, searchIndex),
    [debouncedSearch, rows, searchIndex]
  );
  const filteredRows = React.useMemo(() => searchedRows.filter((row) => filters.every((filter) => {
    const property = columnsById.get(filter.columnId);
    const filterValue = normalized(filter.value);
    if (!property || !filterValue) return true;
    return normalized(row.cells[property.index]).includes(filterValue);
  })), [columnsById, filters, searchedRows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = React.useMemo(
    () => filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredRows, pageSize, safePage]
  );
  const mountedPageRows = React.useMemo(() => new Map(mountedPages.map((mountedPage) => [
    mountedPage,
    filteredRows.slice((mountedPage - 1) * pageSize, mountedPage * pageSize)
  ])), [filteredRows, mountedPages, pageSize]);
  const pageRowNumbers = React.useMemo(() => pageRows.map((row) => row.number), [pageRows]);
  const selectedSet = React.useMemo(() => new Set(selectedRows), [selectedRows]);
  const selectedPageCount = React.useMemo(
    () => pageRowNumbers.filter((number) => selectedSet.has(number)).length,
    [pageRowNumbers, selectedSet]
  );
  const pageSelected = pageRows.length > 0 && selectedPageCount === pageRows.length;
  const stableRenderEditor = useStableEvent(renderEditor);
  const stableRenderTypeIcon = useStableEvent(renderTypeIcon);
  const stableToEditorValue = useStableEvent(toEditorValue);
  const stableOnAddRow = useStableEvent(onAddRow);
  const stableOnCellChange = useStableEvent(onCellChange);
  const stableOnClearRows = useStableEvent(onClearRows);
  const stableOnHiddenColumnIdsChange = useStableEvent(onHiddenColumnIdsChange);
  const stableOnOpenRow = useStableEvent(onOpenRow);

  React.useEffect(() => {
    setPage(1);
    setMountedPages([1]);
  }, [debouncedSearch, pageSize, filters]);
  React.useEffect(() => setSelectedRows([]), [table?.name]);

  React.useEffect(() => {
    setMountedPages((current) => current.filter((mountedPage) => mountedPage <= totalPages));
  }, [totalPages]);

  React.useEffect(() => {
    const nextPage = safePage + 1;
    if (nextPage > totalPages || mountedPages.includes(nextPage)) return undefined;
    let cancelled = false;
    const mountNextPage = () => {
      if (!cancelled) {
        setMountedPages((current) => current.includes(nextPage) ? current : [...current, nextPage].sort((left, right) => left - right));
      }
    };
    const requestIdleCallback = globalThis.requestIdleCallback;
    const handle = typeof requestIdleCallback === "function"
      ? requestIdleCallback(mountNextPage, { timeout: 500 })
      : globalThis.setTimeout(mountNextPage, 0);

    return () => {
      cancelled = true;
      if (typeof requestIdleCallback === "function") globalThis.cancelIdleCallback?.(handle);
      else globalThis.clearTimeout(handle);
    };
  }, [mountedPages, safePage, totalPages]);

  const toggleSelected = React.useCallback((rowNumber, checked) => {
    setSelectedRows((current) => checked
      ? Array.from(new Set([...current, rowNumber]))
      : current.filter((number) => number !== rowNumber));
  }, []);

  const togglePageSelected = React.useCallback((checked) => {
    setSelectedRows((current) => checked
      ? Array.from(new Set([...current, ...pageRowNumbers]))
      : current.filter((number) => !pageRowNumbers.includes(number)));
  }, [pageRowNumbers]);

  const changeColumnVisibility = React.useCallback((columnId, checked) => {
    stableOnHiddenColumnIdsChange(checked
      ? hiddenColumns.filter((id) => id !== columnId)
      : [...hiddenColumns, columnId]);
  }, [hiddenColumns, stableOnHiddenColumnIdsChange]);

  const clearSelected = React.useCallback(async () => {
    await stableOnClearRows(selectedRows);
    setSelectedRows([]);
  }, [selectedRows, stableOnClearRows]);

  const handlePaginationChange = React.useCallback((nextPage, nextSize) => {
    if (nextSize !== pageSize) {
      setPageSize(nextSize);
      setPage(1);
      setMountedPages([1]);
      return;
    }
    setMountedPages((current) => current.includes(nextPage)
      ? current
      : [...current, nextPage].sort((left, right) => left - right));
    setPage(nextPage);
  }, [pageSize]);

  return React.createElement(
    "div",
    {
      className: "workspace-table-view",
      hidden: Boolean(hidden),
      "aria-hidden": hidden ? "true" : undefined
    },
    React.createElement(
      "div",
      { className: "workspace-table-toolbar" },
      React.createElement(Input, {
        allowClear: true,
        prefix: React.createElement(SearchOutlined),
        placeholder: "Buscar registros",
        value: search,
        onChange: (event) => setSearch(event.target.value),
        style: { width: 260 }
      }),
      React.createElement(Filters, { columns, filters, onChange: setFilters }),
      React.createElement(
        "details",
        { className: "workspace-table-columns" },
        React.createElement("summary", null, React.createElement(EyeInvisibleOutlined), " Columnas"),
        React.createElement(
          "div",
          { className: "workspace-table-columns-menu" },
          ...columns.map((column) => React.createElement(Checkbox, {
            checked: !hiddenColumns.includes(column.id),
            key: `${column.id}:${column.index}`,
            onChange: (event) => changeColumnVisibility(column.id, event.target.checked)
          }, column.name))
        )
      ),
      selectedRows.length ? React.createElement(Button, {
        danger: true,
        icon: React.createElement(DeleteOutlined),
        onClick: clearSelected
      }, `Limpiar (${selectedRows.length})`) : null,
      React.createElement(Button, {
        type: "primary",
        icon: React.createElement(PlusOutlined),
        "data-workspace-add-row": "",
        onClick: () => void stableOnAddRow()
      }, "Nuevo registro")
    ),
    React.createElement(
      "div",
      { className: "workspace-table-scroll" },
      React.createElement(
        "table",
        { className: "workspace-data-table" },
        React.createElement(
          "thead",
          null,
          React.createElement(
            "tr",
            null,
            React.createElement("th", { className: "workspace-table-select" }, React.createElement(Checkbox, {
              checked: pageSelected,
              indeterminate: selectedPageCount > 0 && !pageSelected,
              onChange: (event) => togglePageSelected(event.target.checked)
            })),
            React.createElement("th", { className: "workspace-table-row-number" }, "#"),
            ...visibleColumns.map((column) => React.createElement(
              "th",
              { key: `${column.id}:${column.index}` },
              React.createElement(
                "div",
                { className: "workspace-table-column-heading" },
                React.createElement("span", { className: "property-type-icon" }, stableRenderTypeIcon(column)),
                React.createElement("span", null, column.name),
                React.createElement("small", null, column.type)
              )
            )),
            React.createElement("th", { className: "workspace-table-actions" }, "Acciones")
          )
        ),
        ...(filteredRows.length ? mountedPages.map((mountedPage) => React.createElement(WorkspaceTablePage, {
          key: mountedPage,
          active: mountedPage === safePage,
          onCellChange: stableOnCellChange,
          onClearRows: stableOnClearRows,
          onOpenRow: stableOnOpenRow,
          onToggleSelected: toggleSelected,
          renderEditor: stableRenderEditor,
          rows: mountedPageRows.get(mountedPage) || EMPTY_ROWS,
          selectedSet,
          toEditorValue: stableToEditorValue,
          visibleColumns
        })) : [React.createElement("tbody", { key: "empty" }, React.createElement("tr", null, React.createElement(
            "td",
            { colSpan: visibleColumns.length + 3 },
            React.createElement(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description: "No hay registros para mostrar" })
          )))])
      )
    ),
    React.createElement(
      "div",
      { className: "workspace-table-footer" },
      React.createElement("span", null, `${filteredRows.length} registros`),
      React.createElement(Pagination, {
        current: safePage,
        pageSize,
        pageSizeOptions: PAGE_SIZES,
        showSizeChanger: true,
        total: filteredRows.length,
        onChange: handlePaginationChange
      })
    )
  );
});

export function WorkspaceSheetView({
  columns,
  error,
  hiddenColumnIds,
  loading,
  onAddRow,
  onCellChange,
  onClearRows,
  onHiddenColumnIdsChange,
  onOpenRow,
  renderCalendar,
  renderCharts,
  renderEditor,
  renderTypeIcon,
  toEditorValue,
  renderKanban,
  renderTimeline,
  selectedSheetGid,
  sheetName,
  table
}) {
  const hiddenColumnsKey = (hiddenColumnIds || []).join("\u0000");
  const hiddenColumns = React.useMemo(() => hiddenColumnIds || [], [hiddenColumnsKey]);
  const visibleColumns = React.useMemo(
    () => columns.filter((column) => !hiddenColumns.includes(column.id)),
    [columns, hiddenColumns]
  );
  const stableOnAddRow = useStableEvent(onAddRow);
  const stableOnCellChange = useStableEvent(onCellChange);
  const stableOnClearRows = useStableEvent(onClearRows);
  const stableOnHiddenColumnIdsChange = useStableEvent(onHiddenColumnIdsChange);
  const stableOnOpenRow = useStableEvent(onOpenRow);
  const stableRenderEditor = useStableEvent(renderEditor);
  const stableRenderTypeIcon = useStableEvent(renderTypeIcon);
  const stableToEditorValue = useStableEvent(toEditorValue);
  const hasKanban = columns.some((column) => column.type === "status");
  const hasCalendar = columns.some((column) => column.type === "date");
  const hasTimeline = columns.some((column) => column.type === "date" && column.dateTimelineRole === "start")
    && columns.some((column) => column.type === "date" && column.dateTimelineRole === "end");
  const [activeView, setActiveView] = React.useState("deck");
  const [tableMounted, setTableMounted] = React.useState(false);

  React.useEffect(() => {
    setActiveView("deck");
    setTableMounted(false);
  }, [selectedSheetGid]);

  React.useEffect(() => {
    if (loading || !table || tableMounted) return undefined;
    let cancelled = false;
    const mountTable = () => {
      if (!cancelled) setTableMounted(true);
    };
    const requestIdleCallback = globalThis.requestIdleCallback;
    const handle = typeof requestIdleCallback === "function"
      ? requestIdleCallback(mountTable, { timeout: 500 })
      : globalThis.setTimeout(mountTable, 0);

    return () => {
      cancelled = true;
      if (typeof requestIdleCallback === "function") globalThis.cancelIdleCallback?.(handle);
      else globalThis.clearTimeout(handle);
    };
  }, [loading, selectedSheetGid, table, tableMounted]);

  React.useEffect(() => {
    if (activeView === "kanban" && !hasKanban) setActiveView("deck");
    if (activeView === "calendar" && !hasCalendar) setActiveView("deck");
    if (activeView === "timeline" && !hasTimeline) setActiveView("deck");
  }, [activeView, hasKanban, hasCalendar, hasTimeline]);

  const openRow = React.useCallback((number) => stableOnOpenRow(Number(number)), [stableOnOpenRow]);

  return React.createElement(
    "div",
    { className: "workspace-browser", "data-workspace-browser": "" },
    React.createElement(
      "section",
      { className: "workspace-browser-main" },
      React.createElement(
        "header",
        { className: "workspace-board-header" },
        React.createElement(
          "div",
          { className: "workspace-board-heading" },
          React.createElement("h2", null, sheetName),
          React.createElement("span", null, `${table?.rows?.length || 0} registros`)
        ),
        React.createElement(
          "div",
          { className: "workspace-board-tabs", role: "tablist", "aria-label": "Vistas de la hoja" },
          React.createElement(Button, {
            type: activeView === "deck" ? "primary" : "text",
            icon: React.createElement(ProfileOutlined),
            "data-workspace-view": "deck",
            onClick: () => setActiveView("deck")
          }, "Deck"),
          React.createElement(Button, {
            type: activeView === "table" ? "primary" : "text",
            icon: React.createElement(TableOutlined),
            "data-workspace-view": "table",
            onClick: () => setActiveView("table")
          }, "Tabla"),
          hasKanban ? React.createElement(Button, {
            type: activeView === "kanban" ? "primary" : "text",
            icon: React.createElement(AppstoreOutlined),
            "data-workspace-view": "kanban",
            onClick: () => setActiveView("kanban")
          }, "Kanban") : null,
          hasCalendar ? React.createElement(Button, {
            type: activeView === "calendar" ? "primary" : "text",
            icon: React.createElement(CalendarOutlined),
            "data-workspace-view": "calendar",
            onClick: () => setActiveView("calendar")
          }, "Calendario") : null,
          hasTimeline ? React.createElement(Button, {
            type: activeView === "timeline" ? "primary" : "text",
            icon: React.createElement(UnorderedListOutlined),
            "data-workspace-view": "timeline",
            onClick: () => setActiveView("timeline")
          }, "Cronograma") : null,
          React.createElement(Button, {
            type: activeView === "charts" ? "primary" : "text",
            icon: React.createElement(BarChartOutlined),
            "data-workspace-view": "charts",
            onClick: () => setActiveView("charts")
          }, "Charts")
        )
      ),
      error ? React.createElement("div", { className: "status error workspace-browser-error" }, error) : null,
      React.createElement(
        "div",
        { className: "workspace-board-content" },
        loading
          ? React.createElement("div", { className: "workspace-browser-loading" }, React.createElement(Spin, { size: "large" }))
          : !table
            ? React.createElement(Empty, { description: "No hay datos para mostrar" })
            : activeView === "table"
              ? null
              : activeView === "kanban"
                ? renderKanban(openRow, visibleColumns)
                : activeView === "calendar"
                  ? renderCalendar(openRow, visibleColumns)
                  : activeView === "timeline"
                    ? renderTimeline(openRow, visibleColumns)
                    : activeView === "charts"
                      ? renderCharts(visibleColumns)
                      : React.createElement(DeckView, {
                    columns: visibleColumns,
                    table,
                    renderTypeIcon: stableRenderTypeIcon,
                    onAddRow: stableOnAddRow,
                    onOpenRow: openRow
                  }),
        !loading && table && (tableMounted || activeView === "table")
          ? React.createElement(TableView, {
                  key: `table:${selectedSheetGid}`,
                  columns,
                  hidden: activeView !== "table",
                  hiddenColumnIds: hiddenColumns,
                  table,
                  renderEditor: stableRenderEditor,
                  renderTypeIcon: stableRenderTypeIcon,
                  toEditorValue: stableToEditorValue,
                  onAddRow: stableOnAddRow,
                  onCellChange: stableOnCellChange,
                  onClearRows: stableOnClearRows,
                  onHiddenColumnIdsChange: stableOnHiddenColumnIdsChange,
                  onOpenRow: openRow
                })
          : null
      )
    )
  );
}
