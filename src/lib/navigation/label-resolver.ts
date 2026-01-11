import { ORG_NAV_ITEMS, type NavConfig } from "./nav-items";

/**
 * Resolves the label for a navigation item, using custom label from navConfig
 * if available, otherwise falling back to the default label.
 *
 * @param href - The href path of the navigation item (e.g., "/workouts", "/members")
 * @param navConfig - The organization's navigation configuration
 * @returns The resolved label string
 */
export function resolveLabel(
    href: string,
    navConfig: NavConfig | null | undefined
): string {
    const defaultItem = ORG_NAV_ITEMS.find((item) => item.href === href);
    const defaultLabel = defaultItem?.label ?? "";

    if (!navConfig || !navConfig[href]?.label) {
        return defaultLabel;
    }

    return navConfig[href].label || defaultLabel;
}

/**
 * Resolves an action label (e.g., "Add Workout") using the navigation label,
 * converting plural labels to singular form.
 *
 * @param href - The href path of the navigation item
 * @param navConfig - The organization's navigation configuration
 * @param prefix - The action prefix (default: "Add")
 * @returns The resolved action label string (e.g., "Add Workout")
 */
export function resolveActionLabel(
    href: string,
    navConfig: NavConfig | null | undefined,
    prefix: string = "Add"
): string {
    const label = resolveLabel(href, navConfig);

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
    if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes")) {
        return word.slice(0, -2);
    }
    if (word.endsWith("ches") || word.endsWith("shes")) {
        return word.slice(0, -2);
    }

    // Handle regular "s" plural
    if (word.endsWith("s") && !word.endsWith("ss")) {
        return word.slice(0, -1);
    }

    return word;
}
