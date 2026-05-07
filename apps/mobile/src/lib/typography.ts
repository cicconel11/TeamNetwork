/**
 * Typography System
 * 8pt grid scale with proper hierarchy for mobile UI
 * Pairs DM Serif Display (display/headline) with Plus Jakarta Sans (everything else)
 */

import { TextStyle } from "react-native";

// Custom font family configuration
const serifDisplay = "DMSerifDisplay_400Regular";
const sansRegular = "PlusJakartaSans_400Regular";
const sansMedium = "PlusJakartaSans_500Medium";
const sansSemiBold = "PlusJakartaSans_600SemiBold";

// Type scale with line heights optimized for readability
export const TYPOGRAPHY = {
  // Display - Hero text, splash screens (serif display font)
  displayLarge: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700" as const,
    letterSpacing: -0.5,
    fontFamily: serifDisplay,
  },
  displayMedium: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "700" as const,
    letterSpacing: -0.25,
    fontFamily: serifDisplay,
  },

  // Headlines - Section headers, screen titles (serif display for large, sans for medium/small)
  headlineLarge: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily: serifDisplay,
  },
  headlineMedium: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily: sansSemiBold,
  },
  headlineSmall: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily: sansSemiBold,
  },

  // Titles - Card titles, list item headers (sans)
  titleLarge: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600" as const,
    letterSpacing: 0,
    fontFamily: sansSemiBold,
  },
  titleMedium: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500" as const,
    letterSpacing: 0.1,
    fontFamily: sansMedium,
  },
  titleSmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500" as const,
    letterSpacing: 0.1,
    fontFamily: sansMedium,
  },

  // Body - Main content text (sans regular)
  bodyLarge: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
    letterSpacing: 0.15,
    fontFamily: sansRegular,
  },
  bodyMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400" as const,
    letterSpacing: 0.25,
    fontFamily: sansRegular,
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400" as const,
    letterSpacing: 0.25,
    fontFamily: sansRegular,
  },

  // Labels - Buttons, form labels, chips (sans medium)
  labelLarge: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500" as const,
    letterSpacing: 0.1,
    fontFamily: sansMedium,
  },
  labelMedium: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500" as const,
    letterSpacing: 0.5,
    fontFamily: sansMedium,
  },
  labelSmall: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500" as const,
    letterSpacing: 0.5,
    fontFamily: sansMedium,
  },

  // Caption - Helper text, timestamps (sans regular)
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400" as const,
    letterSpacing: 0.4,
    fontFamily: sansRegular,
  },

  // Overline - Section labels, category tags (sans semibold)
  overline: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600" as const,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    fontFamily: sansSemiBold,
  },

  // Tab labels (sans medium)
  tabLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.2,
    fontFamily: sansMedium,
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
