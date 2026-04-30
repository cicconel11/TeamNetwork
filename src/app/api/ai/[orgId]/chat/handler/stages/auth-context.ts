/**
 * Stage 1: auth + org context resolution.
 *
 * - Creates supabase client.
 * - Resolves user via `auth.getUser()`.
 * - Runs rate limit; short-circuits with rate-limit response on overrun.
 * - Resolves AI org context (role-gated); short-circuits with its embedded
 *   response on failure.
 * - Computes `canUseDraftSessions`, baseLogContext, requestLogContext.
 *
 * Pure orchestration — wraps existing helpers, no policy decisions.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { createClient } from "@/lib/supabase/server";
import {
  buildRateLimitResponse,
  checkRateLimit,
} from "@/lib/security/rate-limit";
import type { AiLogContext } from "@/lib/ai/logger";
import type { getAiOrgContext } from "@/lib/ai/context";
import type { ChatRouteDeps } from "../../handler-types";
import {
  type AiAuditStageTimings,
  runTimedStage,
} from "@/lib/ai/chat-telemetry";
import { supportsDraftSessionsStore } from "@/lib/ai/draft-sessions";
import {
  AiCapReachedError,
  AiPricingConfigError,
  assertModelPriceConfigured,
  assertOrgUnderCap,
} from "@/lib/ai/spend";
import { getZaiModel } from "@/lib/ai/client";
import type { AuthContextSlice, StageOutcome } from "./state";

const DEFAULT_AI_ORG_RATE_LIMIT = 60;

function getAiOrgRateLimit(): number {
  const parsed = Number.parseInt(process.env.AI_ORG_RATE_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_AI_ORG_RATE_LIMIT;
}

export interface AuthContextStageInput {
  request: NextRequest;
  orgId: string;
  requestId: string;
  stageTimings: AiAuditStageTimings;
  createClientFn: typeof createClient;
  getAiOrgContextFn: typeof getAiOrgContext;
  /** Subset of route deps needed to detect draft-session injection in tests. */
  draftSessionDeps: Pick<
    ChatRouteDeps,
    "getDraftSession" | "saveDraftSession" | "clearDraftSession"
  >;
}

export async function runAuthContextStage(
  input: AuthContextStageInput,
): Promise<StageOutcome<AuthContextSlice>> {
  const baseLogContext: AiLogContext = {
    requestId: input.requestId,
    orgId: input.orgId,
  };
  const cacheDisabled = process.env.DISABLE_AI_CACHE === "true";

  const supabase = await input.createClientFn();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(input.request, {
    orgId: input.orgId,
    userId: user?.id ?? null,
    feature: "ai-chat",
    limitPerIp: 30,
    limitPerUser: 20,
    limitPerOrg: getAiOrgRateLimit(),
  });
  if (!rateLimit.ok) {
    return { ok: false, response: buildRateLimitResponse(rateLimit) };
  }

  const ctx = await runTimedStage(
    input.stageTimings,
    "auth_org_context",
    async () =>
      input.getAiOrgContextFn(
        input.orgId,
        user,
        rateLimit,
        { supabase, logContext: baseLogContext },
        { allowedRoles: ["admin", "active_member", "alumni"] },
      ),
  );
  if (!ctx.ok) {
    return { ok: false, response: ctx.response };
  }

  try {
    assertModelPriceConfigured(getZaiModel());
    await assertOrgUnderCap(input.orgId, { bypass: ctx.aiSpendBypass });
  } catch (err) {
    if (err instanceof AiCapReachedError) {
      return { ok: false, response: err.toResponse(rateLimit.headers) };
    }
    if (err instanceof AiPricingConfigError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "ai_pricing_not_configured" },
          { status: 503, headers: rateLimit.headers },
        ),
      };
    }
    throw err;
  }

  const canUseDraftSessions =
    supportsDraftSessionsStore(ctx.serviceSupabase) ||
    Boolean(
      input.draftSessionDeps.getDraftSession ||
        input.draftSessionDeps.saveDraftSession ||
        input.draftSessionDeps.clearDraftSession,
    );

  const requestLogContext: AiLogContext = {
    ...baseLogContext,
    userId: ctx.userId,
  };

  return {
    ok: true,
    value: {
      ctx,
      rateLimit,
      canUseDraftSessions,
      requestLogContext,
      baseLogContext,
      cacheDisabled,
    },
  };
}
