import type { NeutralColors, SemanticColors } from "@/lib/design-tokens";

export interface SettingsColors {
  background: string;
  foreground: string;
  primaryText: string;
  secondaryText: string;
  mutedText: string;
  muted: string;
  mutedForeground: string;
  border: string;
  card: string;
  primary: string;
  primaryForeground: string;
  primaryLight: string;
  secondary: string;
  error: string;
  success: string;
  warning: string;
}

export function buildSettingsColors(
  neutral: NeutralColors,
  semantic: SemanticColors
): SettingsColors {
  return {
    background: neutral.background,
    foreground: neutral.foreground,
    primaryText: neutral.foreground,
    secondaryText: neutral.secondary,
    mutedText: neutral.placeholder,
    muted: neutral.muted,
    mutedForeground: neutral.placeholder,
    border: neutral.border,
    card: neutral.surface,
    primary: semantic.success,
    primaryForeground: "#ffffff",
    primaryLight: semantic.successLight,
    secondary: neutral.divider,
    error: semantic.error,
    success: semantic.success,
    warning: semantic.warning,
  };
}
