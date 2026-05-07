import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "./config";
import type { SupportedLocale } from "./config";
import enMessages from "../../messages/en.json";

// Re-export for convenience (server components can import from here)
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, RTL_LOCALES } from "./config";
export type { SupportedLocale } from "./config";

/** Recursively merge two objects so nested keys fall back to English. */
function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof base[key] === "object" && base[key] !== null && !Array.isArray(base[key]) &&
      typeof override[key] === "object" && override[key] !== null && !Array.isArray(override[key])
    ) {
      result[key] = deepMerge(base[key] as Record<string, unknown>, override[key] as Record<string, unknown>);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get("NEXT_LOCALE")?.value;
  const locale = SUPPORTED_LOCALES.includes(raw as SupportedLocale)
    ? (raw as SupportedLocale)
    : DEFAULT_LOCALE;

  // Deep-merge English as fallback so missing nested keys show English text
  const localeMessages = locale === "en"
    ? enMessages
    : deepMerge(enMessages as Record<string, unknown>, (await import(`../../messages/${locale}.json`)).default);

  return {
    locale,
    messages: localeMessages,
    onError(error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[i18n]", error.message);
      }
    },
    getMessageFallback({ namespace, key }) {
      return `${namespace}.${key}`;
    },
  };
});
