import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import {
  getPendingAction,
  isAuthorizedAction,
  isPendingActionExpired,
  type PendingActionRecord,
  updatePendingActionStatus,
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
import { sendAiAssistedDirectChatMessage } from "@/lib/chat/direct-chat";
import { sendAiAssistedGroupChatMessage } from "@/lib/chat/group-chat";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { aiLog } from "@/lib/ai/logger";
import { syncEventToUsers } from "@/lib/google/calendar-sync";
import { sendNotificationBlast } from "@/lib/notifications";
import { handleCreateAnnouncement } from "./dispatchers/announcements";
import { handleCreateEvent } from "./dispatchers/events";
import { handleCreateJobPosting } from "./dispatchers/jobs";
import {
  handleSendChatMessage,
  handleSendGroupChatMessage,
} from "./dispatchers/chat";
import {
  handleCreateDiscussionReply,
  handleCreateDiscussionThread,
} from "./dispatchers/discussions";
import {
  handleCreateEnterpriseInvite,
  handleRevokeEnterpriseInvite,
} from "./dispatchers/enterprise-invites";

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
        case "create_announcement":
          // `return await` (not `return`) is required: the outer try/catch must
          // observe rejections from the dispatcher to run the rollback path.
          // `return promise` would return the pending promise and let the
          // rejection escape the surrounding try.
          return await handleCreateAnnouncement(
            {
              serviceSupabase: ctx.serviceSupabase,
              orgId: ctx.orgId,
              userId: ctx.userId,
              logContext,
              canUseDraftSessions,
              updatePendingActionStatusFn,
              clearDraftSessionFn,
            },
            action as PendingActionRecord<"create_announcement">,
            {
              createAnnouncementFn,
              sendAnnouncementNotificationFn,
              sendNotificationBlastFn,
            }
          );
        case "create_job_posting":
          return await handleCreateJobPosting(
            {
              serviceSupabase: ctx.serviceSupabase,
              orgId: ctx.orgId,
              userId: ctx.userId,
              logContext,
              canUseDraftSessions,
              updatePendingActionStatusFn,
              clearDraftSessionFn,
            },
            action as PendingActionRecord<"create_job_posting">,
            { createJobPostingFn }
          );
        case "send_chat_message": {
          const chatCtx = {
            serviceSupabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            logContext,
            canUseDraftSessions,
            updatePendingActionStatusFn,
            clearDraftSessionFn,
          };
          return await handleSendChatMessage(
            chatCtx,
            action as PendingActionRecord<"send_chat_message">,
            { sendAiAssistedDirectChatMessageFn }
          );
        }
        case "send_group_chat_message": {
          const chatCtx = {
            serviceSupabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            logContext,
            canUseDraftSessions,
            updatePendingActionStatusFn,
            clearDraftSessionFn,
          };
          return await handleSendGroupChatMessage(
            chatCtx,
            action as PendingActionRecord<"send_group_chat_message">,
            { sendAiAssistedGroupChatMessageFn }
          );
        }
        case "create_discussion_thread": {
          const discussionCtx = {
            serviceSupabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            logContext,
            canUseDraftSessions,
            updatePendingActionStatusFn,
            clearDraftSessionFn,
          };
          return await handleCreateDiscussionThread(
            discussionCtx,
            action as PendingActionRecord<"create_discussion_thread">,
            { createDiscussionThreadFn }
          );
        }
        case "create_discussion_reply": {
          const discussionCtx = {
            serviceSupabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            logContext,
            canUseDraftSessions,
            updatePendingActionStatusFn,
            clearDraftSessionFn,
          };
          return await handleCreateDiscussionReply(
            discussionCtx,
            action as PendingActionRecord<"create_discussion_reply">,
            { createDiscussionReplyFn }
          );
        }
        case "create_event":
          return await handleCreateEvent(
            {
              serviceSupabase: ctx.serviceSupabase,
              orgId: ctx.orgId,
              userId: ctx.userId,
              logContext,
              canUseDraftSessions,
              updatePendingActionStatusFn,
              clearDraftSessionFn,
            },
            action as PendingActionRecord<"create_event">,
            {
              createEventFn,
              syncEventToUsersFn,
              syncOutlookEventToUsersFn,
              sendNotificationBlastFn,
            }
          );
        case "create_enterprise_invite": {
          const enterpriseCtx = {
            supabase,
            serviceSupabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            logContext,
            updatePendingActionStatusFn,
          };
          return await handleCreateEnterpriseInvite(
            enterpriseCtx,
            action as PendingActionRecord<"create_enterprise_invite">
          );
        }
        case "revoke_enterprise_invite": {
          const enterpriseCtx = {
            supabase,
            serviceSupabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            logContext,
            updatePendingActionStatusFn,
          };
          return await handleRevokeEnterpriseInvite(
            enterpriseCtx,
            action as PendingActionRecord<"revoke_enterprise_invite">
          );
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
