import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import {
  getPendingAction,
  isPendingActionExpired,
  updatePendingActionStatus,
  type PendingActionRecord,
} from "@/lib/ai/pending-actions";
import { createJobPosting } from "@/lib/jobs/create-job";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export interface AiPendingActionConfirmRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  getPendingAction?: typeof getPendingAction;
  updatePendingActionStatus?: typeof updatePendingActionStatus;
  createJobPosting?: typeof createJobPosting;
}

function isAuthorizedAction(ctx: { orgId: string; userId: string }, action: PendingActionRecord) {
  return action.organization_id === ctx.orgId && action.user_id === ctx.userId;
}

export function createAiPendingActionConfirmHandler(deps: AiPendingActionConfirmRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const getPendingActionFn = deps.getPendingAction ?? getPendingAction;
  const updatePendingActionStatusFn = deps.updatePendingActionStatus ?? updatePendingActionStatus;
  const createJobPostingFn = deps.createJobPosting ?? createJobPosting;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string; actionId: string }> }
  ) {
    const { orgId, actionId } = await params;

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

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase });
    if (!ctx.ok) return ctx.response;

    const action = await getPendingActionFn(ctx.serviceSupabase, actionId);
    if (!action || !isAuthorizedAction(ctx, action)) {
      return NextResponse.json({ error: "Pending action not found" }, { status: 404 });
    }

    if (action.status !== "pending") {
      return NextResponse.json({ error: "Pending action is no longer available" }, { status: 409 });
    }

    if (isPendingActionExpired(action)) {
      await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, { status: "expired" });
      return NextResponse.json({ error: "Pending action has expired" }, { status: 410 });
    }

    await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, { status: "confirmed" });

    switch (action.action_type) {
      case "create_job_posting": {
        const result = await createJobPostingFn({
          supabase: ctx.serviceSupabase,
          serviceSupabase: ctx.serviceSupabase,
          orgId: ctx.orgId,
          userId: ctx.userId,
          input: action.payload,
        });

        if (!result.ok) {
          await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, { status: "pending" });
          return NextResponse.json(
            result.details ? { error: result.error, details: result.details } : { error: result.error },
            { status: result.status }
          );
        }

        await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
          status: "executed",
          executedAt: new Date().toISOString(),
          resultEntityType: "job_posting",
          resultEntityId: result.job.id,
        });

        const orgSlug =
          typeof action.payload.orgSlug === "string" && action.payload.orgSlug.length > 0
            ? action.payload.orgSlug
            : null;
        const jobUrl = orgSlug ? `/${orgSlug}/jobs/${result.job.id}` : null;
        const content = jobUrl
          ? `Created job posting: [${result.job.title}](${jobUrl})`
          : `Created job posting: ${result.job.title}`;

        await ctx.serviceSupabase.from("ai_messages").insert({
          thread_id: action.thread_id,
          role: "assistant",
          content,
          status: "complete",
        });

        return NextResponse.json({ ok: true, job: result.job, actionId: action.id });
      }
      default:
        return NextResponse.json({ error: "Unsupported pending action" }, { status: 400 });
    }
  };
}
