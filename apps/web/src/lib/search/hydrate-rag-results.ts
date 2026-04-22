import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetrievedChunk } from "@/lib/ai/rag-retriever";
import { calendarEventDetailPath } from "@/lib/calendar/routes";

export type HydratedSearchHit = {
  id: string;
  sourceTable: string;
  sourceId: string;
  title: string;
  snippet: string;
  url: string;
  similarity: number;
  metadata: Record<string, unknown>;
};

type ThreadAgg = {
  similarity: number;
  threadSnippet: string;
  replySnippets: string[];
  metadata: Record<string, unknown>;
};

type WorkingHit = {
  sourceTable: string;
  sourceId: string;
  similarity: number;
  contentText: string;
  metadata: Record<string, unknown>;
  replySnippets: string[];
};

/**
 * Dedupe RAG chunks, collapse reply matches into parent threads, skip announcements (no detail URL in v1),
 * batch-hydrate titles, and produce canonical org URLs.
 */
export async function hydrateRagSearchResults(params: {
  chunks: RetrievedChunk[];
  orgSlug: string;
  orgId: string;
  /**
   * User-scoped client used for title hydration so RLS filters out
   * records the caller cannot see (private events, audience-restricted
   * threads, inactive jobs). Must NOT be a service-role client.
   */
  userSupabase: SupabaseClient;
}): Promise<HydratedSearchHit[]> {
  const { chunks, orgSlug, orgId, userSupabase } = params;
  if (chunks.length === 0) return [];

  const deduped = new Map<string, RetrievedChunk>();
  for (const c of chunks) {
    if (c.sourceTable === "announcements") continue;
    const key = `${c.sourceTable}:${c.sourceId}`;
    const prev = deduped.get(key);
    if (!prev || c.similarity > prev.similarity) deduped.set(key, c);
  }

  const threadAggs = new Map<string, ThreadAgg>();
  const others: WorkingHit[] = [];

  for (const c of deduped.values()) {
    if (c.sourceTable === "discussion_replies") {
      const threadId = String(c.metadata?.parent_thread_id ?? "");
      if (!threadId) continue;
      const prev = threadAggs.get(threadId);
      const replySnippet = (c.contentText || "").slice(0, 200);
      if (!prev) {
        threadAggs.set(threadId, {
          similarity: c.similarity,
          threadSnippet: "",
          replySnippets: [replySnippet],
          metadata: { ...c.metadata, _replyMatch: true },
        });
      } else {
        prev.replySnippets.push(replySnippet);
        if (c.similarity > prev.similarity) prev.similarity = c.similarity;
      }
      continue;
    }
    if (c.sourceTable === "discussion_threads") {
      const prev = threadAggs.get(c.sourceId);
      const snippet = (c.contentText || "").slice(0, 200);
      if (!prev) {
        threadAggs.set(c.sourceId, {
          similarity: c.similarity,
          threadSnippet: snippet,
          replySnippets: [],
          metadata: c.metadata || {},
        });
      } else {
        if (!prev.threadSnippet) prev.threadSnippet = snippet;
        if (c.similarity > prev.similarity) prev.similarity = c.similarity;
      }
      continue;
    }
    others.push({
      sourceTable: c.sourceTable,
      sourceId: c.sourceId,
      similarity: c.similarity,
      contentText: c.contentText || "",
      metadata: c.metadata || {},
      replySnippets: [],
    });
  }

  const threadHits: WorkingHit[] = [...threadAggs.entries()].map(([threadId, agg]) => ({
    sourceTable: "discussion_threads",
    sourceId: threadId,
    similarity: agg.similarity,
    contentText: agg.threadSnippet,
    metadata: agg.metadata,
    replySnippets: agg.replySnippets,
  }));

  const combined = [...others, ...threadHits].sort((a, b) => b.similarity - a.similarity);

  const threadIds = combined.filter((x) => x.sourceTable === "discussion_threads").map((x) => x.sourceId);
  const eventIds = combined.filter((x) => x.sourceTable === "events").map((x) => x.sourceId);
  const jobIds = combined.filter((x) => x.sourceTable === "job_postings").map((x) => x.sourceId);

  // Use the user-scoped client so RLS filters out records the caller
  // cannot see. `.is("deleted_at", null)` and `.eq("is_active", true)`
  // enforce visibility in addition to RLS policies.
  const [threads, events, jobs] = await Promise.all([
    threadIds.length
      ? userSupabase
          .from("discussion_threads")
          .select("id, title")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("id", threadIds)
      : Promise.resolve({ data: [] as { id: string; title: string | null }[] }),
    eventIds.length
      ? userSupabase
          .from("events")
          .select("id, title")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .in("id", eventIds)
      : Promise.resolve({ data: [] as { id: string; title: string | null }[] }),
    jobIds.length
      ? userSupabase
          .from("job_postings")
          .select("id, title")
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .eq("is_active", true)
          .in("id", jobIds)
      : Promise.resolve({ data: [] as { id: string; title: string | null }[] }),
  ]);

  const titleMap = (rows: { id: string; title: string | null }[] | null | undefined) => {
    const m = new Map<string, string>();
    for (const r of rows || []) m.set(r.id, r.title || "");
    return m;
  };

  const threadTitles = titleMap(threads.data);
  const eventTitles = titleMap(events.data);
  const jobTitles = titleMap(jobs.data);

  // Drop chunks whose entity is no longer visible to the caller (RLS
  // filtered the hydration query). This prevents leaking placeholder
  // titles for private events, restricted threads, or inactive jobs.
  const visible = combined.filter((c) => {
    if (c.sourceTable === "discussion_threads") return threadTitles.has(c.sourceId);
    if (c.sourceTable === "events") return eventTitles.has(c.sourceId);
    if (c.sourceTable === "job_postings") return jobTitles.has(c.sourceId);
    return true;
  });

  return visible.map((c) => {
    let title = "";
    let url = "";
    if (c.sourceTable === "discussion_threads") {
      title = threadTitles.get(c.sourceId) || "Discussion";
      url = `/${orgSlug}/messages/threads/${c.sourceId}`;
    } else if (c.sourceTable === "events") {
      title = eventTitles.get(c.sourceId) || "Event";
      url = calendarEventDetailPath(orgSlug, c.sourceId);
    } else if (c.sourceTable === "job_postings") {
      title = jobTitles.get(c.sourceId) || "Job";
      url = `/${orgSlug}/jobs/${c.sourceId}`;
    } else {
      title = c.contentText.slice(0, 80);
      url = `/${orgSlug}`;
    }

    const base = c.contentText.slice(0, 200);
    const replyBlock =
      c.replySnippets.length > 0
        ? `\n[Reply match] ${c.replySnippets.join(" · ").slice(0, 220)}`
        : "";
    const snippet = `${base}${replyBlock}`.slice(0, 400);

    return {
      id: `${c.sourceTable}:${c.sourceId}`,
      sourceTable: c.sourceTable,
      sourceId: c.sourceId,
      title,
      snippet,
      url,
      similarity: c.similarity,
      metadata: {
        ...c.metadata,
        ...(c.replySnippets.length ? { reply_match: true } : {}),
      },
    };
  });
}
