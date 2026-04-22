/* eslint-disable @typescript-eslint/no-explicit-any */
// Domain dispatcher for the `create_event` pending action type.
//
// Second Phase 0.5 extraction following the announcements dispatcher
// (see ./announcements.ts). create_event is the largest remaining branch —
// proving the dispatcher shape handles: structured error responses with
// `code`/`details`, three best-effort side effects (Google + Outlook calendar
// sync, notification blast), and URL derivation that falls back to the
// domain-computed value when orgSlug is absent.

import { NextResponse } from "next/server";
import type { AiLogContext } from "@/lib/ai/logger";
import { aiLog } from "@/lib/ai/logger";
import type {
  clearDraftSession,
} from "@/lib/ai/draft-sessions";
import type {
  CreateEventPendingPayload,
  PendingActionRecord,
  updatePendingActionStatus,
} from "@/lib/ai/pending-actions";
import type { createEvent } from "@/lib/events/create-event";
import { calendarEventDetailPath } from "@/lib/calendar/routes";
import type { syncEventToUsers } from "@/lib/google/calendar-sync";
import type { sendNotificationBlast } from "@/lib/notifications";

export interface EventDispatcherContext {
  serviceSupabase: any;
  orgId: string;
  userId: string;
  logContext: AiLogContext;
  canUseDraftSessions: boolean;
  updatePendingActionStatusFn: typeof updatePendingActionStatus;
  clearDraftSessionFn: typeof clearDraftSession;
}

export interface EventDispatcherDeps {
  createEventFn: typeof createEvent;
  syncEventToUsersFn: typeof syncEventToUsers;
  syncOutlookEventToUsersFn: (
    supabase: Parameters<typeof syncEventToUsers>[0],
    organizationId: string,
    eventId: string,
    operation: Parameters<typeof syncEventToUsers>[3]
  ) => Promise<void>;
  sendNotificationBlastFn: typeof sendNotificationBlast;
}

export async function handleCreateEvent(
  ctx: EventDispatcherContext,
  action: PendingActionRecord<"create_event">,
  deps: EventDispatcherDeps
): Promise<NextResponse> {
  const payload = action.payload as CreateEventPendingPayload;
  const result = await deps.createEventFn({
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

    aiLog(
      "error",
      "ai-confirm",
      "create_event confirmation failed",
      {
        ...ctx.logContext,
        userId: ctx.userId,
        threadId: action.thread_id,
      },
      {
        actionId: action.id,
        attemptedEventType: payload.event_type,
        eventErrorCode: result.code ?? null,
        eventError: result.error,
        eventStatus: result.status,
        internalError: result.internalError ?? null,
      }
    );

    return NextResponse.json(
      {
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(result.details ? { details: result.details } : {}),
      },
      { status: result.status }
    );
  }

  await ctx.updatePendingActionStatusFn(ctx.serviceSupabase, action.id, {
    status: "executed",
    expectedStatus: "confirmed",
    executedAt: new Date().toISOString(),
    resultEntityType: "event",
    resultEntityId: result.event.id,
  });

  if (ctx.canUseDraftSessions) {
    await ctx.clearDraftSessionFn(ctx.serviceSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: action.thread_id,
      pendingActionId: action.id,
      draftType: "create_event",
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

  try {
    await deps.syncEventToUsersFn(ctx.serviceSupabase, ctx.orgId, result.event.id, "create");
  } catch (syncErr) {
    aiLog(
      "error",
      "ai-confirm",
      "google calendar sync failed",
      {
        ...ctx.logContext,
        userId: ctx.userId,
        threadId: action.thread_id,
      },
      { actionId: action.id, eventId: result.event.id, error: syncErr }
    );
  }

  try {
    await deps.syncOutlookEventToUsersFn(ctx.serviceSupabase, ctx.orgId, result.event.id, "create");
  } catch (outlookErr) {
    aiLog(
      "error",
      "ai-confirm",
      "outlook calendar sync failed",
      {
        ...ctx.logContext,
        userId: ctx.userId,
        threadId: action.thread_id,
      },
      { actionId: action.id, eventId: result.event.id, error: outlookErr }
    );
  }

  try {
    await deps.sendNotificationBlastFn({
      supabase: ctx.serviceSupabase,
      organizationId: ctx.orgId,
      audience: "both",
      channel: "email",
      title: `New Event: ${result.event.title}`,
      body: `Event scheduled for ${payload.start_date} at ${payload.start_time}${payload.location ? `\nWhere: ${payload.location}` : ""}`,
      category: "event",
    });
  } catch (notifyErr) {
    aiLog(
      "error",
      "ai-confirm",
      "event notification blast failed",
      {
        ...ctx.logContext,
        userId: ctx.userId,
        threadId: action.thread_id,
      },
      { actionId: action.id, eventId: result.event.id, error: notifyErr }
    );
  }

  return NextResponse.json({ ok: true, event: result.event, actionId: action.id });
}
