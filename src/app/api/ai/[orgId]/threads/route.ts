import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { listThreadsSchema } from "@/lib/schemas";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export async function GET(
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ctx = await getAiOrgContext(orgId, user, rateLimit, { supabase });
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

  // Query via auth-bound client (RLS enforces ownership + deleted_at IS NULL)
  let query = ctx.supabase
    .from("ai_threads")
    .select("id, title, surface, created_at, updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (surface) query = query.eq("surface", surface);
  if (cursor) query = query.lt("id", cursor);

  const { data: threads, error } = await query;
  if (error) {
    console.error("[ai-threads] list error:", error);
    return NextResponse.json({ error: "Failed to list threads" }, { status: 500 });
  }

  return NextResponse.json({ threads });
}
