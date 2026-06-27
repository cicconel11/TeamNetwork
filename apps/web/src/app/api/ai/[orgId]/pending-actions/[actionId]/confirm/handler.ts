import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import {
  type CreateAnnouncementPendingPayload,
  type CreateDiscussionReplyPendingPayload,
  type DeleteAnnouncementPendingPayload,
  getPendingAction,
  isAuthorizedAction,
  isPendingActionExpired,
  type SendChatMessagePendingPayload,
  type SendGroupChatMessagePendingPayload,
  type MemberRoleChangePendingPayload,
  type UpdateAnnouncementPendingPayload,
  updatePendingActionStatus,
  type CreateDiscussionThreadPendingPayload,
  type CreateEventPendingPayload,
  type CreateJobPostingPendingPayload,
  type UpdateJobPostingPendingPayload,
  type DeleteJobPostingPendingPayload,
  type UpdateEventPendingPayload,
  type DeleteEventPendingPayload,
  type CreateEnterpriseInvitePendingPayload,
  type RevokeEnterpriseInvitePendingPayload,
  type CreateMentorshipPairingPendingPayload,
  type PendingActionSupabase,
} from "@/lib/ai/pending-actions";
import { executeAdminPairing } from "@/lib/mentorship/admin-pairing";
import {
  clearDraftSession,
  supportsDraftSessionsStore,
  type DraftSessionSupabase,
} from "@/lib/ai/draft-sessions";
import { createEvent } from "@/lib/events/create-event";
import { updateEvent } from "@/lib/events/update-event";
import { deleteEvent } from "@/lib/events/delete-event";
import { createJobPosting } from "@/lib/jobs/create-job";
import { updateJobPosting } from "@/lib/jobs/update-job";
import { deleteJobPosting } from "@/lib/jobs/delete-job";
import { createDiscussionThread } from "@/lib/discussions/create-thread";
import { createDiscussionReply } from "@/lib/discussions/create-reply";
import {
  createAnnouncement,
  sendAnnouncementNotification,
  deleteAnnouncement,
  updateAnnouncement,
} from "@/domains/announcements";
import {
  sendAiAssistedDirectChatMessage,
  type DirectChatSupabase,
} from "@/lib/chat/direct-chat";
import {
  sendAiAssistedGroupChatMessage,
  type GroupChatSupabase,
} from "@/lib/chat/group-chat";
import { calendarEventDetailPath, calendarListPath } from "@/lib/calendar/routes";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { aiLog } from "@/lib/ai/logger";
import { syncEventToUsers } from "@/lib/google/calendar-sync";
import { sendNotificationBlast } from "@/lib/notifications";
import {
  executeMemberRoleChange,
  isTerminalRoleChangeError,
  toUserSafeRoleChangeMessage,
  type ExecuteFailureReason,
  type MemberRoleChangeClient,
} from "@/lib/members/role-change";

function normalizedConfirmMetadata(input: {
  actionType: string;
  resultEntityType: string;
  resultEntityId: string;
  affectedPaths?: string[];
  affectedEvents?: string[];
}) {
  return {
    actionType: input.actionType,
    resultEntityType: input.resultEntityType,
    resultEntityId: input.resultEntityId,
    affectedPaths: Array.from(new Set(input.affectedPaths ?? [])),
    affectedEvents: Array.from(new Set(input.affectedEvents ?? [])),
  };
}

export interface AiPendingActionConfirmRouteDeps {
  createClient?: typeof createClient;
  getAiOrgContext?: typeof getAiOrgContext;
  getPendingAction?: typeof getPendingAction;
  updatePendingActionStatus?: typeof updatePendingActionStatus;
  createAnnouncement?: typeof createAnnouncement;
  updateAnnouncement?: typeof updateAnnouncement;
  deleteAnnouncement?: typeof deleteAnnouncement;
  createJobPosting?: typeof createJobPosting;
  updateJobPosting?: typeof updateJobPosting;
  deleteJobPosting?: typeof deleteJobPosting;
  createDiscussionReply?: typeof createDiscussionReply;
  createDiscussionThread?: typeof createDiscussionThread;
  createEvent?: typeof createEvent;
  updateEvent?: typeof updateEvent;
  deleteEvent?: typeof deleteEvent;
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
  const updateAnnouncementFn = deps.updateAnnouncement ?? updateAnnouncement;
  const deleteAnnouncementFn = deps.deleteAnnouncement ?? deleteAnnouncement;
  const createJobPostingFn = deps.createJobPosting ?? createJobPosting;
  const updateJobPostingFn = deps.updateJobPosting ?? updateJobPosting;
  const deleteJobPostingFn = deps.deleteJobPosting ?? deleteJobPosting;
  const createDiscussionReplyFn = deps.createDiscussionReply ?? createDiscussionReply;
  const createDiscussionThreadFn = deps.createDiscussionThread ?? createDiscussionThread;
  const createEventFn = deps.createEvent ?? createEvent;
  const updateEventFn = deps.updateEvent ?? updateEvent;
  const deleteEventFn = deps.deleteEvent ?? deleteEvent;
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

    const action = await getPendingActionFn(ctx.serviceSupabase as unknown as PendingActionSupabase, actionId);
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
      await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
        status: "expired",
        expectedStatus: "pending",
      });
      return NextResponse.json({ error: "Pending action has expired" }, { status: 410 });
    }

    // CAS: atomically claim pending → confirmed
    const casResult = await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
      status: "confirmed",
      expectedStatus: "pending",
    });

    if (!casResult.updated) {
      // Re-read to provide appropriate response
      const current = await getPendingActionFn(ctx.serviceSupabase as unknown as PendingActionSupabase, actionId);
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              result.details ? { error: result.error, details: result.details } : { error: result.error },
              { status: result.status }
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "announcement",
            resultEntityId: result.announcement.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
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
            user_id: ctx.userId,
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
        case "update_announcement": {
          const payload = action.payload as UpdateAnnouncementPendingPayload;
          const result = await updateAnnouncementFn({
            supabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            announcementId: payload.announcement_id,
            input: {
              title: payload.title,
              body: payload.body,
              is_pinned: payload.is_pinned,
              audience: payload.audience,
            },
          });

          if (!result.ok) {
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              result.details ? { error: result.error, details: result.details } : { error: result.error },
              { status: result.status }
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "announcement",
            resultEntityId: result.announcement.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
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
          const announcementUrl = orgSlug ? `/${orgSlug}/announcements` : null;
          const content = announcementUrl
            ? `Updated announcement: [${result.announcement.title}](${announcementUrl})`
            : `Updated announcement: ${result.announcement.title}`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
            user_id: ctx.userId,
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
        case "delete_announcement": {
          const payload = action.payload as DeleteAnnouncementPendingPayload;
          const result = await deleteAnnouncementFn({
            supabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            userId: ctx.userId,
            announcementId: payload.announcement_id,
          });

          if (!result.ok) {
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json({ error: result.error }, { status: result.status });
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "announcement",
            resultEntityId: result.announcementId,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          const content = `Deleted announcement: ${payload.title}`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
            user_id: ctx.userId,
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

          return NextResponse.json({ ok: true, announcementId: result.announcementId, actionId: action.id });
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              result.details ? { error: result.error, details: result.details } : { error: result.error },
              { status: result.status }
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "job_posting",
            resultEntityId: result.job.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
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
            user_id: ctx.userId,
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
        case "update_job_posting": {
          const payload = action.payload as UpdateJobPostingPendingPayload;
          const result = await updateJobPostingFn({
            supabase: ctx.serviceSupabase,
            jobId: payload.job_id,
            actorUserId: ctx.userId,
            data: payload,
            requireAdmin: true,
          });

          if (!result.ok) {
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: result.status === 404 || result.status === 403 || result.status === 400 ? "failed" : "pending",
              expectedStatus: "confirmed",
              errorMessage: result.status === 404 || result.status === 403 || result.status === 400 ? result.error : null,
            });
            return NextResponse.json(
              {
                error: result.error,
                terminal: result.status === 404 || result.status === 403 || result.status === 400,
                actionStatus: result.status === 404 || result.status === 403 || result.status === 400 ? "failed" : "pending",
                ...(result.details ? { details: result.details } : {}),
              },
              { status: result.status },
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "job_posting",
            resultEntityId: payload.job_id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          const orgSlug = typeof payload.orgSlug === "string" && payload.orgSlug.length > 0 ? payload.orgSlug : null;
          const jobPath = orgSlug ? `/${orgSlug}/jobs/${payload.job_id}` : null;
          const title = typeof result.job.title === "string" ? result.job.title : payload.title ?? "Job posting";
          const content = jobPath
            ? `Updated job posting: [${title}](${jobPath})`
            : `Updated job posting: ${title}`;

          await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
            user_id: ctx.userId,
            role: "assistant",
            content,
            status: "complete",
          });

          return NextResponse.json({
            ok: true,
            job: result.job,
            actionId: action.id,
            ...normalizedConfirmMetadata({
              actionType: "update_job_posting",
              resultEntityType: "job_posting",
              resultEntityId: payload.job_id,
              affectedPaths: orgSlug ? [`/${orgSlug}/jobs`, `/${orgSlug}/jobs/${payload.job_id}`] : [],
              affectedEvents: ["tn:ai-job-posting-updated"],
            }),
          });
        }
        case "delete_job_posting": {
          const payload = action.payload as DeleteJobPostingPendingPayload;
          const result = await deleteJobPostingFn({
            supabase: ctx.serviceSupabase,
            jobId: payload.job_id,
            actorUserId: ctx.userId,
            requireAdmin: true,
          });

          if (!result.ok) {
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: result.status === 404 || result.status === 403 ? "failed" : "pending",
              expectedStatus: "confirmed",
              errorMessage: result.status === 404 || result.status === 403 ? result.error : null,
            });
            return NextResponse.json(
              {
                error: result.error,
                terminal: result.status === 404 || result.status === 403,
                actionStatus: result.status === 404 || result.status === 403 ? "failed" : "pending",
              },
              { status: result.status },
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "job_posting",
            resultEntityId: payload.job_id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          const orgSlug = typeof payload.orgSlug === "string" && payload.orgSlug.length > 0 ? payload.orgSlug : null;
          await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
            user_id: ctx.userId,
            role: "assistant",
            content: `Deleted job posting: ${payload.title}`,
            status: "complete",
          });

          return NextResponse.json({
            ok: true,
            jobId: payload.job_id,
            actionId: action.id,
            ...normalizedConfirmMetadata({
              actionType: "delete_job_posting",
              resultEntityType: "job_posting",
              resultEntityId: payload.job_id,
              affectedPaths: orgSlug ? [`/${orgSlug}/jobs`] : [],
              affectedEvents: ["tn:ai-job-posting-deleted"],
            }),
          });
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
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
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
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
            user_id: ctx.userId,
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "chat_message",
            resultEntityId: result.messageId,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
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
            user_id: ctx.userId,
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

          const { data: orgSlugRow } = await ctx.serviceSupabase
            .from("organizations")
            .select("slug")
            .eq("id", ctx.orgId)
            .single();

          if (orgSlugRow?.slug) {
            const slug = orgSlugRow.slug;
            revalidatePath(`/${slug}`);
            revalidatePath(`/${slug}/members`, "layout");
            revalidatePath(`/${slug}/parents`, "layout");
            revalidatePath(`/${slug}/settings/invites`);
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              result.details ? { error: result.error, details: result.details } : { error: result.error },
              { status: result.status }
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "discussion_thread",
            resultEntityId: result.thread.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
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
            user_id: ctx.userId,
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              result.details ? { error: result.error, details: result.details } : { error: result.error },
              { status: result.status }
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "discussion_reply",
            resultEntityId: result.reply.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
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
            user_id: ctx.userId,
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
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

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "event",
            resultEntityId: result.event.id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
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
            user_id: ctx.userId,
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
        case "update_event": {
          const payload = action.payload as UpdateEventPendingPayload;
          const result = await updateEventFn({
            supabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            actorUserId: ctx.userId,
            eventId: payload.event_id,
            data: payload,
            scope: payload.update_scope,
          });

          if (!result.ok) {
            const terminal = result.status === 400 || result.status === 403 || result.status === 404;
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: terminal ? "failed" : "pending",
              expectedStatus: "confirmed",
              errorMessage: terminal ? result.error : null,
            });
            return NextResponse.json(
              {
                error: result.error,
                terminal,
                actionStatus: terminal ? "failed" : "pending",
                ...(result.details ? { details: result.details } : {}),
              },
              { status: result.status },
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "event",
            resultEntityId: payload.event_id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          for (const eventId of result.affectedEventIds) {
            try {
              await syncEventToUsersFn(ctx.serviceSupabase, ctx.orgId, eventId, "update");
            } catch (syncErr) {
              aiLog("error", "ai-confirm", "google calendar sync failed", {
                ...logContext,
                userId: ctx.userId,
                threadId: action.thread_id,
              }, { actionId: action.id, eventId, error: syncErr });
            }
            try {
              await syncOutlookEventToUsersFn(ctx.serviceSupabase, ctx.orgId, eventId, "update");
            } catch (outlookErr) {
              aiLog("error", "ai-confirm", "outlook calendar sync failed", {
                ...logContext,
                userId: ctx.userId,
                threadId: action.thread_id,
              }, { actionId: action.id, eventId, error: outlookErr });
            }
          }

          const orgSlug = typeof payload.orgSlug === "string" && payload.orgSlug.length > 0 ? payload.orgSlug : null;
          const eventPath = orgSlug ? calendarEventDetailPath(orgSlug, payload.event_id) : null;
          const eventTitle = typeof result.event.title === "string" ? result.event.title : payload.title;
          await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
            user_id: ctx.userId,
            role: "assistant",
            content: eventPath ? `Updated event: [${eventTitle}](${eventPath})` : `Updated event: ${eventTitle}`,
            status: "complete",
          });

          return NextResponse.json({
            ok: true,
            event: result.event,
            actionId: action.id,
            ...normalizedConfirmMetadata({
              actionType: "update_event",
              resultEntityType: "event",
              resultEntityId: payload.event_id,
              affectedPaths: orgSlug ? [calendarListPath(orgSlug), calendarEventDetailPath(orgSlug, payload.event_id)] : [],
              affectedEvents: ["tn:ai-event-updated"],
            }),
          });
        }
        case "delete_event": {
          const payload = action.payload as DeleteEventPendingPayload;
          const result = await deleteEventFn({
            supabase: ctx.serviceSupabase,
            orgId: ctx.orgId,
            actorUserId: ctx.userId,
            eventId: payload.event_id,
            scope: payload.delete_scope,
          });

          if (!result.ok) {
            const terminal = result.status === 403 || result.status === 404;
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: terminal ? "failed" : "pending",
              expectedStatus: "confirmed",
              errorMessage: terminal ? result.error : null,
            });
            return NextResponse.json(
              { error: result.error, terminal, actionStatus: terminal ? "failed" : "pending" },
              { status: result.status },
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "event",
            resultEntityId: payload.event_id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          for (const eventId of result.affectedEventIds) {
            try {
              await syncEventToUsersFn(ctx.serviceSupabase, ctx.orgId, eventId, "delete");
            } catch (syncErr) {
              aiLog("error", "ai-confirm", "google calendar sync failed", {
                ...logContext,
                userId: ctx.userId,
                threadId: action.thread_id,
              }, { actionId: action.id, eventId, error: syncErr });
            }
            try {
              await syncOutlookEventToUsersFn(ctx.serviceSupabase, ctx.orgId, eventId, "delete");
            } catch (outlookErr) {
              aiLog("error", "ai-confirm", "outlook calendar sync failed", {
                ...logContext,
                userId: ctx.userId,
                threadId: action.thread_id,
              }, { actionId: action.id, eventId, error: outlookErr });
            }
          }

          const orgSlug = typeof payload.orgSlug === "string" && payload.orgSlug.length > 0 ? payload.orgSlug : null;
          await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
            user_id: ctx.userId,
            role: "assistant",
            content: `Deleted event: ${payload.title}`,
            status: "complete",
          });

          return NextResponse.json({
            ok: true,
            eventId: payload.event_id,
            actionId: action.id,
            ...normalizedConfirmMetadata({
              actionType: "delete_event",
              resultEntityType: "event",
              resultEntityId: payload.event_id,
              affectedPaths: orgSlug ? [calendarListPath(orgSlug)] : [],
              affectedEvents: ["tn:ai-event-deleted"],
            }),
          });
        }
        case "member_role_change": {
          const payload = action.payload as MemberRoleChangePendingPayload;
          const result = await executeMemberRoleChange(ctx.serviceSupabase as unknown as MemberRoleChangeClient, {
            organizationId: ctx.orgId,
            actorUserId: ctx.userId,
            targetUserId: payload.target_user_id,
            role: payload.new_role,
            status: payload.new_status,
            reason: payload.reason,
            source: "ai_pending_action",
            pendingActionId: action.id,
          });

          if (result.state !== "executed") {
            const reason = result.reason as ExecuteFailureReason;
            const userSafeMessage = toUserSafeRoleChangeMessage(reason);
            const terminal = isTerminalRoleChangeError(reason);

            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: terminal ? "failed" : "pending",
              expectedStatus: "confirmed",
              errorMessage: terminal ? userSafeMessage : null,
            });
            return NextResponse.json(
              {
                error: userSafeMessage,
                terminal,
                actionStatus: terminal ? "failed" : "pending",
              },
              { status: result.state === "invalid" ? 400 : 409 },
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "member",
            resultEntityId: payload.target_user_id,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          const roleLine = result.roleChanged
            ? `${result.currentRole} -> ${result.nextRole}`
            : null;
          const statusLine = result.statusChanged
            ? `status ${result.currentStatus} -> ${result.nextStatus}`
            : null;
          const changeText = [roleLine, statusLine].filter(Boolean).join("; ");
          const content = `Changed role for ${payload.target_display_name}: ${changeText}.`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
            user_id: ctx.userId,
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
            memberUserId: payload.target_user_id,
          });
        }
        case "create_mentorship_pairing": {
          const payload = action.payload as CreateMentorshipPairingPendingPayload;
          // `ctx.serviceSupabase` runs the propose/audit; `supabase` is the
          // user-scoped admin client the accept RPC needs for auth.uid.
          type AdminPairingClient = Parameters<typeof executeAdminPairing>[0];
          const outcome = await executeAdminPairing(
            ctx.serviceSupabase as unknown as AdminPairingClient,
            supabase as unknown as AdminPairingClient,
            {
              organizationId: ctx.orgId,
              menteeUserId: payload.mentee_user_id,
              mentorUserId: payload.mentor_user_id,
              actorUserId: ctx.userId,
            },
          );

          if (!outcome.ok) {
            // "propose_failed" is transient (retry) → keep pending; the rest are
            // terminal for this attempt (mentor ineligible / already paired).
            const terminal = outcome.code !== "propose_failed";
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: terminal ? "failed" : "pending",
              expectedStatus: "confirmed",
              errorMessage: terminal ? outcome.error : null,
            });
            return NextResponse.json(
              {
                error: outcome.error,
                terminal,
                actionStatus: terminal ? "failed" : "pending",
              },
              { status: outcome.httpStatus },
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
            status: "executed",
            expectedStatus: "confirmed",
            executedAt: new Date().toISOString(),
            resultEntityType: "mentorship_pair",
            resultEntityId: outcome.pairId,
          });

          if (canUseDraftSessions) {
            await clearDraftSessionFn(ctx.serviceSupabase as unknown as DraftSessionSupabase, {
              organizationId: ctx.orgId,
              userId: ctx.userId,
              threadId: action.thread_id,
              pendingActionId: action.id,
            });
          }

          const pairingOrgSlug =
            typeof payload.orgSlug === "string" && /^[a-z0-9-]+$/i.test(payload.orgSlug)
              ? payload.orgSlug
              : null;
          const matchesLink = pairingOrgSlug
            ? ` [View in the match queue](/${pairingOrgSlug}/mentorship/admin/matches).`
            : "";
          const content =
            outcome.status === "proposed"
              ? `Proposed ${payload.mentor_name} as a mentor for ${payload.mentee_name} (match score ${payload.confidence}/100). Awaiting their acceptance.${matchesLink}`
              : `Paired ${payload.mentee_name} with ${payload.mentor_name} (match score ${payload.confidence}/100).${matchesLink}`;

          const { error: msgError } = await ctx.serviceSupabase.from("ai_messages").insert({
            thread_id: action.thread_id,
            org_id: ctx.orgId,
            user_id: ctx.userId,
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
            pairId: outcome.pairId,
            status: outcome.status,
          });
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
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

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
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
            user_id: ctx.userId,
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
            await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
              status: "pending",
              expectedStatus: "confirmed",
            });
            return NextResponse.json(
              { error: updateResult.error?.message || "Failed to revoke enterprise invite" },
              { status: 400 },
            );
          }

          await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
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
            user_id: ctx.userId,
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
        await updatePendingActionStatusFn(ctx.serviceSupabase as unknown as PendingActionSupabase, action.id, {
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
