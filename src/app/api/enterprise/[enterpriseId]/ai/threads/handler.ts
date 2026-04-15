import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEnterpriseAiContext } from "@/lib/ai/enterprise-context";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

/**
 * GET /api/enterprise/[enterpriseId]/ai/threads
 *
 * List enterprise-scoped AI threads owned by the calling user.
 * Phase 1: simple paged list (no cursor — Phase 2). Filters by enterprise_id +
 * user_id + deleted_at IS NULL via service client. The DB-level RLS policies
 * also enforce membership independently.
 */

export interface EnterpriseThreadsRouteDeps {
  createClient?: typeof createClient;
  getEnterpriseAiContext?: typeof getEnterpriseAiContext;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function createEnterpriseThreadsGetHandler(
  deps: EnterpriseThreadsRouteDeps = {}
) {
  const createClientFn = deps.createClient ?? createClient;
  const getCtxFn = deps.getEnterpriseAiContext ?? getEnterpriseAiContext;

  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ enterpriseId: string }> }
  ) {
    const { enterpriseId: idOrSlug } = await params;

    const rateLimit = checkRateLimit(request, {
      feature: "AI enterprise threads list",
      limitPerIp: 30,
      limitPerUser: 30,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const ctx = await getCtxFn(idOrSlug, user, rateLimit, { supabase });
    if (!ctx.ok) return ctx.response;

    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
        : DEFAULT_LIMIT;

    const { data, error } = await ctx.serviceSupabase
      .from("ai_threads")
      .select("id, title, surface, created_at, updated_at")
      .eq("enterprise_id", ctx.enterpriseId)
      .eq("user_id", ctx.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[ai-ent-threads] list error:", error);
      return NextResponse.json(
        { error: "Failed to list threads" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    return NextResponse.json({ threads: data ?? [] }, { headers: rateLimit.headers });
  };
}
