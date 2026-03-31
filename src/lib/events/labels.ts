import type { NavConfig } from "@/lib/navigation/nav-items";

const DEFAULT_EVENT_LABEL = "Events";

export function resolveEventLabel(
  navConfig: NavConfig | null | undefined,
  t?: (key: string) => string,
  locale?: string
) {
  const translatedLabel = t ? t("events") : DEFAULT_EVENT_LABEL;

  if (locale && locale !== "en" && translatedLabel) {
    return translatedLabel;
  }

  return navConfig?.["/events"]?.label || translatedLabel || DEFAULT_EVENT_LABEL;
}

export function resolveEventActionLabel(
  navConfig: NavConfig | null | undefined,
  prefix = "Add",
  t?: (key: string) => string,
  locale?: string
) {
  const singular = toSingular(resolveEventLabel(navConfig, t, locale));
  return prefix ? `${prefix} ${singular}` : singular;
}

function toSingular(word: string) {
  if (!word) return word;

  if (word.endsWith("ies")) {
    return word.slice(0, -3) + "y";
  }

  if (word.endsWith("sses") || word.endsWith("xes") || word.endsWith("zes")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("ches") || word.endsWith("shes")) {
    return word.slice(0, -2);
  }

  if (word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }

  return word;
}
