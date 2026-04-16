import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { cleanupStrandedPendingActions } from "@/lib/ai/pending-actions";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { aiLog } from "@/lib/ai/logger";

const STRANDED_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export interface AiPendingActionsCleanupRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  cleanupStrandedPendingActions?: typeof cleanupStrandedPendingActions;
}

export function createAiPendingActionsCleanupHandler(
  deps: AiPendingActionsCleanupRouteDeps = {}
) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const cleanupStrandedPendingActionsFn =
    deps.cleanupStrandedPendingActions ?? cleanupStrandedPendingActions;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string }> }
  ) {
    const { orgId } = await params;
    const requestId = crypto.randomUUID();
    const logContext = { requestId, orgId };

    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      orgId,
      userId: user?.id ?? null,
      feature: "AI pending action cleanup",
      limitPerIp: 5,
      limitPerUser: 5,
      limitPerOrg: 10,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, {
      supabase,
      logContext,
    });
    if (!ctx.ok) return ctx.response;

    try {
      const result = await cleanupStrandedPendingActionsFn(ctx.serviceSupabase, {
        organizationId: ctx.orgId,
        olderThanIso: new Date(Date.now() - STRANDED_CONFIRMATION_TTL_MS).toISOString(),
        failureMessage: "Execution timed out after confirmation",
      });

      return NextResponse.json({
        ok: true,
        ...result,
      });
    } catch (error) {
      aiLog("error", "ai-pending-actions-cleanup", "cleanup failed", {
        ...logContext,
        userId: ctx.userId,
      }, { error });
      return NextResponse.json(
        { error: "Failed to clean up stranded pending actions" },
        { status: 500, headers: rateLimit.headers }
      );
    }
  };
}
