import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";
import { useRequestTracker } from "@/hooks/useRequestTracker";

export type SearchEntityType =
  | "member"
  | "alumni"
  | "event"
  | "announcement"
  | "discussion_thread"
  | "job_posting";

const SUPPORTED_TYPES: ReadonlySet<SearchEntityType> = new Set([
  "member",
  "alumni",
  "event",
  "announcement",
  "discussion_thread",
  "job_posting",
]);

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  snippet: string | null;
  rank: number;
}

interface RpcRow {
  entity_type: string;
  entity_id: string;
  title: string | null;
  snippet: string | null;
  url_path: string | null;
  rank: number | null;
  metadata: Record<string, unknown> | null;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface UseGlobalSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResult[];
  loading: boolean;
}

export function useGlobalSearch(
  orgId: string | null,
  orgSlug: string | null,
): UseGlobalSearchReturn {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const isMountedRef = useRef(true);
  const { beginRequest, isCurrentRequest } = useRequestTracker();

  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const search = useCallback(
    async (q: string) => {
      const callId = beginRequest();
      const trimmed = q.trim();

      if (!orgId || !orgSlug || trimmed.length < 2) {
        if (isMountedRef.current) {
          setResults([]);
          setLoading(false);
        }
        return;
      }

      if (isMountedRef.current) {
        setLoading(true);
      }

      try {
        const { data, error } = await supabase.rpc("search_org_content", {
          p_org_id: orgId,
          p_org_slug: orgSlug,
          p_query: trimmed,
          p_limit: 20,
        });

        if (!isMountedRef.current || !isCurrentRequest(callId)) return;
        if (error) throw error;

        const rows = (data ?? []) as RpcRow[];
        const mapped: SearchResult[] = rows
          .filter(
            (row): row is RpcRow & { entity_type: SearchEntityType } =>
              SUPPORTED_TYPES.has(row.entity_type as SearchEntityType),
          )
          .map((row) => ({
            id: row.entity_id,
            type: row.entity_type,
            title: row.title ?? "Untitled",
            snippet: row.snippet,
            rank: row.rank ?? 0,
          }));

        setResults(mapped);
      } catch (e) {
        if (isMountedRef.current && isCurrentRequest(callId)) {
          setResults([]);
          sentry.captureException(e as Error, {
            context: "useGlobalSearch",
            orgId,
            query: q,
          });
        }
      } finally {
        if (isMountedRef.current && isCurrentRequest(callId)) {
          setLoading(false);
        }
      }
    },
    [orgId, orgSlug, beginRequest, isCurrentRequest],
  );

  useEffect(() => {
    search(debouncedQuery);
  }, [debouncedQuery, search]);

  return { query, setQuery, results, loading };
}
