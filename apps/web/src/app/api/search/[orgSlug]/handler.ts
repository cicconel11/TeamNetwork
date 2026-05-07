import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { globalSearchApiParamsSchema } from "@/lib/schemas";
import { retrieveRelevantChunks } from "@/lib/ai/rag-retriever";
import { hydrateRagSearchResults } from "@/lib/search/hydrate-rag-results";
import { logBehavioralEventFromApi } from "@/lib/analytics/server-behavioral";
import { detectIntent, fetchIntentFallbackRows } from "@/lib/search/intent-fallback";
import { normalizeRepeatedTitle } from "@/lib/search/normalize-title";

export async function handleGlobalSearchGet(request: NextRequest, orgSlug: string) {
  const rateLimit = checkRateLimit(request, {
    feature: "global search",
    limitPerIp: 120,
    limitPerUser: 90,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  const orgCtx = await getOrgContext(orgSlug);
  if (!orgCtx.organization) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: rateLimit.headers });
  }
  if (orgCtx.status !== "active" || !orgCtx.role) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: rateLimit.headers });
  }

  const url = new URL(request.url);
  let params: z.infer<typeof globalSearchApiParamsSchema>;
  try {
    params = globalSearchApiParamsSchema.parse({
      q: url.searchParams.get("q") ?? "",
      mode: url.searchParams.get("mode") ?? "fast",
      limit: url.searchParams.get("limit") ?? undefined,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid query", details: e.flatten() },
        { status: 400, headers: rateLimit.headers },
      );
    }
    throw e;
  }

  const org = orgCtx.organization;

  if (params.mode === "fast") {
    const { data, error } = await supabase.rpc("search_org_content", {
      p_org_id: org.id,
      p_org_slug: org.slug,
      p_query: params.q,
      p_limit: params.limit,
    });
    if (error) {
      console.error("[search] RPC error", error);
      return NextResponse.json({ error: "Search failed" }, { status: 500, headers: rateLimit.headers });
    }
    const rawRows = (data ?? []) as Array<{
      entity_type: string;
      entity_id: string;
      title: string | null;
      snippet: string | null;
      url_path: string | null;
      rank: number | null;
      metadata: Record<string, unknown> | null;
    }>;

    const PER_TYPE_CAP = 5;

    const intent = detectIntent(params.q);
    const intentRows = intent
      ? await fetchIntentFallbackRows({
          supabase,
          orgId: org.id,
          orgSlug: org.slug,
          entityType: intent,
          limit: PER_TYPE_CAP,
        })
      : [];

    // RPC results first (higher rank), intent fallback appended — dedupe collapses overlap.
    const merged = [...rawRows, ...intentRows];

    // Collapse identical titles within the same entity type (seed-data duplicates),
    // collapse cross-type person duplicates (member == alumni by name+email),
    // dedupe on entity_id, cap each entity type.
    const PERSON_TYPES = new Set(["member", "alumni"]);
    const seenTitleByType = new Map<string, Set<string>>();
    const seenPersonKeys = new Set<string>();
    const seenIds = new Set<string>();
    const countByType = new Map<string, number>();
    const rows: typeof rawRows = [];
    for (const r of merged) {
      const idKey = `${r.entity_type}:${r.entity_id}`;
      if (seenIds.has(idKey)) continue;
      const normalizedTitle = normalizeRepeatedTitle(r.title);
      const type = r.entity_type;
      const titleKey = normalizedTitle.trim().toLowerCase();
      if (titleKey) {
        let seen = seenTitleByType.get(type);
        if (!seen) {
          seen = new Set();
          seenTitleByType.set(type, seen);
        }
        if (seen.has(titleKey)) continue;
        seen.add(titleKey);
      }
      if (PERSON_TYPES.has(type) && titleKey) {
        const snippetKey = (r.snippet ?? "").trim().toLowerCase();
        const personKey = `${titleKey}|${snippetKey}`;
        if (seenPersonKeys.has(personKey)) continue;
        seenPersonKeys.add(personKey);
      }
      const count = countByType.get(type) ?? 0;
      if (count >= PER_TYPE_CAP) continue;
      countByType.set(type, count + 1);
      seenIds.add(idKey);
      rows.push({ ...r, title: normalizedTitle || r.title });
    }

    void logBehavioralEventFromApi(org.id, "search_used", {
      query_length: params.q.length,
      result_count: rows.length,
      mode: "fast",
    });
    return NextResponse.json({ mode: "fast" as const, results: rows }, { headers: rateLimit.headers });
  }

  let service;
  try {
    service = createServiceClient();
  } catch {
    return NextResponse.json({ error: "Search unavailable" }, { status: 503, headers: rateLimit.headers });
  }

  try {
    const chunks = await retrieveRelevantChunks({
      query: params.q,
      orgId: org.id,
      serviceSupabase: service,
      maxChunks: params.limit,
      sourceTables: ["discussion_threads", "discussion_replies", "events", "job_postings"],
    });
    const hydrated = await hydrateRagSearchResults({
      chunks,
      orgSlug,
      orgId: org.id,
      userSupabase: supabase,
    });
    void logBehavioralEventFromApi(org.id, "search_used", {
      query_length: params.q.length,
      result_count: hydrated.length,
      mode: "ai",
    });
    return NextResponse.json({ mode: "ai" as const, results: hydrated }, { headers: rateLimit.headers });
  } catch (e) {
    console.error("[search] AI mode failed", e);
    return NextResponse.json({ error: "Search failed" }, { status: 500, headers: rateLimit.headers });
  }
}
