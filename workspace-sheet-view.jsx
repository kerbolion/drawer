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
  CalendarOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  EyeInvisibleOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ProfileOutlined,
  PlusOutlined,
  SearchOutlined,
  TableOutlined
} from "@ant-design/icons";

const PAGE_SIZES = [10, 20, 30, 50];

function text(value) {
  return String(value ?? "");
}

function normalized(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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

function Sidebar({ documents, currentDocumentId, selectedSheetGid, onDocumentSelect, onSheetSelect }) {
  const [expanded, setExpanded] = React.useState(() => new Set([currentDocumentId]));

  React.useEffect(() => {
    setExpanded((current) => {
      if (current.has(currentDocumentId)) return current;
      return new Set([...current, currentDocumentId]);
    });
  }, [currentDocumentId]);

  const toggle = (id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return React.createElement(
    "aside",
    { className: "workspace-browser-sidebar", "aria-label": "Documentos y hojas" },
    React.createElement("div", { className: "workspace-browser-sidebar-title" }, "Documentos"),
    React.createElement(
      "nav",
      { className: "workspace-browser-tree" },
      ...documents.map((documentItem) => {
        const isExpanded = expanded.has(documentItem.id);
        const isCurrent = documentItem.id === currentDocumentId;
        return React.createElement(
          "section",
          { className: "workspace-browser-document", key: documentItem.id },
          React.createElement(
            "div",
            { className: `workspace-browser-document-row ${isCurrent ? "is-current" : ""}`.trim() },
            React.createElement(Button, {
              type: "text",
              size: "small",
              className: "workspace-browser-tree-toggle",
              icon: React.createElement(DownOutlined),
              "aria-label": isExpanded ? "Contraer documento" : "Expandir documento",
              onClick: () => toggle(documentItem.id),
              style: { transform: isExpanded ? "none" : "rotate(-90deg)" }
            }),
            React.createElement(
              "button",
              {
                className: "workspace-browser-document-button",
                type: "button",
                title: documentItem.name,
                onClick: () => onDocumentSelect(documentItem)
              },
              React.createElement(FolderOpenOutlined),
              React.createElement("span", null, documentItem.name)
            )
          ),
          isExpanded ? React.createElement(
            "div",
            { className: "workspace-browser-sheets" },
            ...(documentItem.sheets?.length
              ? documentItem.sheets.map((sheet) => React.createElement(
                "button",
                {
                  className: `workspace-browser-sheet ${isCurrent && String(sheet.gid) === String(selectedSheetGid) ? "is-active" : ""}`.trim(),
                  type: "button",
                  key: `${documentItem.id}:${sheet.gid}`,
                  onClick: () => isCurrent ? onSheetSelect(sheet) : onDocumentSelect(documentItem, sheet)
                },
                React.createElement(TableOutlined),
                React.createElement("span", null, sheet.name)
              ))
              : [React.createElement("span", { className: "workspace-browser-no-sheets", key: "empty" }, "Sin hojas configuradas")])
          ) : null
        );
      })
    )
  );
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

const WorkspaceCellEditor = React.memo(function WorkspaceCellEditor({ property, rawValue, row, renderEditor, toEditorValue, onCommit }) {
  const [editorValue, setEditorValue] = React.useState(() => toEditorValue(rawValue, property));

  React.useEffect(() => {
    setEditorValue(toEditorValue(rawValue, property));
  }, [property, rawValue, row, toEditorValue]);

  const changeValue = (nextValue) => {
    setEditorValue(nextValue);
    Promise.resolve(onCommit(row, property, nextValue)).catch(() => {});
  };

  return React.createElement(
    "div",
    {
      className: "workspace-table-cell-editor related-cell-editor",
      "data-workspace-row": String(row.number),
      "data-workspace-column": String(property.index + 1),
      "data-field-type": property.type,
      "data-protected": property.protected ? "true" : "false"
    },
    renderEditor(
      property,
      editorValue,
      changeValue
    )
  );
}, (previous, next) => (
  previous.property === next.property
  && previous.rawValue === next.rawValue
  && previous.row === next.row
));

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

function TableView({ columns, hiddenColumnIds, table, renderEditor, renderTypeIcon, toEditorValue, onAddRow, onCellChange, onClearRows, onHiddenColumnIdsChange, onOpenRow }) {
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState([]);
  const [selectedRows, setSelectedRows] = React.useState([]);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const hiddenColumns = hiddenColumnIds || [];
  const visibleColumns = columns.filter((column) => !hiddenColumns.includes(column.id));
  const rows = table?.rows || [];
  const query = normalized(search);
  const filteredRows = rows.filter((row) => {
    if (query && !normalized(row.cells.join(" ")).includes(query)) return false;
    return filters.every((filter) => {
      const property = columns.find((column) => column.id === filter.columnId);
      if (!property || !normalized(filter.value)) return true;
      return normalized(row.cells[property.index]).includes(normalized(filter.value));
    });
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageSelected = pageRows.length > 0 && pageRows.every((row) => selectedRows.includes(row.number));

  React.useEffect(() => setPage(1), [search, pageSize, filters.map((filter) => `${filter.columnId}:${filter.value}`).join("|")]);
  React.useEffect(() => setSelectedRows([]), [table?.name]);

  return React.createElement(
    "div",
    { className: "workspace-table-view" },
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
            onChange: (event) => onHiddenColumnIdsChange(event.target.checked
              ? hiddenColumns.filter((id) => id !== column.id)
              : [...hiddenColumns, column.id])
          }, column.name))
        )
      ),
      selectedRows.length ? React.createElement(Button, {
        danger: true,
        icon: React.createElement(DeleteOutlined),
        onClick: async () => {
          await onClearRows(selectedRows);
          setSelectedRows([]);
        }
      }, `Limpiar (${selectedRows.length})`) : null,
      React.createElement(Button, {
        type: "primary",
        icon: React.createElement(PlusOutlined),
        "data-workspace-add-row": "",
        onClick: () => void onAddRow()
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
              indeterminate: pageRows.some((row) => selectedRows.includes(row.number)) && !pageSelected,
              onChange: (event) => setSelectedRows((current) => event.target.checked
                ? [...new Set([...current, ...pageRows.map((row) => row.number)])]
                : current.filter((number) => !pageRows.some((row) => row.number === number)))
            })),
            React.createElement("th", { className: "workspace-table-row-number" }, "#"),
            ...visibleColumns.map((column) => React.createElement(
              "th",
              { key: `${column.id}:${column.index}` },
              React.createElement(
                "div",
                { className: "workspace-table-column-heading" },
                React.createElement("span", { className: "property-type-icon" }, renderTypeIcon(column)),
                React.createElement("span", null, column.name),
                React.createElement("small", null, column.type)
              )
            )),
            React.createElement("th", { className: "workspace-table-actions" }, "Acciones")
          )
        ),
        React.createElement(
          "tbody",
          null,
          ...(pageRows.length ? pageRows.map((row) => React.createElement(
            "tr",
            { key: row.number, "data-workspace-row": String(row.number) },
            React.createElement("td", { className: "workspace-table-select" }, React.createElement(Checkbox, {
              checked: selectedRows.includes(row.number),
              onChange: (event) => setSelectedRows((current) => event.target.checked
                ? [...current, row.number]
                : current.filter((number) => number !== row.number))
            })),
            React.createElement("td", { className: "workspace-table-row-number" }, String(row.number)),
            ...visibleColumns.map((property) => React.createElement(
              "td",
              { key: `${property.id}:${property.index}`, "data-column-id": property.id },
              React.createElement(WorkspaceCellEditor, {
                property,
                rawValue: row.cells[property.index] || "",
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
          )) : [React.createElement("tr", { key: "empty" }, React.createElement(
            "td",
            { colSpan: visibleColumns.length + 3 },
            React.createElement(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description: "No hay registros para mostrar" })
          ))])
        )
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
        onChange: (nextPage, nextSize) => {
          setPage(nextPage);
          setPageSize(nextSize);
        }
      })
    )
  );
}

export function WorkspaceSheetView({
  columns,
  currentDocumentId,
  documents,
  error,
  hiddenColumnIds,
  loading,
  onAddRow,
  onCellChange,
  onClearRows,
  onDocumentSelect,
  onHiddenColumnIdsChange,
  onOpenRow,
  onSheetSelect,
  renderCalendar,
  renderEditor,
  renderTypeIcon,
  toEditorValue,
  renderKanban,
  selectedSheetGid,
  sheetName,
  table
}) {
  const hiddenColumns = hiddenColumnIds || [];
  const visibleColumns = columns.filter((column) => !hiddenColumns.includes(column.id));
  const hasKanban = columns.some((column) => column.type === "status");
  const hasCalendar = columns.some((column) => column.type === "date");
  const [activeView, setActiveView] = React.useState("deck");

  React.useEffect(() => {
    setActiveView("deck");
  }, [selectedSheetGid]);

  React.useEffect(() => {
    if (activeView === "kanban" && !hasKanban) setActiveView("deck");
    if (activeView === "calendar" && !hasCalendar) setActiveView("deck");
  }, [activeView, hasKanban, hasCalendar]);

  const openRow = (number) => onOpenRow(Number(number));

  return React.createElement(
    "div",
    { className: "workspace-browser", "data-workspace-browser": "" },
    React.createElement(Sidebar, {
      documents,
      currentDocumentId,
      selectedSheetGid,
      onDocumentSelect,
      onSheetSelect
    }),
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
          }, "Calendario") : null
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
            : activeView === "kanban"
              ? renderKanban(openRow, visibleColumns)
              : activeView === "calendar"
                ? renderCalendar(openRow, visibleColumns)
                : activeView === "table" ? React.createElement(TableView, {
                  columns,
                  hiddenColumnIds: hiddenColumns,
                  table,
                  renderEditor,
                  renderTypeIcon,
                  toEditorValue,
                  onAddRow,
                  onCellChange,
                  onClearRows,
                  onHiddenColumnIdsChange,
                  onOpenRow: openRow
                }) : React.createElement(DeckView, {
                  columns: visibleColumns,
                  table,
                  renderTypeIcon,
                  onAddRow,
                  onOpenRow: openRow
                })
      )
    )
  );
}
