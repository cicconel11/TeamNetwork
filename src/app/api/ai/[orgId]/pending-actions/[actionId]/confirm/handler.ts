import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import {
  type CreateAnnouncementPendingPayload,
  type CreateDiscussionReplyPendingPayload,
  getPendingAction,
  isAuthorizedAction,
  isPendingActionExpired,
  type SendChatMessagePendingPayload,
  type SendGroupChatMessagePendingPayload,
  updatePendingActionStatus,
  type CreateDiscussionThreadPendingPayload,
  type CreateEventPendingPayload,
  type CreateJobPostingPendingPayload,
  type CreateEnterpriseInvitePendingPayload,
  type RevokeEnterpriseInvitePendingPayload,
} from "@/lib/ai/pending-actions";
import {
  clearDraftSession,
  supportsDraftSessionsStore,
} from "@/lib/ai/draft-sessions";
import { createEvent } from "@/lib/events/create-event";
import { createJobPosting } from "@/lib/jobs/create-job";
import { createDiscussionThread } from "@/lib/discussions/create-thread";
import { createDiscussionReply } from "@/lib/discussions/create-reply";
import {
  createAnnouncement,
  sendAnnouncementNotification,
} from "@/lib/announcements/create-announcement";
import {
  sendAiAssistedDirectChatMessage,
  type DirectChatSupabase,
} from "@/lib/chat/direct-chat";
import {
  sendAiAssistedGroupChatMessage,
  type GroupChatSupabase,
} from "@/lib/chat/group-chat";
import { calendarEventDetailPath } from "@/lib/calendar/routes";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { aiLog } from "@/lib/ai/logger";
import { syncEventToUsers } from "@/lib/google/calendar-sync";
import { sendNotificationBlast } from "@/lib/notifications";

export interface AiPendingActionConfirmRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  getPendingAction?: typeof getPendingAction;
  updatePendingActionStatus?: typeof updatePendingActionStatus;
  createAnnouncement?: typeof createAnnouncement;
  createJobPosting?: typeof createJobPosting;
  createDiscussionReply?: typeof createDiscussionReply;
  createDiscussionThread?: typeof createDiscussionThread;
  createEvent?: typeof createEvent;
  sendAnnouncementNotification?: typeof sendAnnouncementNotification;
  sendAiAssistedDirectChatMessage?: typeof sendAiAssistedDirectChatMessage;
  sendAiAssistedGroupChatMessage?: typeof sendAiAssistedGroupChatMessage;
  syncEventToUsers?: typeof syncEventToUsers;
  syncOutlookEventToUsers?: (
    supabase: Parameters<typeof syncEventToUsers>[0],
    organizationId: string,
    eventId: string,
    operation: Parameters<typeof syncEventToUsers>[3]
  ) => Promise<void>;
  sendNotificationBlast?: typeof sendNotificationBlast;
  clearDraftSession?: typeof clearDraftSession;
}

export function createAiPendingActionConfirmHandler(deps: AiPendingActionConfirmRouteDeps = {}) {
  const createClientFn = deps.createClient ?? createClient;
  const getAiOrgContextFn = deps.getAiOrgContext ?? getAiOrgContext;
  const getPendingActionFn = deps.getPendingAction ?? getPendingAction;
  const updatePendingActionStatusFn = deps.updatePendingActionStatus ?? updatePendingActionStatus;
  const createAnnouncementFn = deps.createAnnouncement ?? createAnnouncement;
  const createJobPostingFn = deps.createJobPosting ?? createJobPosting;
  const createDiscussionReplyFn = deps.createDiscussionReply ?? createDiscussionReply;
  const createDiscussionThreadFn = deps.createDiscussionThread ?? createDiscussionThread;
  const createEventFn = deps.createEvent ?? createEvent;
  const sendAnnouncementNotificationFn =
    deps.sendAnnouncementNotification ?? sendAnnouncementNotification;
  const sendAiAssistedDirectChatMessageFn =
    deps.sendAiAssistedDirectChatMessage ?? sendAiAssistedDirectChatMessage;
  const sendAiAssistedGroupChatMessageFn =
    deps.sendAiAssistedGroupChatMessage ?? sendAiAssistedGroupChatMessage;
  const syncEventToUsersFn = deps.syncEventToUsers ?? syncEventToUsers;
  const syncOutlookEventToUsersFn =
    deps.syncOutlookEventToUsers ??
    (async (...args) => {
      const { syncOutlookEventToUsers } = await import("@/lib/microsoft/calendar-sync");
      return syncOutlookEventToUsers(...args);
    });
  const sendNotificationBlastFn = deps.sendNotificationBlast ?? sendNotificationBlast;
  const clearDraftSessionFn = deps.clearDraftSession ?? clearDraftSession;

  return async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ orgId: string; actionId: string }> }
  ) {
    const { orgId, actionId } = await params;
    const requestId = crypto.randomUUID();
    const logContext = { requestId, orgId };

    const rateLimit = checkRateLimit(request, {
      feature: "AI pending action confirm",
      limitPerIp: 60,
      limitPerUser: 60,
    });
    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    const supabase = await createClientFn();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const ctx = await getAiOrgContextFn(orgId, user, rateLimit, { supabase, logContext });
    if (!ctx.ok) return ctx.response;
    const canUseDraftSessions =
      supportsDraftSessionsStore(ctx.serviceSupabase) || Boolean(deps.clearDraftSession);

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
        case "create_announcement": {
          const payload = action.payload as CreateAnnouncementPendingPayload;
          const result = await createAnnouncementFn({
            supabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            input: {
              ...payload,
              audience_user_ids: payload.audience_user_ids ?? null,
            },
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
            resultEntityType: "announcement",
            resultEntityId: result.announcement.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          try {
            await sendAnnouncementNotificationFn({
              supabase: ctx.serviceSupabase,
              announcementId: result.announcement.id,
              orgId: ctx.orgId,
              input: {
                ...payload,
                audience_user_ids: payload.audience_user_ids ?? null,
              },
              sendDirectNotification: async ({ organizationId, title, body, audience, targetUserIds }) => {
                await sendNotificationBlastFn({
                  supabase: ctx.serviceSupabase,
                  organizationId,
                  audience,
                  channel: "email",
                  title,
                  body,
                  targetUserIds,
                  category: "announcement",
                });
              },
            });
          } catch (notificationError) {
            aiLog("error", "ai-confirm", "announcement notification failed", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, { actionId: action.id, announcementId: result.announcement.id, error: notificationError });
          }

          const orgSlug =
            typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
              ? payload.orgSlug
              : null;
          const announcementUrl = orgSlug ? `/${orgSlug}/announcements` : null;
          const content = announcementUrl
            ? `Created announcement: [${result.announcement.title}](${announcementUrl})`
            : `Created announcement: ${result.announcement.title}`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
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

          return NextResponse.json({ ok: true, announcement: result.announcement, actionId: action.id });
        }
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

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
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
        case "send_chat_message": {
          const payload = action.payload as SendChatMessagePendingPayload;
          const result = await sendAiAssistedDirectChatMessageFn(ctx.serviceSupabase as DirectChatSupabase, {
            organizationId: ctx.orgId,
            senderUserId: ctx.userId,
            recipientMemberId: payload.recipient_member_id,
            recipientUserId: payload.recipient_user_id,
            recipientDisplayName: payload.recipient_display_name,
            body: payload.body,
          });

          if (!result.ok) {
            await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "chat_message",
            resultEntityId: result.messageId,
          });

          // Store recipient in thread metadata for follow-up messages
          await ctx.serviceSupabase
            .from("ai_threads")
            .update({
              metadata: { last_chat_recipient_member_id: payload.recipient_member_id },
              updated_at: new Date().toISOString(),
            })
            .eq("id", action.thread_id);

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
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
            aiLog("error", "ai-confirm", "failed to insert confirmation message", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, {
              actionId: action.id,
              error: msgError,
            });
          }

          return NextResponse.json({
            ok: true,
            actionId: action.id,
            chatGroupId: result.chatGroupId,
            messageId: result.messageId,
          });
        }
        case "send_group_chat_message": {
          const payload = action.payload as SendGroupChatMessagePendingPayload;
          const result = await sendAiAssistedGroupChatMessageFn(ctx.serviceSupabase as GroupChatSupabase, {
            organizationId: ctx.orgId,
            senderUserId: ctx.userId,
            chatGroupId: payload.chat_group_id,
            groupName: payload.group_name,
            messageStatus: payload.message_status,
            body: payload.body,
          });

          if (!result.ok) {
            await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "chat_message",
            resultEntityId: result.messageId,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
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
            aiLog("error", "ai-confirm", "failed to insert confirmation message", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, {
              actionId: action.id,
              error: msgError,
            });
          }

          return NextResponse.json({
            ok: true,
            actionId: action.id,
            chatGroupId: result.chatGroupId,
            messageId: result.messageId,
          });
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

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
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
        case "create_discussion_reply": {
          const payload = action.payload as CreateDiscussionReplyPendingPayload;
          const result = await createDiscussionReplyFn({
            supabase: ctx.serviceSupabase,
            threadId: payload.discussion_thread_id,
            userId: ctx.userId,
            orgId: ctx.orgId,
            input: { body: payload.body },
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
            resultEntityType: "discussion_reply",
            resultEntityId: result.reply.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
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
            aiLog("error", "ai-confirm", "failed to insert confirmation message", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, {
              actionId: action.id,
              error: msgError,
            });
          }

          return NextResponse.json({ ok: true, reply: result.reply, actionId: action.id });
        }
        case "create_event": {
          const payload = action.payload as CreateEventPendingPayload;
          const result = await createEventFn({
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

            aiLog("error", "ai-confirm", "create_event confirmation failed", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, {
              actionId: action.id,
              attemptedEventType: payload.event_type,
              eventErrorCode: result.code ?? null,
              eventError: result.error,
              eventStatus: result.status,
              internalError: result.internalError ?? null,
            });

            return NextResponse.json(
              {
                error: result.error,
                ...(result.code ? { code: result.code } : {}),
                ...(result.details ? { details: result.details } : {}),
              },
              { status: result.status }
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "event",
            resultEntityId: result.event.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          const orgSlug =
            typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
              ? payload.orgSlug
              : null;
          const eventUrl = orgSlug
            ? calendarEventDetailPath(orgSlug, result.event.id)
            : result.eventUrl;
          const content = eventUrl
            ? `Created event: [${result.event.title}](${eventUrl})`
            : `Created event: ${result.event.title}`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
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

          try {
            await syncEventToUsersFn(ctx.serviceSupabase, ctx.orgId, result.event.id, "create");
          } catch (syncErr) {
            aiLog("error", "ai-confirm", "google calendar sync failed", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, { actionId: action.id, eventId: result.event.id, error: syncErr });
          }

          try {
            await syncOutlookEventToUsersFn(ctx.serviceSupabase, ctx.orgId, result.event.id, "create");
          } catch (outlookErr) {
            aiLog("error", "ai-confirm", "outlook calendar sync failed", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, { actionId: action.id, eventId: result.event.id, error: outlookErr });
          }

          try {
            await sendNotificationBlastFn({
              supabase: ctx.serviceSupabase,
              organizationId: ctx.orgId,
              audience: "both",
              channel: "email",
              title: `New Event: ${result.event.title}`,
              body: `Event scheduled for ${payload.start_date} at ${payload.start_time}${payload.location ? `\nWhere: ${payload.location}` : ""}`,
              category: "event",
            });
          } catch (notifyErr) {
            aiLog("error", "ai-confirm", "event notification blast failed", {
              ...logContext,
              userId: ctx.userId,
              threadId: action.thread_id,
            }, { actionId: action.id, eventId: result.event.id, error: notifyErr });
          }

          return NextResponse.json({ ok: true, event: result.event, actionId: action.id });
        }
        case "create_enterprise_invite": {
          const payload = action.payload as CreateEnterpriseInvitePendingPayload;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rpcResult = await (supabase as any).rpc("create_enterprise_invite", {
            p_enterprise_id: payload.enterpriseId,
            p_organization_id: payload.organizationId ?? null,
            p_role: payload.role,
            p_uses: payload.usesRemaining ?? null,
            p_expires_at: payload.expiresAt ?? null,
          });

          if (rpcResult.error || !rpcResult.data || typeof rpcResult.data.id !== "string") {
            await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              { error: rpcResult.error?.message || "Failed to create enterprise invite" },
              { status: 400 },
            );
          }

          const invite = rpcResult.data as {
            id: string;
            code?: string;
            role?: string;
          };

          await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "enterprise_invite",
            resultEntityId: invite.id,
          });

          const inviteCode = typeof invite.code === "string" ? invite.code : "";
          const invitePath = `/enterprise/${payload.enterpriseSlug}/invites`;
          const content = inviteCode
            ? `Created enterprise invite \`${inviteCode}\` (${payload.role}). Manage it at [${invitePath}](${invitePath}).`
            : `Created enterprise invite (${payload.role}). Manage it at [${invitePath}](${invitePath}).`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
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

          return NextResponse.json({ ok: true, invite, actionId: action.id });
        }
        case "revoke_enterprise_invite": {
          const payload = action.payload as RevokeEnterpriseInvitePendingPayload;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updateResult = await (ctx.serviceSupabase as any)
            .from("enterprise_invites")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", payload.inviteId)
            .eq("enterprise_id", payload.enterpriseId)
            .is("revoked_at", null)
            .select("id");

          const updatedRows = Array.isArray(updateResult.data) ? updateResult.data : [];

          if (updateResult.error || updatedRows.length === 0) {
            await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              { error: updateResult.error?.message || "Failed to revoke enterprise invite" },
              { status: 400 },
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "enterprise_invite",
            resultEntityId: payload.inviteId,
          });

          const content = `Revoked enterprise invite \`${payload.inviteCode}\`.`;
          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
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

          return NextResponse.json({ ok: true, actionId: action.id });
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
