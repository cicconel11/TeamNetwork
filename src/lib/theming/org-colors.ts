/**
 * Organization color theming utilities
 * Provides centralized color manipulation and CSS variable generation for org branding
 */

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

/**
 * Derives dark mode variants of org colors
 * Adjusts brightness to ensure proper contrast in dark mode
 */
export function deriveOrgDarkModeColors(
  primaryColor: string,
  secondaryColor: string
): {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;
  secondaryForeground: string;
} {
  const isPrimaryDark = isColorDark(primaryColor);
  const isSecondaryDark = isColorDark(secondaryColor);

  // In dark mode, brighten dark colors and darken light colors for proper contrast
  const primary = isPrimaryDark ? adjustColor(primaryColor, 15) : adjustColor(primaryColor, -30);
  const secondary = isSecondaryDark
    ? adjustColor(secondaryColor, 15)
    : adjustColor(secondaryColor, -30);

  return {
    primary,
    primaryLight: adjustColor(primary, 20),
    primaryDark: adjustColor(primary, -20),
    secondary,
    secondaryLight: adjustColor(secondary, 20),
    secondaryDark: adjustColor(secondary, -20),
    secondaryForeground: isColorDark(secondary) ? "#ffffff" : "#0f172a",
  };
}

/**
 * Computes complete CSS variable object for org theming
 * Supports both light and dark modes
 */
export function computeOrgThemeVariables(
  primaryColor: string,
  secondaryColor: string,
  isDarkMode: boolean
): Record<string, string> {
  if (isDarkMode) {
    const darkColors = deriveOrgDarkModeColors(primaryColor, secondaryColor);
    const cardColor = adjustColor(darkColors.primary, 18);
    const muted = adjustColor(darkColors.primary, 28);
    const borderColor = adjustColor(darkColors.primary, 35);

    return {
      "--color-org-primary": darkColors.primary,
      "--color-org-primary-light": darkColors.primaryLight,
      "--color-org-primary-dark": darkColors.primaryDark,
      "--color-org-secondary": darkColors.secondary,
      "--color-org-secondary-light": darkColors.secondaryLight,
      "--color-org-secondary-dark": darkColors.secondaryDark,
      "--color-org-secondary-foreground": darkColors.secondaryForeground,
      "--background": darkColors.primary,
      "--foreground": "#f8fafc",
      "--card": cardColor,
      "--card-foreground": "#f8fafc",
      "--muted": muted,
      "--muted-foreground": "#e2e8f0",
      "--border": borderColor,
      "--ring": darkColors.secondary,
    };
  }

  // Light mode
  const primaryLight = adjustColor(primaryColor, 20);
  const primaryDark = adjustColor(primaryColor, -20);
  const secondaryLight = adjustColor(secondaryColor, 20);
  const secondaryDark = adjustColor(secondaryColor, -20);
  const isPrimaryDark = isColorDark(primaryColor);
  const isSecondaryDark = isColorDark(secondaryColor);
  const baseForeground = isPrimaryDark ? "#f8fafc" : "#0f172a";
  const secondaryForeground = isSecondaryDark ? "#ffffff" : "#0f172a";
  const cardColor = isPrimaryDark ? adjustColor(primaryColor, 18) : adjustColor(primaryColor, -12);
  const cardForeground = isColorDark(cardColor) ? "#f8fafc" : "#0f172a";
  const muted = isPrimaryDark ? adjustColor(primaryColor, 28) : adjustColor(primaryColor, -35);
  const mutedForeground = isColorDark(muted) ? "#e2e8f0" : "#475569";
  const borderColor = isPrimaryDark
    ? adjustColor(primaryColor, 35)
    : adjustColor(primaryColor, -45);

  return {
    "--color-org-primary": primaryColor,
    "--color-org-primary-light": primaryLight,
    "--color-org-primary-dark": primaryDark,
    "--color-org-secondary": secondaryColor,
    "--color-org-secondary-light": secondaryLight,
    "--color-org-secondary-dark": secondaryDark,
    "--color-org-secondary-foreground": secondaryForeground,
    "--background": primaryColor,
    "--foreground": baseForeground,
    "--card": cardColor,
    "--card-foreground": cardForeground,
    "--muted": muted,
    "--muted-foreground": mutedForeground,
    "--border": borderColor,
    "--ring": secondaryColor,
  };
}
