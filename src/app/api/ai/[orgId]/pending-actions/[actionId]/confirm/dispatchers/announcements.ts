/* eslint-disable @typescript-eslint/no-explicit-any */
// Domain dispatcher for the `create_announcement` pending action type.
//
// Phase 0.5 pilot of the Tier 1 pre-split: extracts one case from the
// 920-LOC confirm handler so the shape is established for the other eight
// cases to follow. Each subsequent dispatcher owns its domain's confirm-time
// behaviour (CAS transitions, side effects, audit message) and is imported
// into the thin confirm/handler.ts shell.

import { NextResponse } from "next/server";
import type { AiLogContext } from "@/lib/ai/logger";
import { aiLog } from "@/lib/ai/logger";
import type {
  clearDraftSession,
} from "@/lib/ai/draft-sessions";
import type {
  CreateAnnouncementPendingPayload,
  PendingActionRecord,
  updatePendingActionStatus,
} from "@/lib/ai/pending-actions";
import type {
  createAnnouncement,
  sendAnnouncementNotification,
} from "@/lib/announcements/create-announcement";
import type { sendNotificationBlast } from "@/lib/notifications";

export interface AnnouncementDispatcherContext {
  serviceSupabase: any;
  orgId: string;
  userId: string;
  logContext: AiLogContext;
  canUseDraftSessions: boolean;
  updatePendingActionStatusFn: typeof updatePendingActionStatus;
  clearDraftSessionFn: typeof clearDraftSession;
}

export interface AnnouncementDispatcherDeps {
  createAnnouncementFn: typeof createAnnouncement;
  sendAnnouncementNotificationFn: typeof sendAnnouncementNotification;
  sendNotificationBlastFn: typeof sendNotificationBlast;
}

export async function handleCreateAnnouncement(
  ctx: AnnouncementDispatcherContext,
  action: PendingActionRecord<"create_announcement">,
  deps: AnnouncementDispatcherDeps
): Promise<NextResponse> {
  const payload = action.payload as CreateAnnouncementPendingPayload;
  const result = await deps.createAnnouncementFn({
    supabase: ctx.serviceSupabase,
    orgId: ctx.orgId,
    userId: ctx.userId,
    input: {
      ...payload,
      audience_user_ids: payload.audience_user_ids ?? null,
    },
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
    resultEntityType: "announcement",
    resultEntityId: result.announcement.id,
  });

  if (ctx.canUseDraftSessions) {
    await ctx.clearDraftSessionFn(ctx.serviceSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: action.thread_id,
      pendingActionId: action.id,
      draftType: "create_announcement",
    });
  }

  try {
    await deps.sendAnnouncementNotificationFn({
      supabase: ctx.serviceSupabase,
      announcementId: result.announcement.id,
      orgId: ctx.orgId,
      input: {
        ...payload,
        audience_user_ids: payload.audience_user_ids ?? null,
      },
      sendDirectNotification: async ({
        organizationId,
        title,
        body,
        audience,
        targetUserIds,
      }) => {
        await deps.sendNotificationBlastFn({
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
    aiLog(
      "error",
      "ai-confirm",
      "announcement notification failed",
      {
        ...ctx.logContext,
        userId: ctx.userId,
        threadId: action.thread_id,
      },
      {
        actionId: action.id,
        announcementId: result.announcement.id,
        error: notificationError,
      }
    );
  }

  const orgSlug =
    typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
      ? payload.orgSlug
      : null;
  const announcementUrl = orgSlug ? `/${orgSlug}/announcements` : null;
  const content = announcementUrl
    ? `Created announcement: [${result.announcement.title}](${announcementUrl})`
    : `Created announcement: ${result.announcement.title}`;

  const { error: msgError } = await ctx.serviceSupabase
    .from("ai_messages")
    .insert({
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
    announcement: result.announcement,
    actionId: action.id,
  });
}
