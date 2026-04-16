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
    const rows = data ?? [];
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
      serviceSupabase: service,
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
