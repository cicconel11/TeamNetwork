/**
 * Organization color theming utilities
 * 3-color system: base (white/dark toggle), sidebar (free hex), button (free hex)
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Returns the color if valid 6-digit hex, otherwise the fallback. */
export function safeHexColor(raw: string | null | undefined, fallback: string): string {
  return typeof raw === "string" && HEX_COLOR_RE.test(raw) ? raw : fallback;
}

/**
 * Final gate before injecting a value into a CSS custom property declaration.
 * Allows hex colors, CSS keywords, and simple numeric/color-name tokens.
 * Rejects anything containing `;`, `{`, `}`, `/`, `<`, `>`, quotes, or newlines
 * so a malformed derived value cannot escape the declaration context.
 */
const CSS_VALUE_ALLOWED = /^[#a-zA-Z0-9._\-+(), %]+$/;
export function safeCssValue(raw: string, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  if (raw.length > 64) return fallback;
  return CSS_VALUE_ALLOWED.test(raw) ? raw : fallback;
}

/**
 * Adjusts a hex color by lightening or darkening it
 * @param hex - Hex color code (3 or 6 digits)
 * @param amount - Positive to lighten, negative to darken
 * @returns Adjusted hex color
 */
export function adjustColor(hex: string, amount: number): string {
  const clamp = (num: number) => Math.min(255, Math.max(0, num));

  let color = hex.replace("#", "");
  if (color.length === 3) {
    color = color
      .split("")
      .map((c) => c + c)
      .join("");
  }

  const num = parseInt(color, 16);
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0x00ff) + amount);
  const b = clamp((num & 0x0000ff) + amount);

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Determines if a color is dark based on luminance
 * @param hex - Hex color code (3 or 6 digits)
 * @returns True if dark, false if light
 */
export function isColorDark(hex: string): boolean {
  let color = hex.replace("#", "");
  if (color.length === 3) {
    color = color
      .split("")
      .map((c) => c + c)
      .join("");
  }

  const num = parseInt(color, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.6;
}

/** Hardcoded light palette — stable, hand-picked values */
const LIGHT_PALETTE = {
  "--background": "#fafbfc",
  "--foreground": "#000000",
  "--card": "#ffffff",
  "--card-foreground": "#000000",
  "--muted": "#f1f5f9",
  "--muted-foreground": "#4a5568",
  "--border": "#e2e8f0",
} as const;

/** Hardcoded dark palette — stable, hand-picked values */
const DARK_PALETTE = {
  "--background": "#222326",
  "--foreground": "#ffffff",
  "--card": "#2a2d31",
  "--card-foreground": "#ffffff",
  "--muted": "#33363b",
  "--muted-foreground": "#a0aec0",
  "--border": "#3d4147",
} as const;

const BASE_DARK = "#222326";
const BASE_PRIMARY = "primary";

/** Compute a dynamic palette from an arbitrary hex color */
function computeDynamicPalette(hex: string): Record<string, string> {
  const dark = isColorDark(hex);
  const foreground = dark ? "#ffffff" : "#000000";
  const card = dark ? adjustColor(hex, 18) : adjustColor(hex, -12);
  const muted = dark ? adjustColor(hex, 28) : adjustColor(hex, -25);
  const mutedForeground = dark ? "#a0aec0" : "#4a5568";
  const border = dark ? adjustColor(hex, 35) : adjustColor(hex, -35);

  return {
    "--background": hex,
    "--foreground": foreground,
    "--card": card,
    "--card-foreground": foreground,
    "--muted": muted,
    "--muted-foreground": mutedForeground,
    "--border": border,
  };
}

/**
 * Computes complete CSS variable object for org theming.
 * Base color: "primary" (use sidebar color), "#ffffff" (light), or "#222326" (dark).
 */
export function computeOrgThemeVariables(
  baseColor: string,
  sidebarColor: string,
  buttonColor: string,
): Record<string, string> {
  const basePalette =
    baseColor === BASE_PRIMARY ? computeDynamicPalette(sidebarColor)
    : baseColor === BASE_DARK ? DARK_PALETTE
    : LIGHT_PALETTE;

  // Sidebar: auto-derive foreground + muted variants from sidebar color darkness
  const sidebarDark = isColorDark(sidebarColor);
  const sidebarForeground = sidebarDark ? "#f8fafc" : "#1A1F36";
  const sidebarMuted = sidebarDark ? adjustColor(sidebarColor, 25) : adjustColor(sidebarColor, -20);
  const sidebarMutedForeground = sidebarDark ? "#94a3b8" : "#64748b";

  // Button: derive light/dark variants + foreground
  const buttonDark = isColorDark(buttonColor);
  const buttonLight = adjustColor(buttonColor, 20);
  const buttonDarkVariant = adjustColor(buttonColor, -20);
  const buttonForeground = buttonDark ? "#ffffff" : "#0f172a";

  // Map org-primary vars → sidebar color (30+ components reference these)
  const sidebarLight = adjustColor(sidebarColor, 20);
  const sidebarDarkVariant = adjustColor(sidebarColor, -20);
  const sidebarPrimaryForeground = sidebarDark ? "#ffffff" : "#0f172a";

  return {
    // Base palette (hardcoded, no computation)
    ...basePalette,

    // Sidebar (scoped vars — applied on sidebar element to override base vars)
    "--sidebar-bg": sidebarColor,
    "--sidebar-foreground": sidebarForeground,
    "--sidebar-muted": sidebarMuted,
    "--sidebar-muted-foreground": sidebarMutedForeground,

    // org-primary → maps to sidebar color (preserves existing component references)
    "--color-org-primary": sidebarColor,
    "--color-org-primary-light": sidebarLight,
    "--color-org-primary-dark": sidebarDarkVariant,
    "--color-org-primary-foreground": sidebarPrimaryForeground,

    // org-secondary → maps to button color
    "--color-org-secondary": buttonColor,
    "--color-org-secondary-light": buttonLight,
    "--color-org-secondary-dark": buttonDarkVariant,
    "--color-org-secondary-foreground": buttonForeground,

    // Ring & selection
    "--ring": sidebarColor,
    "--selection": buttonLight,
  };
}
