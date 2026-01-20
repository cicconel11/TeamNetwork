/**
 * Design tokens and UI primitives for mobile app
 * Phase 1: Core loop screens only
 */

export const colors = {
  primary: "#2563eb",
  primaryLight: "#3b82f6",
  
  background: "#f5f5f5",
  card: "#ffffff",
  foreground: "#1a1a1a",
  muted: "#666666",
  mutedForeground: "#9ca3af",
  border: "#e5e7eb",
  
  success: "#10b981",
  warning: "#f59e0b",
  error: "#dc2626",
};

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
      color: "#ffffff",
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
