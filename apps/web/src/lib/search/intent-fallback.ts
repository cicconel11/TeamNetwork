import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRepeatedTitle } from "./normalize-title";

export type IntentEntityType =
  | "member"
  | "alumni"
  | "announcement"
  | "discussion_thread"
  | "event"
  | "job_posting";

export type FastSearchRow = {
  entity_type: string;
  entity_id: string;
  title: string | null;
  snippet: string | null;
  url_path: string | null;
  rank: number | null;
  metadata: Record<string, unknown> | null;
};

const INTENT_MAP: Record<string, IntentEntityType> = {
  job: "job_posting",
  jobs: "job_posting",
  posting: "job_posting",
  postings: "job_posting",
  event: "event",
  events: "event",
  member: "member",
  members: "member",
  alumni: "alumni",
  alum: "alumni",
  alums: "alumni",
  announcement: "announcement",
  announcements: "announcement",
  discussion: "discussion_thread",
  discussions: "discussion_thread",
  thread: "discussion_thread",
  threads: "discussion_thread",
};

/** Returns intent entity type if the query is a single reserved word, else null. */
export function detectIntent(query: string): IntentEntityType | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if (/\s/.test(q)) return null;
  return INTENT_MAP[q] ?? null;
}

/**
 * Fetch up to `limit` visible rows of the intended entity type for an org.
 * Relies on RLS (user-scoped supabase client) for visibility.
 */
export async function fetchIntentFallbackRows(params: {
  supabase: SupabaseClient;
  orgId: string;
  orgSlug: string;
  entityType: IntentEntityType;
  limit: number;
}): Promise<FastSearchRow[]> {
  const { supabase, orgId, orgSlug, entityType, limit } = params;

  switch (entityType) {
    case "job_posting": {
      const { data } = await supabase
        .from("job_postings")
        .select("id, title, company, created_at, is_active, expires_at")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? [])
        .filter((r) => !r.expires_at || new Date(r.expires_at) > new Date())
        .map((r) => ({
          entity_type: "job_posting",
          entity_id: r.id,
          title: normalizeRepeatedTitle(r.title) || "Job",
          snippet: normalizeRepeatedTitle(r.company) || null,
          url_path: `/${orgSlug}/jobs/${r.id}`,
          rank: 0.4,
          metadata: null,
        }));
    }
    case "event": {
      const { data } = await supabase
        .from("events")
        .select("id, title, description, start_date")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("start_date", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r) => ({
        entity_type: "event",
        entity_id: r.id,
        title: normalizeRepeatedTitle(r.title) || "Event",
        snippet:
          (r.description ?? "").replace(/\s+/g, " ").slice(0, 140) || null,
        url_path: `/${orgSlug}/calendar/events/${r.id}`,
        rank: 0.4,
        metadata: null,
      }));
    }
    case "member": {
      const { data } = await supabase
        .from("members")
        .select("id, first_name, last_name, email")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r) => ({
        entity_type: "member",
        entity_id: r.id,
        title:
          normalizeRepeatedTitle(
            `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
          ) || "Member",
        snippet: r.email ?? null,
        url_path: `/${orgSlug}/members/${r.id}`,
        rank: 0.4,
        metadata: null,
      }));
    }
    case "alumni": {
      const { data } = await supabase
        .from("alumni")
        .select("id, first_name, last_name, current_company, headline")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r) => ({
        entity_type: "alumni",
        entity_id: r.id,
        title:
          normalizeRepeatedTitle(
            `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
          ) || "Alumni",
        snippet:
          normalizeRepeatedTitle(
            `${r.current_company ?? ""} ${r.headline ?? ""}`.trim(),
          ) || null,
        url_path: `/${orgSlug}/alumni/${r.id}`,
        rank: 0.4,
        metadata: null,
      }));
    }
    case "announcement": {
      const { data } = await supabase
        .from("announcements")
        .select("id, title, body, created_at")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r) => ({
        entity_type: "announcement",
        entity_id: r.id,
        title: normalizeRepeatedTitle(r.title) || "Announcement",
        snippet: (r.body ?? "").replace(/\s+/g, " ").slice(0, 140) || null,
        url_path: `/${orgSlug}/announcements`,
        rank: 0.4,
        metadata: { announcement_id: r.id },
      }));
    }
    case "discussion_thread": {
      const { data } = await supabase
        .from("discussion_threads")
        .select("id, title, body, created_at")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r) => ({
        entity_type: "discussion_thread",
        entity_id: r.id,
        title: normalizeRepeatedTitle(r.title) || "Discussion",
        snippet: (r.body ?? "").replace(/\s+/g, " ").slice(0, 140) || null,
        url_path: `/${orgSlug}/messages/threads/${r.id}`,
        rank: 0.4,
        metadata: null,
      }));
    }
  }
}
