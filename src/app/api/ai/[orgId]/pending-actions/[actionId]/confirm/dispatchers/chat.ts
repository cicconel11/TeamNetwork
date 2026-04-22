/* eslint-disable @typescript-eslint/no-explicit-any */
// Domain dispatchers for the `send_chat_message` and `send_group_chat_message`
// pending action types. Pairs in a single file because they share the chat
// domain and their shapes are near-mirrors (different sender primitive, one
// persists a recipient breadcrumb on ai_threads, the other respects a
// message-approval status note).

import { NextResponse } from "next/server";
import type { AiLogContext } from "@/lib/ai/logger";
import { aiLog } from "@/lib/ai/logger";
import type {
  clearDraftSession,
} from "@/lib/ai/draft-sessions";
import type {
  PendingActionRecord,
  SendChatMessagePendingPayload,
  SendGroupChatMessagePendingPayload,
  updatePendingActionStatus,
} from "@/lib/ai/pending-actions";
import type {
  sendAiAssistedDirectChatMessage,
  DirectChatSupabase,
} from "@/lib/chat/direct-chat";
import type {
  sendAiAssistedGroupChatMessage,
  GroupChatSupabase,
} from "@/lib/chat/group-chat";

export interface ChatDispatcherContext {
  serviceSupabase: any;
  orgId: string;
  userId: string;
  logContext: AiLogContext;
  canUseDraftSessions: boolean;
  updatePendingActionStatusFn: typeof updatePendingActionStatus;
  clearDraftSessionFn: typeof clearDraftSession;
}

export interface SendChatMessageDispatcherDeps {
  sendAiAssistedDirectChatMessageFn: typeof sendAiAssistedDirectChatMessage;
}

export async function handleSendChatMessage(
  ctx: ChatDispatcherContext,
  action: PendingActionRecord<"send_chat_message">,
  deps: SendChatMessageDispatcherDeps
): Promise<NextResponse> {
  const payload = action.payload as SendChatMessagePendingPayload;
  const result = await deps.sendAiAssistedDirectChatMessageFn(
    ctx.serviceSupabase as DirectChatSupabase,
    {
      organizationId: ctx.orgId,
      senderUserId: ctx.userId,
      recipientMemberId: payload.recipient_member_id,
      recipientUserId: payload.recipient_user_id,
      recipientDisplayName: payload.recipient_display_name,
      body: payload.body,
    }
  );

  if (!result.ok) {
    await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
      status: "pending",
      expectedStatus: "confirmed",
    });
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status }
    );
  }

  await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
    status: "executed",
    expectedStatus: "confirmed",
    executedAt: new Date().toISOString(),
    resultEntityType: "chat_message",
    resultEntityId: result.messageId,
  });

  // Store recipient in thread metadata for follow-up messages.
  await ctx.serviceSupabase
    .from("ai_threads")
    .update({
      metadata: { last_chat_recipient_member_id: payload.recipient_member_id },
      updated_at: new Date().toISOString(),
    })
    .eq("id", action.thread_id);

  if (ctx.canUseDraftSessions) {
    await ctx.clearDraftSessionFn(ctx.serviceSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: action.thread_id,
      pendingActionId: action.id,
      draftType: "send_chat_message",
    });
  }

  const orgSlug =
    typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
      ? payload.orgSlug
      : null;
  const chatUrl = orgSlug ? `/${orgSlug}/messages/chat/${result.chatGroupId}` : null;
  const content = chatUrl
    ? `Sent chat message to [${payload.recipient_display_name}](${chatUrl})`
    : `Sent chat message to ${payload.recipient_display_name}`;

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

  return NextResponse.json({
    ok: true,
    actionId: action.id,
    chatGroupId: result.chatGroupId,
    messageId: result.messageId,
  });
}

export interface SendGroupChatMessageDispatcherDeps {
  sendAiAssistedGroupChatMessageFn: typeof sendAiAssistedGroupChatMessage;
}

export async function handleSendGroupChatMessage(
  ctx: ChatDispatcherContext,
  action: PendingActionRecord<"send_group_chat_message">,
  deps: SendGroupChatMessageDispatcherDeps
): Promise<NextResponse> {
  const payload = action.payload as SendGroupChatMessagePendingPayload;
  const result = await deps.sendAiAssistedGroupChatMessageFn(
    ctx.serviceSupabase as GroupChatSupabase,
    {
      organizationId: ctx.orgId,
      senderUserId: ctx.userId,
      chatGroupId: payload.chat_group_id,
      groupName: payload.group_name,
      messageStatus: payload.message_status,
      body: payload.body,
    }
  );

  if (!result.ok) {
    await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
      status: "pending",
      expectedStatus: "confirmed",
    });
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status }
    );
  }

  await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
    status: "executed",
    expectedStatus: "confirmed",
    executedAt: new Date().toISOString(),
    resultEntityType: "chat_message",
    resultEntityId: result.messageId,
  });

  if (ctx.canUseDraftSessions) {
    await ctx.clearDraftSessionFn(ctx.serviceSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: action.thread_id,
      pendingActionId: action.id,
      draftType: "send_group_chat_message",
    });
  }

  const orgSlug =
    typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
      ? payload.orgSlug
      : null;
  const chatUrl = orgSlug ? `/${orgSlug}/messages/chat/${result.chatGroupId}` : null;
  const statusNote = result.messageStatus === "pending" ? " (pending approval)" : "";
  const content = chatUrl
    ? `Sent message to [${payload.group_name}](${chatUrl})${statusNote}`
    : `Sent message to ${payload.group_name}${statusNote}`;

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

  return NextResponse.json({
    ok: true,
    actionId: action.id,
    chatGroupId: result.chatGroupId,
    messageId: result.messageId,
  });
}
