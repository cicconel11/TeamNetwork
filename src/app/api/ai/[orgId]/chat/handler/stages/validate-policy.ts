/**
 * Stage 2: validate body + build execution policy.
 *
 * Wraps the existing `runTimedStage("request_validation_policy")` block.
 * Returns the chunky bag of bindings the rest of the handler reads;
 * orchestrator handles its own try/catch around `validateJson` + ZodError.
 */
import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as NextResponseCtor } from "next/server";
import {
  validateJson,
  validationErrorResponse,
  ValidationError,
} from "@/lib/security/validation";
import { sendMessageSchema } from "@/lib/schemas";
import { assessAiMessageSafety } from "@/lib/ai/message-safety";
import { resolveSurfaceRouting } from "@/lib/ai/intent-router";
import {
  type buildTurnExecutionPolicy,
} from "@/lib/ai/turn-execution-policy";
import {
  checkCacheEligibility,
  type CacheSurface,
} from "@/lib/ai/semantic-cache-utils";
import { filterAllowedTools } from "@/lib/ai/access-policy";
import type { CacheStatus } from "@/lib/ai/sse";
import type { AiAuditStageTimings } from "@/lib/ai/chat-telemetry";
import { runTimedStage } from "@/lib/ai/chat-telemetry";
import type { AiOrgContext } from "@/lib/ai/context";
import { getPass1Tools } from "../pass1-tools";
import type { StageOutcome, ValidatePolicySlice } from "./state";

export interface ValidatePolicyStageInput {
  request: NextRequest;
  ctx: Extract<AiOrgContext, { ok: true }>;
  rateLimit: { headers: Record<string, string> | undefined };
  cacheDisabled: boolean;
  stageTimings: AiAuditStageTimings;
  buildTurnExecutionPolicyFn: typeof buildTurnExecutionPolicy;
}

export async function runValidatePolicyStage(
  input: ValidatePolicyStageInput,
): Promise<StageOutcome<ValidatePolicySlice>> {
  try {
    const slice = await runTimedStage(
      input.stageTimings,
      "request_validation_policy",
      async (): Promise<ValidatePolicySlice> => {
        const validatedBody = await validateJson(input.request, sendMessageSchema);
        const {
          message,
          surface,
          threadId: existingThreadId,
          idempotencyKey,
          currentPath,
          attachment,
        } = validatedBody;
        const messageSafety = assessAiMessageSafety(message);
        const routing = resolveSurfaceRouting(
          messageSafety.promptSafeMessage,
          surface,
        );
        const effectiveSurface = routing.effectiveSurface as CacheSurface;
        const resolvedIntent = routing.intent;
        const resolvedIntentType = routing.intentType;

        const eligibility = checkCacheEligibility({
          message: messageSafety.promptSafeMessage,
          threadId: existingThreadId,
          surface: effectiveSurface,
          bypassCache: validatedBody.bypassCache,
        });

        const executionPolicy = input.buildTurnExecutionPolicyFn({
          message: messageSafety.promptSafeMessage,
          threadId: existingThreadId,
          requestedSurface: surface,
          routing,
          cacheEligibility: eligibility,
        });
        const usesSharedStaticContext =
          executionPolicy.contextPolicy === "shared_static";
        input.stageTimings.retrieval = {
          decision: executionPolicy.retrieval.mode,
          reason: executionPolicy.retrieval.reason,
        };

        let cacheStatus: CacheStatus = input.cacheDisabled
          ? "disabled"
          : validatedBody.bypassCache
            ? "bypass"
            : "ineligible";
        let cacheBypassReason: string | undefined;

        if (input.cacheDisabled && executionPolicy.cachePolicy === "lookup_exact") {
          cacheStatus = "disabled";
          cacheBypassReason = "disabled_via_env";
        } else if (executionPolicy.cachePolicy === "skip") {
          cacheBypassReason =
            executionPolicy.profile === "casual"
              ? "casual_turn"
              : executionPolicy.profile === "out_of_scope"
                ? "out_of_scope_request"
                : executionPolicy.profile === "out_of_scope_unrelated"
                  ? "scope_refusal"
                  : eligibility.eligible
                    ? executionPolicy.reasons[0]
                    : eligibility.reason;
        } else if (!eligibility.eligible) {
          cacheBypassReason = eligibility.reason;
        }

        let pass1Tools = getPass1Tools(
          messageSafety.promptSafeMessage,
          effectiveSurface,
          executionPolicy.toolPolicy,
          executionPolicy.intentType,
          attachment,
          currentPath,
          Boolean(input.ctx.enterpriseId),
          input.ctx.enterpriseRole,
        );
        pass1Tools = filterAllowedTools(pass1Tools, {
          role: input.ctx.role,
          enterpriseRole: input.ctx.enterpriseRole,
        });

        return {
          validatedBody,
          message,
          surface,
          existingThreadId,
          idempotencyKey,
          currentPath,
          attachment,
          messageSafety,
          routing,
          effectiveSurface,
          resolvedIntent,
          resolvedIntentType,
          executionPolicy,
          usesSharedStaticContext,
          pass1Tools,
          cacheStatus,
          cacheEntryId: undefined,
          cacheBypassReason,
        };
      },
    );

    return { ok: true, value: slice };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, response: validationErrorResponse(err) as NextResponse };
    }
    return {
      ok: false,
      response: NextResponseCtor.json(
        { error: "Invalid JSON" },
        { status: 400, headers: input.rateLimit.headers },
      ),
    };
  }
}
