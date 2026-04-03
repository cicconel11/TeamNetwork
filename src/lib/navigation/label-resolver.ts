import { ORG_NAV_ITEMS, type NavConfig } from "./nav-items";

/**
 * Resolves the label for a navigation item, using custom label from navConfig
 * if available, otherwise falling back to the default label.
 *
 * When a translate function `t` is provided (from next-intl), non-English
 * locales prefer the i18n translation over custom admin labels (which are
 * typically set in English).
 *
 * @param href - The href path of the navigation item (e.g., "/workouts", "/members")
 * @param navConfig - The organization's navigation configuration
 * @param t - Optional translate function from getTranslations("nav.items") or useTranslations("nav")
 * @param locale - Current locale string (e.g., "en", "es"). Required when t is provided.
 */
export function resolveLabel(
    href: string,
    navConfig: NavConfig | null | undefined,
    t?: (key: string) => string,
    locale?: string,
): string {
    const defaultItem = ORG_NAV_ITEMS.find((item) => item.href === href);

    // When a translate function is available, use it for the default label
    const translatedLabel = t && defaultItem?.i18nKey ? t(defaultItem.i18nKey) : "";
    const fallbackLabel = translatedLabel || defaultItem?.label || "";

    // For non-English locales, prefer the i18n translation over custom labels
    if (locale && locale !== "en" && translatedLabel) {
        return translatedLabel;
    }

    // For English (or no locale specified), custom admin label wins
    if (navConfig?.[href]?.label) {
        return navConfig[href].label || fallbackLabel;
    }

    return fallbackLabel;
}

/**
 * Resolves an action label (e.g., "Add Workout") using the navigation label,
 * converting plural labels to singular form.
 *
 * @param href - The href path of the navigation item
 * @param navConfig - The organization's navigation configuration
 * @param prefix - The action prefix (default: "Add")
 * @param t - Optional translate function
 * @param locale - Current locale string
 */
export function resolveActionLabel(
    href: string,
    navConfig: NavConfig | null | undefined,
    prefix: string = "Add",
    t?: (key: string) => string,
    locale?: string,
): string {
    const label = resolveLabel(href, navConfig, t, locale);

    if (!label) {
        return prefix;
    }

    // Convert plural to singular for action buttons
    // Handle common English plural patterns
    const singular = toSingular(label);
    return `${prefix} ${singular}`;
}

/**
 * Converts a plural word to its singular form.
 * Handles common English plural patterns.
 */
function toSingular(word: string): string {
    if (!word) return word;

    // Handle words ending in "ies" (e.g., "Activities" -> "Activity")
    if (word.endsWith("ies")) {
        return word.slice(0, -3) + "y";
    }

    // Handle words ending in "es" for words ending in s, x, z, ch, sh
    // But NOT words like "expenses" where the base word ends in "se"
    if (word.endsWith("sses") || word.endsWith("xes") || word.endsWith("zes")) {
        return word.slice(0, -2);
    }
    if (word.endsWith("ches") || word.endsWith("shes")) {
        return word.slice(0, -2);
    }

    // Handle regular "s" plural (including "expenses" -> "expense")
    if (word.endsWith("s") && !word.endsWith("ss")) {
        return word.slice(0, -1);
    }

    return word;
}
