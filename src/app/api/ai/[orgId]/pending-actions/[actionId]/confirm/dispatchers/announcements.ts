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
  EditAnnouncementPendingPayload,
  PendingActionRecord,
  updatePendingActionStatus,
} from "@/lib/ai/pending-actions";
import type {
  createAnnouncement,
  sendAnnouncementNotification,
} from "@/lib/announcements/create-announcement";
import type { updateAnnouncement } from "@/lib/announcements/update-announcement";
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

// ─── Edit dispatcher ────────────────────────────────────────────────────
//
// Phase 2a of the Tier 1 edit/delete plan. Mirrors handleCreateAnnouncement's
// ctx + deps shape, but calls the updateAnnouncement domain primitive and
// surfaces the structured DomainResult failure codes (403 forbidden, 404
// not_found, 409 stale_version, 422 invariant_violation, 500 update_failed)
// directly into the HTTP response. The primitive enforces both the admin
// permission check and the optimistic-concurrency `expectedUpdatedAt` token
// captured at prepare time, so this dispatcher has no additional auth or
// race logic — it's a thin CAS + primitive + ai_messages shell.

export interface EditAnnouncementDispatcherDeps {
  updateAnnouncementFn: typeof updateAnnouncement;
}

export async function handleEditAnnouncement(
  ctx: AnnouncementDispatcherContext,
  action: PendingActionRecord<"edit_announcement">,
  deps: EditAnnouncementDispatcherDeps
): Promise<NextResponse> {
  const payload = action.payload as EditAnnouncementPendingPayload;
  const result = await deps.updateAnnouncementFn({
    supabase: ctx.serviceSupabase,
    orgId: ctx.orgId,
    userId: ctx.userId,
    targetId: payload.targetId,
    patch: payload.patch,
    expectedUpdatedAt: payload.expectedUpdatedAt ?? null,
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
    resultEntityId: result.value.id,
  });

  if (ctx.canUseDraftSessions) {
    await ctx.clearDraftSessionFn(ctx.serviceSupabase, {
      organizationId: ctx.orgId,
      userId: ctx.userId,
      threadId: action.thread_id,
      pendingActionId: action.id,
      draftType: "edit_announcement",
    });
  }

  const orgSlug =
    typeof payload.orgSlug === "string" && payload.orgSlug.length > 0
      ? payload.orgSlug
      : null;
  const announcementUrl = orgSlug ? `/${orgSlug}/announcements` : null;
  const displayTitle = result.value.title ?? payload.targetTitle ?? "announcement";
  const content = announcementUrl
    ? `Updated announcement: [${displayTitle}](${announcementUrl})`
    : `Updated announcement: ${displayTitle}`;

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
    announcement: result.value,
    actionId: action.id,
  });
}
