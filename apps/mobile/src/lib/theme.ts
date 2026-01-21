/**
 * Design tokens and UI primitives for mobile app
 * Phase 1: Core loop screens only
 */

export type ThemeColors = {
  primary: string;
  primaryLight: string;
  primaryDark: string;
  primaryForeground: string;
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;
  secondaryForeground: string;
  background: string;
  card: string;
  foreground: string;
  muted: string;
  mutedSurface: string;
  mutedForeground: string;
  border: string;
  success: string;
  warning: string;
  error: string;
};

const DEFAULT_PRIMARY = "#1e3a5f";
const DEFAULT_SECONDARY = "#10b981";

function isValidHexColor(value: string | null | undefined) {
  return !!value && /^#[0-9a-fA-F]{6}$/.test(value);
}

function adjustColor(hex: string, amount: number): string {
  const clamp = (num: number) => Math.min(255, Math.max(0, num));
  let color = hex.replace("#", "");

  if (color.length === 3) {
    color = color.split("").map((c) => c + c).join("");
  }

  const num = parseInt(color, 16);
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0x00ff) + amount);
  const b = clamp((num & 0x0000ff) + amount);

  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function isColorDark(hex: string): boolean {
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
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.6;
}

export function buildOrgTheme(
  primaryColor?: string | null,
  secondaryColor?: string | null
): ThemeColors {
  const primary = isValidHexColor(primaryColor) ? primaryColor! : DEFAULT_PRIMARY;
  const secondary = isValidHexColor(secondaryColor) ? secondaryColor! : DEFAULT_SECONDARY;
  const primaryLight = adjustColor(primary, 20);
  const primaryDark = adjustColor(primary, -20);
  const secondaryLight = adjustColor(secondary, 20);
  const secondaryDark = adjustColor(secondary, -20);
  const isPrimaryDark = isColorDark(primary);
  const isSecondaryDark = isColorDark(secondary);
  const primaryForeground = isPrimaryDark ? "#f8fafc" : "#0f172a";
  const secondaryForeground = isSecondaryDark ? "#ffffff" : "#0f172a";
  const background = isPrimaryDark ? adjustColor(primary, 8) : adjustColor(primary, 52);
  const cardColor = isPrimaryDark ? adjustColor(primary, 16) : adjustColor(primary, 64);
  const isBackgroundDark = isColorDark(background);
  const baseForeground = isBackgroundDark ? "#f8fafc" : "#0f172a";
  const mutedSurface = isPrimaryDark ? adjustColor(primary, 36) : adjustColor(primary, -32);
  const muted = adjustColor(baseForeground, isBackgroundDark ? -52 : 56);
  const mutedForeground = adjustColor(baseForeground, isBackgroundDark ? -72 : 76);
  const borderColor = isPrimaryDark ? adjustColor(primary, 24) : adjustColor(primary, -22);

  return {
    primary,
    primaryLight,
    primaryDark,
    primaryForeground,
    secondary,
    secondaryLight,
    secondaryDark,
    secondaryForeground,
    background,
    card: cardColor,
    foreground: baseForeground,
    muted,
    mutedSurface,
    mutedForeground,
    border: borderColor,
    success: "#10b981",
    warning: "#f59e0b",
    error: "#dc2626",
  };
}

export const defaultThemeColors = buildOrgTheme(DEFAULT_PRIMARY, DEFAULT_SECONDARY);

export const colors = defaultThemeColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const borderRadius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
};

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
};

export const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

/**
 * UI Primitives
 * Pre-defined styles for common components
 */

export const primitives = {
  button: {
    primary: {
      backgroundColor: colors.primary,
      color: colors.primaryForeground,
      borderRadius: borderRadius.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    secondary: {
      backgroundColor: colors.border,
      color: colors.foreground,
      borderRadius: borderRadius.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
    },
    ghost: {
      backgroundColor: "transparent",
      color: colors.foreground,
      borderRadius: borderRadius.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
    },
    danger: {
      backgroundColor: colors.error,
      color: "#ffffff",
      borderRadius: borderRadius.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
  },
  card: {
    default: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: borderRadius.lg,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
      padding: spacing.md,
    },
    interactive: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: borderRadius.lg,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
      padding: spacing.md,
    },
  },
  text: {
    heading: {
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
      lineHeight: 28,
    },
    body: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.normal,
      color: colors.foreground,
      lineHeight: 24,
    },
    caption: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.normal,
      color: colors.muted,
      lineHeight: 20,
    },
    label: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      lineHeight: 16,
    },
  },
  input: {
    default: {
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      color: colors.foreground,
      borderWidth: 1,
    },
    error: {
      backgroundColor: colors.card,
      borderColor: colors.error,
      borderRadius: borderRadius.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      fontSize: fontSize.base,
      color: colors.foreground,
      borderWidth: 1,
    },
  },
  badge: {
    default: {
      backgroundColor: colors.border,
      color: colors.foreground,
      borderRadius: borderRadius.sm,
      paddingVertical: 4,
      paddingHorizontal: 8,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    success: {
      backgroundColor: "#d1fae5",
      color: colors.success,
      borderRadius: borderRadius.sm,
      paddingVertical: 4,
      paddingHorizontal: 8,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    warning: {
      backgroundColor: "#fef3c7",
      color: colors.warning,
      borderRadius: borderRadius.sm,
      paddingVertical: 4,
      paddingHorizontal: 8,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    error: {
      backgroundColor: "#fee2e2",
      color: colors.error,
      borderRadius: borderRadius.sm,
      paddingVertical: 4,
      paddingHorizontal: 8,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
  },
};
