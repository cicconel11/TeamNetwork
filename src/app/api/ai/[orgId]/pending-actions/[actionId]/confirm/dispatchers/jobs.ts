/* eslint-disable @typescript-eslint/no-explicit-any */
// Domain dispatcher for the `create_job_posting` pending action type.
//
// Third Phase 0.5 extraction following dispatchers/announcements.ts and
// dispatchers/events.ts. Simpler shape than either — no notification blast,
// no calendar sync. Proves the dispatcher pattern scales down cleanly.

import { NextResponse } from "next/server";
import type { AiLogContext } from "@/lib/ai/logger";
import { aiLog } from "@/lib/ai/logger";
import type {
  clearDraftSession,
} from "@/lib/ai/draft-sessions";
import type {
  CreateJobPostingPendingPayload,
  PendingActionRecord,
  updatePendingActionStatus,
} from "@/lib/ai/pending-actions";
import type { createJobPosting } from "@/lib/jobs/create-job";

export interface JobDispatcherContext {
  serviceSupabase: any;
  orgId: string;
  userId: string;
  logContext: AiLogContext;
  canUseDraftSessions: boolean;
  updatePendingActionStatusFn: typeof updatePendingActionStatus;
  clearDraftSessionFn: typeof clearDraftSession;
}

export interface JobDispatcherDeps {
  createJobPostingFn: typeof createJobPosting;
}

export async function handleCreateJobPosting(
  ctx: JobDispatcherContext,
  action: PendingActionRecord<"create_job_posting">,
  deps: JobDispatcherDeps
): Promise<NextResponse> {
  const payload = action.payload as CreateJobPostingPendingPayload;
  const result = await deps.createJobPostingFn({
    supabase: ctx.serviceSupabase,
    serviceSupabase: ctx.serviceSupabase,
    orgId: ctx.orgId,
    userId: ctx.userId,
    input: payload,
  });

  if (!result.ok) {
    await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
      status: "pending",
      expectedStatus: "confirmed",
    });
    return NextResponse.json(
      result.details
        ? { error: result.error, details: result.details }
        : { error: result.error },
      { status: result.status }
    );
  }

  await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
    status: "executed",
    expectedStatus: "confirmed",
    executedAt: new Date().toISOString(),
    resultEntityType: "job_posting",
    resultEntityId: result.job.id,
  });

  if (ctx.canUseDraftSessions) {
    await ctx.clearDraftSessionFn(ctx.serviceSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: action.thread_id,
      pendingActionId: action.id,
      draftType: "create_job_posting",
    });
  }

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
    org_id: ctx.orgId,
    role: "assistant",
    content,
    status: "complete",
  });

  if (msgError) {
    aiLog(
      "error",
      "ai-confirm",
      "failed to insert confirmation message",
      {
        ...ctx.logContext,
        userId: ctx.userId,
        threadId: action.thread_id,
      },
      {
        actionId: action.id,
        error: msgError,
      }
    );
  }

  return NextResponse.json({ ok: true, job: result.job, actionId: action.id });
}
