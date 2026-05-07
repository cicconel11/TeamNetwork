/**
 * App Chrome Colors
 * Neutral slate palette for header and tab bar.
 * These colors must NOT be derived from org theme.
 */
export const APP_CHROME = {
  // Header gradient
  gradientStart: "#0f172a",  // slate-900
  gradientEnd: "#020617",    // slate-950

  // Tab bar
  tabBarBackground: "#020617",
  tabBarBorder: "#1e293b",   // slate-800
  tabBarActive: "#ffffff",
  tabBarInactive: "#94a3b8", // slate-400

  // Action button (center + in tab bar)
  actionButtonBackground: "#ffffff",
  actionButtonIcon: "#0f172a",

  // Header text
  headerTitle: "#ffffff",
  headerMeta: "rgba(255, 255, 255, 0.7)",

  // Avatar fallback
  avatarBackground: "rgba(255, 255, 255, 0.15)",
  avatarText: "#ffffff",
} as const;

export type AppChromeColors = typeof APP_CHROME;
