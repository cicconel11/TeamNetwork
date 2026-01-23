/**
 * Typography System
 * 8pt grid scale with proper hierarchy for mobile UI
 */

import { TextStyle, Platform } from "react-native";

// Font family configuration
const fontFamily = Platform.select({
  ios: "System",
  android: "Roboto",
  default: "System",
});

// Type scale with line heights optimized for readability
export const TYPOGRAPHY = {
  // Display - Hero text, splash screens
  displayLarge: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700" as const,
    letterSpacing: -0.5,
    fontFamily,
  },
  displayMedium: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "700" as const,
    letterSpacing: -0.25,
    fontFamily,
  },

  // Headlines - Section headers, screen titles
  headlineLarge: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily,
  },
  headlineMedium: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily,
  },
  headlineSmall: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily,
  },

  // Titles - Card titles, list item headers
  titleLarge: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily,
  },
  titleMedium: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500" as const,
    letterSpacing: 0.1,
    fontFamily,
  },
  titleSmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500" as const,
    letterSpacing: 0.1,
    fontFamily,
  },

  // Body - Main content text
  bodyLarge: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
    letterSpacing: 0.15,
    fontFamily,
  },
  bodyMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400" as const,
    letterSpacing: 0.25,
    fontFamily,
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400" as const,
    letterSpacing: 0.25,
    fontFamily,
  },

  // Labels - Buttons, form labels, chips
  labelLarge: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500" as const,
    letterSpacing: 0.1,
    fontFamily,
  },
  labelMedium: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500" as const,
    letterSpacing: 0.5,
    fontFamily,
  },
  labelSmall: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500" as const,
    letterSpacing: 0.5,
    fontFamily,
  },

  // Caption - Helper text, timestamps
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400" as const,
    letterSpacing: 0.4,
    fontFamily,
  },

  // Overline - Section labels, category tags
  overline: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600" as const,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    fontFamily,
  },

  // Tab labels
  tabLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.2,
    fontFamily,
  },
} as const;

// Helper to create text style with color
export function createTextStyle(
  variant: keyof typeof TYPOGRAPHY,
  color: string
): TextStyle {
  return {
    ...TYPOGRAPHY[variant],
    color,
  };
}

// Common text style combinations
export const TEXT_STYLES = {
  // Headers
  screenTitle: TYPOGRAPHY.headlineMedium,
  sectionTitle: TYPOGRAPHY.titleLarge,
  cardTitle: TYPOGRAPHY.titleMedium,

  // Body content
  paragraph: TYPOGRAPHY.bodyLarge,
  description: TYPOGRAPHY.bodyMedium,
  detail: TYPOGRAPHY.bodySmall,

  // UI elements
  buttonLarge: TYPOGRAPHY.labelLarge,
  buttonMedium: TYPOGRAPHY.labelMedium,
  chip: TYPOGRAPHY.labelSmall,
  badge: TYPOGRAPHY.labelSmall,

  // Metadata
  timestamp: TYPOGRAPHY.caption,
  helper: TYPOGRAPHY.caption,
  label: TYPOGRAPHY.overline,
} as const;

export type TypographyVariant = keyof typeof TYPOGRAPHY;
export type TextStyleVariant = keyof typeof TEXT_STYLES;
