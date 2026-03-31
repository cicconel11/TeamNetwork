import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import {
  getPendingAction,
  isAuthorizedAction,
  isPendingActionExpired,
  updatePendingActionStatus,
} from "@/lib/ai/pending-actions";
import {
  clearDraftSession,
  supportsDraftSessionsStore,
} from "@/lib/ai/draft-sessions";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export interface AiPendingActionCancelRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  getPendingAction?: typeof getPendingAction;
  updatePendingActionStatus?: typeof updatePendingActionStatus;
  clearDraftSession?: typeof clearDraftSession;
}

export function createAiPendingActionCancelHandler(deps: AiPendingActionCancelRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const getPendingActionFn = deps.getPendingAction ?? getPendingAction;
  const updatePendingActionStatusFn = deps.updatePendingActionStatus ?? updatePendingActionStatus;
  const clearDraftSessionFn = deps.clearDraftSession ?? clearDraftSession;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string; actionId: string }> }
  ) {
    const { orgId, actionId } = await params;

    const rateLimit = checkRateLimit(request, {
      feature: "AI pending action cancel",
      limitPerIp: 20,
      limitPerUser: 20,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
    if (!ctx.ok) return ctx.response;
    const canUseDraftSessions =
      supportsDraftSessionsStore(ctx.serviceSupabase) || Boolean(deps.clearDraftSession);

    const action = await getPendingActionFn(ctx.serviceSupabase, actionId);
    if (!action || !isAuthorizedAction(ctx, action)) {
      return NextResponse.json({ error: "Pending action not found" }, { status: 404 });
    }

    if (action.status === "confirmed") {
      return NextResponse.json(
        { error: "Action is currently being executed", reason: "in_progress" },
        { status: 409 }
      );
    }

    if (action.status !== "pending") {
      return NextResponse.json({ error: "Pending action is no longer available" }, { status: 409 });
    }

    const expired = isPendingActionExpired(action);
    const { updated } = await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
      status: expired ? "expired" : "cancelled",
      expectedStatus: "pending",
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Action is no longer available" },
        { status: 409 }
      );
    }

    if (expired) {
      if (canUseDraftSessions) {
        await clearDraftSessionFn(ctx.serviceSupabase, {
          organizationId: ctx.orgId,
          userId: ctx.userId,
          threadId: action.thread_id,
          pendingActionId: action.id,
        });
      }
      return NextResponse.json({ error: "Pending action has expired" }, { status: 410 });
    }

    if (canUseDraftSessions) {
      await clearDraftSessionFn(ctx.serviceSupabase, {
        organizationId: ctx.orgId,
        userId: ctx.userId,
        threadId: action.thread_id,
        pendingActionId: action.id,
      });
    }

    await ctx.serviceSupabase.from("ai_messages").insert({
      thread_id: action.thread_id,
      role: "assistant",
      content: "Cancelled the pending assistant action.",
      status: "complete",
    });

    return NextResponse.json({ ok: true, actionId: action.id });
  };
}
