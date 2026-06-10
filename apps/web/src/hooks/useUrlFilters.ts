"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  buildUrlFilterQuery,
  clearedUrlFilters,
  countActiveUrlFilters,
  readUrlFilters,
} from "@/lib/url-filters";

export interface UseUrlFiltersOptions<K extends string> {
  /**
   * Ordered list of query-param keys this filter UI owns. Order determines the
   * order params appear in the URL. Declare as a module-level
   * `const FILTER_KEYS = [...] as const;` so the key union is inferred.
   */
  keys: readonly K[];
  /** Delay before state is synced to the URL. Defaults to 300ms (the shared legacy behavior). */
  debounceMs?: number;
  /**
   * Called after every debounced URL sync EXCEPT the initial mount sync
   * (e.g. analytics tracking). May be an inline closure — identity changes
   * are absorbed via a ref and never re-trigger the sync effect.
   */
  onSync?: (filters: Record<K, string>) => void;
}

export interface UseUrlFiltersResult<K extends string> {
  /** Current filter values; `""` means "not filtered". */
  filters: Record<K, string>;
  /** Raw state setter (escape hatch). Prefer `setFilter`. */
  setFilters: Dispatch<SetStateAction<Record<K, string>>>;
  /** Set a single filter value. */
  setFilter: (key: K, value: string) => void;
  /** Reset every filter to `""` (URL syncs on the next debounce tick). */
  clearFilters: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
}

/**
 * URL-querystring-backed filter state.
 *
 * Owns the plumbing previously duplicated across the directory filter bars:
 * - initializes state from the current search params,
 * - debounces every change (selects included) before syncing,
 * - syncs via `router.push(pathname?query)` with empty values dropped and any
 *   param outside `keys` (e.g. pagination) reset,
 * - clears all filters.
 *
 * The debounced sync also runs once on mount (re-pushing the current URL),
 * matching the legacy components byte-for-byte; `onSync` is skipped for that
 * initial run.
 */
export function useUrlFilters<K extends string>({
  keys,
  debounceMs = 300,
  onSync,
}: UseUrlFiltersOptions<K>): UseUrlFiltersResult<K> {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Record<K, string>>(() =>
    readUrlFilters(keys, searchParams),
  );

  // Refs keep the sync effect's dependency list identical to the legacy
  // components (filters/pathname/router) even when callers pass inline
  // `keys` arrays or `onSync` closures.
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const didMountRef = useRef(false);

  useEffect(() => {
    const debounce = setTimeout(() => {
      const queryString = buildUrlFilterQuery(keysRef.current, filters);
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
      if (!didMountRef.current) {
        didMountRef.current = true;
        return;
      }
      onSyncRef.current?.(filters);
    }, debounceMs);
    return () => clearTimeout(debounce);
  }, [filters, pathname, router, debounceMs]);

  const setFilter = useCallback((key: K, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(clearedUrlFilters(keysRef.current));
  }, []);

  const activeFilterCount = countActiveUrlFilters(filters);

  return {
    filters,
    setFilters,
    setFilter,
    clearFilters,
    hasActiveFilters: activeFilterCount > 0,
    activeFilterCount,
  };
}
