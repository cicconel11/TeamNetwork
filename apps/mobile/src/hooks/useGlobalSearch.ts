import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";

export interface SearchResult {
  id: string;
  type: "member" | "event" | "announcement";
  title: string;
  subtitle: string;
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

export function useGlobalSearch(orgId: string | null): UseGlobalSearchReturn {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const isMountedRef = useRef(true);

  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const search = useCallback(
    async (q: string) => {
      if (!orgId || q.length < 2) {
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
        const [membersRes, eventsRes, announcementsRes] = await Promise.all([
          supabase
            .from("user_organization_roles")
            .select("id, user:users(id, name, email)")
            .eq("organization_id", orgId)
            .eq("status", "active")
            .ilike("users.name", `%${q}%`)
            .limit(5),

          supabase
            .from("events")
            .select("id, title, start_date")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .ilike("title", `%${q}%`)
            .limit(5),

          supabase
            .from("announcements")
            .select("id, title, created_at")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .ilike("title", `%${q}%`)
            .limit(5),
        ]);

        if (!isMountedRef.current) return;

        if (membersRes.error) throw membersRes.error;
        if (eventsRes.error) throw eventsRes.error;
        if (announcementsRes.error) throw announcementsRes.error;

        const memberResults: SearchResult[] = (membersRes.data ?? [])
          .filter((row) => {
            const user = row.user as { id: string; name: string | null; email: string } | null;
            return user !== null;
          })
          .map((row) => {
            const user = row.user as { id: string; name: string | null; email: string };
            return {
              id: row.id,
              type: "member" as const,
              title: user.name ?? user.email,
              subtitle: user.email,
            };
          });

        const eventResults: SearchResult[] = (eventsRes.data ?? []).map((event) => ({
          id: event.id,
          type: "event" as const,
          title: event.title,
          subtitle: new Date(event.start_date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        }));

        const announcementResults: SearchResult[] = (announcementsRes.data ?? []).map((a) => ({
          id: a.id,
          type: "announcement" as const,
          title: a.title,
          subtitle: a.created_at
            ? new Date(a.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "",
        }));

        if (isMountedRef.current) {
          setResults([...memberResults, ...eventResults, ...announcementResults]);
        }
      } catch (e) {
        if (isMountedRef.current) {
          setResults([]);
          sentry.captureException(e as Error, {
            context: "useGlobalSearch",
            orgId,
            query: q,
          });
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [orgId]
  );

  useEffect(() => {
    search(debouncedQuery);
  }, [debouncedQuery, search]);

  return { query, setQuery, results, loading };
}
