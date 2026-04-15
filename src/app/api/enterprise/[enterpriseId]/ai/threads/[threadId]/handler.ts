import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEnterpriseAiContext } from "@/lib/ai/enterprise-context";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

/**
 * DELETE /api/enterprise/[enterpriseId]/ai/threads/[threadId]
 *
 * Soft-delete an enterprise thread the calling user owns. Ownership is
 * verified by resolveOwnThread under enterprise scope (mismatched scope =>
 * 404 like ownership failure, never reveals existence to other tenants).
 */

export interface EnterpriseThreadDeleteRouteDeps {
  createClient?: typeof createClient;
  getEnterpriseAiContext?: typeof getEnterpriseAiContext;
  resolveOwnThread?: typeof resolveOwnThread;
}

export function createEnterpriseThreadDeleteHandler(
  deps: EnterpriseThreadDeleteRouteDeps = {}
) {
  const createClientFn = deps.createClient ?? createClient;
  const getCtxFn = deps.getEnterpriseAiContext ?? getEnterpriseAiContext;
  const resolveOwnThreadFn = deps.resolveOwnThread ?? resolveOwnThread;

  return async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ enterpriseId: string; threadId: string }> }
  ) {
    const { enterpriseId: idOrSlug, threadId } = await params;

    const rateLimit = checkRateLimit(request, {
      feature: "AI enterprise thread delete",
      limitPerIp: 10,
      limitPerUser: 10,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const ctx = await getCtxFn(idOrSlug, user, rateLimit, { supabase });
    if (!ctx.ok) return ctx.response;

    const resolution = await resolveOwnThreadFn(
      threadId,
      ctx.userId,
      { scope: "enterprise", enterpriseId: ctx.enterpriseId },
      ctx.serviceSupabase
    );
    if (!resolution.ok) {
      return NextResponse.json(
        { error: resolution.message },
        { status: resolution.status, headers: rateLimit.headers }
      );
    }

    const sb = ctx.supabase ?? ctx.serviceSupabase;
    const now = new Date().toISOString();
    const { error } = await sb
      .from("ai_threads")
      .update({ deleted_at: now, updated_at: now })
      .eq("id", threadId);

    if (error) {
      console.error("[ai-ent-threads] delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete thread" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    return NextResponse.json({ success: true }, { headers: rateLimit.headers });
  };
}
