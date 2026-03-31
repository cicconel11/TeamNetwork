import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import {
  getPendingAction,
  isAuthorizedAction,
  isPendingActionExpired,
  updatePendingActionStatus,
  type CreateDiscussionThreadPendingPayload,
  type CreateJobPostingPendingPayload,
} from "@/lib/ai/pending-actions";
import { createJobPosting } from "@/lib/jobs/create-job";
import { createDiscussionThread } from "@/lib/discussions/create-thread";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { aiLog } from "@/lib/ai/logger";

export interface AiPendingActionConfirmRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  getPendingAction?: typeof getPendingAction;
  updatePendingActionStatus?: typeof updatePendingActionStatus;
  createJobPosting?: typeof createJobPosting;
  createDiscussionThread?: typeof createDiscussionThread;
}

export function createAiPendingActionConfirmHandler(deps: AiPendingActionConfirmRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const getPendingActionFn = deps.getPendingAction ?? getPendingAction;
  const updatePendingActionStatusFn = deps.updatePendingActionStatus ?? updatePendingActionStatus;
  const createJobPostingFn = deps.createJobPosting ?? createJobPosting;
  const createDiscussionThreadFn = deps.createDiscussionThread ?? createDiscussionThread;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string; actionId: string }> }
  ) {
    const { orgId, actionId } = await params;
    const requestId = crypto.randomUUID();
    const logContext = { requestId, orgId };

    const rateLimit = checkRateLimit(request, {
      feature: "AI pending action confirm",
      limitPerIp: 10,
      limitPerUser: 10,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase, logContext });
    if (!ctx.ok) return ctx.response;

    const action = await getPendingActionFn(ctx.serviceSupabase, actionId);
    if (!action || !isAuthorizedAction(ctx, action)) {
      return NextResponse.json({ error: "Pending action not found" }, { status: 404 });
    }

    if (action.status !== "pending") {
      if (action.status === "executed") {
        return NextResponse.json({
          ok: true,
          actionId: action.id,
          resultEntityType: action.result_entity_type,
          resultEntityId: action.result_entity_id,
          replayed: true,
        });
      }
      if (action.status === "cancelled") {
        return NextResponse.json({ error: "Action was cancelled", reason: "cancelled" }, { status: 409 });
      }
      if (action.status === "expired") {
        return NextResponse.json({ error: "Pending action has expired" }, { status: 410 });
      }
      return NextResponse.json({ error: "Pending action is no longer available" }, { status: 409 });
    }

    if (isPendingActionExpired(action)) {
      await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
        status: "expired",
        expectedStatus: "pending",
      });
      return NextResponse.json({ error: "Pending action has expired" }, { status: 410 });
    }

    // CAS: atomically claim pending → confirmed
    const casResult = await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
      status: "confirmed",
      expectedStatus: "pending",
    });

    if (!casResult.updated) {
      // Re-read to provide appropriate response
      const current = await getPendingActionFn(ctx.serviceSupabase, actionId);
      if (!current) {
        return NextResponse.json({ error: "Pending action not found" }, { status: 404 });
      }
      if (current.status === "executed") {
        return NextResponse.json({
          ok: true,
          actionId: current.id,
          resultEntityType: current.result_entity_type,
          resultEntityId: current.result_entity_id,
          replayed: true,
        });
      }
      if (current.status === "cancelled") {
        return NextResponse.json({ error: "Action was cancelled", reason: "cancelled" }, { status: 409 });
      }
      if (current.status === "expired") {
        return NextResponse.json({ error: "Pending action has expired" }, { status: 410 });
      }
      return NextResponse.json({ error: "Pending action is no longer available" }, { status: 409 });
    }

    try {
      switch (action.action_type) {
        case "create_job_posting": {
          const payload = action.payload as CreateJobPostingPendingPayload;
          const result = await createJobPostingFn({
            supabase: ctx.serviceSupabase,
            serviceSupabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            input: payload,
          });

          if (!result.ok) {
            await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              result.details ? { error: result.error, details: result.details } : { error: result.error },
              { status: result.status }
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "job_posting",
            resultEntityId: result.job.id,
          });

          const orgSlug =
            typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
              ? payload.orgSlug
              : null;
          const jobUrl = orgSlug ? `/${orgSlug}/jobs/${result.job.id}` : null;
          const content = jobUrl
            ? `Created job posting: [${result.job.title}](${jobUrl})`
            : `Created job posting: ${result.job.title}`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            role: "assistant",
            content,
            status: "complete",
          });

          if (msgError) {
            aiLog("error", "ai-confirm", "failed to insert confirmation message", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, {
              actionId: action.id,
              error: msgError,
            });
          }

          return NextResponse.json({ ok: true, job: result.job, actionId: action.id });
        }
        case "create_discussion_thread": {
          const payload = action.payload as CreateDiscussionThreadPendingPayload;
          const result = await createDiscussionThreadFn({
            supabase: ctx.serviceSupabase,
            serviceSupabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            input: payload,
            orgSlug:
              typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
                ? payload.orgSlug
                : null,
          });

          if (!result.ok) {
            await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              result.details ? { error: result.error, details: result.details } : { error: result.error },
              { status: result.status }
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "discussion_thread",
            resultEntityId: result.thread.id,
          });

          const orgSlug =
            typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
              ? payload.orgSlug
              : null;
          const threadUrl = orgSlug
            ? `/${orgSlug}/messages/threads/${result.thread.id}`
            : result.threadUrl;
          const content = threadUrl
            ? `Created discussion thread: [${result.thread.title}](${threadUrl})`
            : `Created discussion thread: ${result.thread.title}`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            role: "assistant",
            content,
            status: "complete",
          });

          if (msgError) {
            aiLog("error", "ai-confirm", "failed to insert confirmation message", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, {
              actionId: action.id,
              error: msgError,
            });
          }

          return NextResponse.json({ ok: true, thread: result.thread, actionId: action.id });
        }
        default:
          throw new Error(`Unsupported pending action type: ${action.action_type satisfies never}`);
      }
    } catch (err) {
      // Attempt rollback to pending so the user can retry
      try {
        await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
          status: "pending",
          expectedStatus: "confirmed",
        });
      } catch (rollbackErr) {
        aiLog("error", "ai-confirm", "rollback failed - action stranded in confirmed state", {
          ...logContext,
          userId: ctx.userId,
          threadId: action.thread_id,
        }, {
          actionId: action.id,
          actionType: action.action_type,
          originalError: err,
          rollbackError: rollbackErr,
        });
      }
      throw err;
    }
  };
}
