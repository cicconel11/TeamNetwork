/** Shared i18n constants — safe to import from middleware, server components, and client code. */

export const SUPPORTED_LOCALES = ["en", "es", "fr", "ar", "zh", "pt", "it"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";
export const RTL_LOCALES: SupportedLocale[] = ["ar"];

/** Language display names in native script (for language picker UI). */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  ar: "العربية",
  zh: "中文",
  pt: "Português",
  it: "Italiano",
};
