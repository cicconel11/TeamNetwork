import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { listThreadsSchema } from "@/lib/schemas";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { decodeCursor, applyCursorFilter, buildCursorResponse } from "@/lib/pagination/cursor";

export interface AiThreadsRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
}

export function createAiThreadsGetHandler(deps: AiThreadsRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;

  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;

  // Rate limit before touching the DB
  const rateLimit = checkRateLimit(request, {
    feature: "AI threads list",
    limitPerIp: 30,
    limitPerUser: 30,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  // Auth
    const supabase = await createClientFn();
  const {
    data: { user },
  } = await supabase.auth.getUser();

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
  if (!ctx.ok) return ctx.response;

  // Validate query params
  const url = new URL(request.url);
  const parsed = listThreadsSchema.safeParse({
    surface: url.searchParams.get("surface") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }
  const { surface, limit, cursor } = parsed.data;

  // Decode and validate the cursor if provided
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  // Query via auth-bound client (RLS enforces ownership + deleted_at IS NULL)
  // Fetch limit+1 rows so buildCursorResponse can detect hasMore
  let query = ctx.supabase
    .from("ai_threads")
    .select("id, title, surface, created_at, updated_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (surface) query = query.eq("surface", surface);
  if (decoded) query = applyCursorFilter(query, decoded);

  const { data, error } = await query;
  if (error) {
    console.error("[ai-threads] list error:", error);
    return NextResponse.json({ error: "Failed to list threads" }, { status: 500 });
  }

  const result = buildCursorResponse(data ?? [], limit);
    return NextResponse.json(result, { headers: rateLimit.headers });
  };
}
