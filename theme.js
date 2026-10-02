import antdTheme from "antd/es/theme/index.js";

// Copia deliberada del tema claro usado por workspace-antd/frontend/src/App.jsx.
// Mantener este objeto pequeño facilita comparar ambos proyectos cuando cambien los tokens.
export const workspaceThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#1677ff",
    colorBgLayout: "#f3f5f7",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorBorder: "#e5e7eb",
    colorBorderSecondary: "#edf0f2",
    colorText: "#111827",
    colorTextSecondary: "#4b5563",
    colorTextTertiary: "#6b7280",
    borderRadius: 6,
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  },
  components: {
    Card: { borderRadiusLG: 6 },
    Button: { borderRadius: 6 },
    Table: {
      headerBg: "#f7f8fa",
      headerColor: "#4b5563"
    }
  }
};

export const antdTokens = antdTheme.getDesignToken(workspaceThemeConfig);

// Variables de superficie que acompañan al tema de Ant Design en styles.css del proyecto.
export const workspaceTokens = Object.freeze({
  bg: "#f3f5f7",
  surface: "#ffffff",
  surfaceMuted: "#f7f8fa",
  surfaceSubtle: "#f8fafc",
  surfaceRaised: "#fbfcfe",
  border: "#e5e7eb",
  borderSoft: "#edf0f2",
  borderSubtle: "#f1f3f5",
  text: "#111827",
  textBody: "#1f2937",
  textSecondary: "#4b5563",
  textMuted: "#6b7280",
  textDisabled: "#9ca3af",
  primary: "#1677ff",
  primaryBorder: "#91caff",
  primarySoft: "#e6f4ff",
  primaryHover: "#bae0ff",
  shadow: "rgba(15, 23, 42, 0.08)",
  shadowSoft: "rgba(15, 23, 42, 0.04)"
});
