import antdTheme from "antd/es/theme/index.js";

const fontFamily = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

export function getWorkspaceThemeConfig(darkMode = false) {
  return {
    algorithm: darkMode ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#1677ff",
      colorBgLayout: darkMode ? "#141414" : "#f3f5f7",
      colorBgContainer: darkMode ? "#1f1f1f" : "#ffffff",
      colorBgElevated: darkMode ? "#1f1f1f" : "#ffffff",
      colorBorder: darkMode ? "#303030" : "#e5e7eb",
      colorBorderSecondary: darkMode ? "#303030" : "#edf0f2",
      colorText: darkMode ? "rgba(255, 255, 255, 0.88)" : "#111827",
      colorTextSecondary: darkMode ? "rgba(255, 255, 255, 0.68)" : "#4b5563",
      colorTextTertiary: darkMode ? "rgba(255, 255, 255, 0.55)" : "#6b7280",
      borderRadius: 6,
      fontFamily,
      zIndexPopupBase: 1200
    },
    components: {
      Card: { borderRadiusLG: 6 },
      Button: { borderRadius: 6 },
      Table: {
        headerBg: darkMode ? "#1f1f1f" : "#f7f8fa",
        headerColor: darkMode ? "rgba(255, 255, 255, 0.75)" : "#4b5563"
      }
    }
  };
}

export const workspaceThemeConfig = getWorkspaceThemeConfig(false);
export const workspaceDarkThemeConfig = getWorkspaceThemeConfig(true);
export const antdTokens = antdTheme.getDesignToken(workspaceThemeConfig);
export const darkAntdTokens = antdTheme.getDesignToken(workspaceDarkThemeConfig);

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
  shadowSoft: "rgba(15, 23, 42, 0.04)",
  timelineBar: "#262626",
  timelineBarBorder: "#404040",
  timelineBarText: "#ffffff",
  handleContrast: "rgba(255, 255, 255, 0.45)"
});

export const workspaceDarkTokens = Object.freeze({
  bg: "#141414",
  surface: "#1f1f1f",
  surfaceMuted: "#262626",
  surfaceSubtle: "#1a1a1a",
  surfaceRaised: "#262626",
  border: "#303030",
  borderSoft: "#303030",
  borderSubtle: "#303030",
  text: "rgba(255, 255, 255, 0.88)",
  textBody: "rgba(255, 255, 255, 0.85)",
  textSecondary: "rgba(255, 255, 255, 0.68)",
  textMuted: "rgba(255, 255, 255, 0.55)",
  textDisabled: "rgba(255, 255, 255, 0.35)",
  primary: "#1677ff",
  primaryBorder: "#4096ff",
  primarySoft: "rgba(22, 119, 255, 0.18)",
  primaryHover: "rgba(22, 119, 255, 0.28)",
  shadow: "rgba(0, 0, 0, 0.32)",
  shadowSoft: "rgba(0, 0, 0, 0.22)",
  timelineBar: "#0958d9",
  timelineBarBorder: "#4096ff",
  timelineBarText: "#ffffff",
  handleContrast: "rgba(17, 24, 39, 0.78)"
});
