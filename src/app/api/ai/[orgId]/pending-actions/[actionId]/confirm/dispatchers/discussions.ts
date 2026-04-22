/* eslint-disable @typescript-eslint/no-explicit-any */
// Domain dispatchers for `create_discussion_thread` and
// `create_discussion_reply`. Pairs in a single file because they share the
// discussions domain and the reply shape depends on the thread it's attached
// to (both dispatchers return the thread in their response body).

import { NextResponse } from "next/server";
import type { AiLogContext } from "@/lib/ai/logger";
import { aiLog } from "@/lib/ai/logger";
import type {
  clearDraftSession,
} from "@/lib/ai/draft-sessions";
import type {
  CreateDiscussionReplyPendingPayload,
  CreateDiscussionThreadPendingPayload,
  PendingActionRecord,
  updatePendingActionStatus,
} from "@/lib/ai/pending-actions";
import type { createDiscussionReply } from "@/lib/discussions/create-reply";
import type { createDiscussionThread } from "@/lib/discussions/create-thread";

export interface DiscussionDispatcherContext {
  serviceSupabase: any;
  orgId: string;
  userId: string;
  logContext: AiLogContext;
  canUseDraftSessions: boolean;
  updatePendingActionStatusFn: typeof updatePendingActionStatus;
  clearDraftSessionFn: typeof clearDraftSession;
}

export interface CreateDiscussionThreadDispatcherDeps {
  createDiscussionThreadFn: typeof createDiscussionThread;
}

export async function handleCreateDiscussionThread(
  ctx: DiscussionDispatcherContext,
  action: PendingActionRecord<"create_discussion_thread">,
  deps: CreateDiscussionThreadDispatcherDeps
): Promise<NextResponse> {
  const payload = action.payload as CreateDiscussionThreadPendingPayload;
  const result = await deps.createDiscussionThreadFn({
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
    resultEntityType: "discussion_thread",
    resultEntityId: result.thread.id,
  });

  if (ctx.canUseDraftSessions) {
    await ctx.clearDraftSessionFn(ctx.serviceSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: action.thread_id,
      pendingActionId: action.id,
      draftType: "create_discussion_thread",
    });
  }

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

  return NextResponse.json({ ok: true, thread: result.thread, actionId: action.id });
}

export interface CreateDiscussionReplyDispatcherDeps {
  createDiscussionReplyFn: typeof createDiscussionReply;
}

export async function handleCreateDiscussionReply(
  ctx: DiscussionDispatcherContext,
  action: PendingActionRecord<"create_discussion_reply">,
  deps: CreateDiscussionReplyDispatcherDeps
): Promise<NextResponse> {
  const payload = action.payload as CreateDiscussionReplyPendingPayload;
  const result = await deps.createDiscussionReplyFn({
    supabase: ctx.serviceSupabase,
    threadId: payload.discussion_thread_id,
    userId: ctx.userId,
    orgId: ctx.orgId,
    input: { body: payload.body },
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
    resultEntityType: "discussion_reply",
    resultEntityId: result.reply.id,
  });

  if (ctx.canUseDraftSessions) {
    await ctx.clearDraftSessionFn(ctx.serviceSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: action.thread_id,
      pendingActionId: action.id,
      draftType: "create_discussion_reply",
    });
  }

  const orgSlug =
    typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
      ? payload.orgSlug
      : null;
  const threadUrl = orgSlug
    ? `/${orgSlug}/messages/threads/${result.thread.id}`
    : null;
  const content = threadUrl
    ? `Posted reply in discussion thread: [${result.thread.title}](${threadUrl})`
    : `Posted reply in discussion thread: ${result.thread.title}`;

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

  return NextResponse.json({ ok: true, reply: result.reply, actionId: action.id });
}
