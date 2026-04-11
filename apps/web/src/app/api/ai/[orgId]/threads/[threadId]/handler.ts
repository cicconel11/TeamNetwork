import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export interface AiThreadDeleteRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  resolveOwnThread?: typeof resolveOwnThread;
}

export function createAiThreadDeleteHandler(deps: AiThreadDeleteRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const resolveOwnThreadFn = deps.resolveOwnThread ?? resolveOwnThread;

  return async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string; threadId: string }> }
  ) {
    const { orgId, threadId } = await params;

  // Rate limit before touching the DB
  const rateLimit = checkRateLimit(request, {
    feature: "AI thread delete",
    limitPerIp: 10,
    limitPerUser: 10,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  // Auth
    const supabase = await createClientFn();
  const {
    data: { user },
  } = await supabase.auth.getUser();

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
  if (!ctx.ok) return ctx.response;

  // Resolve ownership via service client
    const resolution = await resolveOwnThreadFn(
    threadId,
    ctx.userId,
    ctx.orgId,
    ctx.serviceSupabase
  );
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.message },
      { status: resolution.status }
    );
  }

  // Soft-delete via auth-bound client
  const now = new Date().toISOString();
  const { error } = await ctx.supabase
    .from("ai_threads")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", threadId);

  if (error) {
    console.error("[ai-threads] delete error:", error);
    return NextResponse.json({ error: "Failed to delete thread" }, { status: 500 });
  }

    return NextResponse.json({ success: true });
  };
}
