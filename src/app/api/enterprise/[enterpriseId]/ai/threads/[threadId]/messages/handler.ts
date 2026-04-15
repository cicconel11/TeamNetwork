import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEnterpriseAiContext } from "@/lib/ai/enterprise-context";
import { resolveOwnThread } from "@/lib/ai/thread-resolver";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

/**
 * GET /api/enterprise/[enterpriseId]/ai/threads/[threadId]/messages
 *
 * List messages for an enterprise thread the calling user owns. Ownership +
 * scope verified by resolveOwnThread; cross-enterprise reads return 404.
 */

export interface EnterpriseThreadMessagesRouteDeps {
  createClient?: typeof createClient;
  getEnterpriseAiContext?: typeof getEnterpriseAiContext;
  resolveOwnThread?: typeof resolveOwnThread;
}

export function createEnterpriseThreadMessagesGetHandler(
  deps: EnterpriseThreadMessagesRouteDeps = {}
) {
  const createClientFn = deps.createClient ?? createClient;
  const getCtxFn = deps.getEnterpriseAiContext ?? getEnterpriseAiContext;
  const resolveOwnThreadFn = deps.resolveOwnThread ?? resolveOwnThread;

  return async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ enterpriseId: string; threadId: string }> }
  ) {
    const { enterpriseId: idOrSlug, threadId } = await params;

    const rateLimit = checkRateLimit(request, {
      feature: "AI enterprise messages list",
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
    const { data: messages, error } = await sb
      .from("ai_messages")
      .select("id, role, content, intent, context_surface, status, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[ai-ent-messages] list error:", error);
      return NextResponse.json(
        { error: "Failed to list messages" },
        { status: 500, headers: rateLimit.headers }
      );
    }

    return NextResponse.json({ messages: messages ?? [] }, { headers: rateLimit.headers });
  };
}
