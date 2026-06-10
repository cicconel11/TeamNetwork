/**
 * Pure helpers for URL-querystring-backed filter state.
 *
 * Shared by `useUrlFilters` (src/hooks/useUrlFilters.ts) and unit-tested
 * directly (tests/url-filters.test.ts). Keep this module free of React /
 * Next.js imports so it stays importable under `node --test`.
 */

/** Minimal read interface satisfied by both `URLSearchParams` and Next.js `ReadonlyURLSearchParams`. */
export interface ReadableSearchParams {
  get(name: string): string | null;
}

/**
 * Read the current value for each filter key from the URL's search params.
 * Missing params become `""` (the "no filter" sentinel used by every filter UI).
 */
export function readUrlFilters<K extends string>(
  keys: readonly K[],
  searchParams: ReadableSearchParams,
): Record<K, string> {
  const filters = {} as Record<K, string>;
  for (const key of keys) {
    filters[key] = searchParams.get(key) || "";
  }
  return filters;
}

/**
 * Build the query string for the current filter values.
 *
 * - Params are emitted in `keys` order (stable, matches the legacy per-component builders).
 * - Empty values are dropped entirely.
 * - Any param NOT in `keys` (e.g. pagination) is intentionally absent — changing
 *   a filter resets everything else, exactly like the previous inline builders.
 *
 * Returns `""` when no filters are active.
 */
export function buildUrlFilterQuery<K extends string>(
  keys: readonly K[],
  filters: Record<K, string>,
): string {
  const params = new URLSearchParams();
  for (const key of keys) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return params.toString();
}

/** Record with every filter key reset to `""`. */
export function clearedUrlFilters<K extends string>(
  keys: readonly K[],
): Record<K, string> {
  const filters = {} as Record<K, string>;
  for (const key of keys) {
    filters[key] = "";
  }
  return filters;
}

/** Number of filters currently holding a non-empty value. */
export function countActiveUrlFilters(filters: Record<string, string>): number {
  return Object.values(filters).filter((value) => value !== "").length;
}
