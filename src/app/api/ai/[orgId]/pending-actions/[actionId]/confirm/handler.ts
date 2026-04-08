import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import {
  type CreateAnnouncementPendingPayload,
  type CreateDiscussionReplyPendingPayload,
  getPendingAction,
  isAuthorizedAction,
  isPendingActionExpired,
  updatePendingActionStatus,
  type CreateDiscussionThreadPendingPayload,
  type CreateEventPendingPayload,
  type CreateJobPostingPendingPayload,
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
import { calendarEventDetailPath } from "@/lib/calendar/routes";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { aiLog } from "@/lib/ai/logger";

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
            await sendAnnouncementNotification({
              supabase: ctx.serviceSupabase,
              announcementId: result.announcement.id,
              orgId: ctx.orgId,
              input: {
                ...payload,
                audience_user_ids: payload.audience_user_ids ?? null,
              },
              apiUrlBase: process.env.NEXT_PUBLIC_APP_URL || "",
            });
          } catch {
            // Notification failures should not block successful announcement creation.
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

          // Fire-and-forget: sync to Google Calendar
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
          fetch(`${appUrl}/api/calendar/event-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId: result.event.id,
              organizationId: ctx.orgId,
              operation: "create",
            }),
          }).catch(() => {});

          // Fire-and-forget: send notification
          fetch(`${appUrl}/api/notifications/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              organizationId: ctx.orgId,
              title: `New Event: ${result.event.title}`,
              body: `Event scheduled for ${payload.start_date} at ${payload.start_time}${payload.location ? `\nWhere: ${payload.location}` : ""}`,
              channel: "email",
              audience: "both",
              category: "event",
            }),
          }).catch(() => {});

          return NextResponse.json({ ok: true, event: result.event, actionId: action.id });
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
