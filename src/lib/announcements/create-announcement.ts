import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { createAnnouncementSchema, type CreateAnnouncementForm } from "@/lib/schemas/content";

type DatabaseClient = SupabaseClient<Database>;

export interface CreateAnnouncementRequest {
  supabase: DatabaseClient;
  orgId: string;
  userId: string;
  input: CreateAnnouncementForm;
}

export type CreateAnnouncementResult =
  | {
      ok: true;
      status: 201;
      announcement: Database["public"]["Tables"]["announcements"]["Row"];
    }
  | {
      ok: false;
      status: 400 | 403 | 500;
      error: string;
      details?: string[];
    };

export interface SendAnnouncementNotificationRequest {
  supabase: DatabaseClient;
  announcementId: string;
  orgId: string;
  input: CreateAnnouncementForm;
  fetchImpl?: typeof fetch;
  apiUrlBase?: string;
  sendDirectNotification?: (input: {
    notificationId: string;
    announcementId: string;
    organizationId: string;
    title: string;
    body: string;
    audience: "both" | "members" | "alumni";
    targetUserIds: string[] | null;
  }) => Promise<void>;
}

function mapAnnouncementAudienceToNotificationAudience(
  audience: CreateAnnouncementForm["audience"]
): "both" | "members" | "alumni" {
  if (audience === "all" || audience === "individuals") {
    return "both";
  }
  if (audience === "active_members") {
    return "members";
  }
  return audience;
}

export async function createAnnouncement(
  request: CreateAnnouncementRequest
): Promise<CreateAnnouncementResult> {
  const validationResult = createAnnouncementSchema.safeParse(request.input);
  if (!validationResult.success) {
    const details = validationResult.error.issues.map(
      (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`
    );
    return {
      ok: false,
      status: 400,
      error: "Validation failed",
      details,
    };
  }

  const membership = await getOrgMembership(request.supabase, request.userId, request.orgId);
  if (!membership || membership.role !== "admin") {
    return { ok: false, status: 403, error: "You do not have permission to create announcements" };
  }

  const { data: announcement, error } = await request.supabase
    .from("announcements")
    .insert({
      organization_id: request.orgId,
      title: validationResult.data.title,
      body: validationResult.data.body || null,
      is_pinned: validationResult.data.is_pinned,
      published_at: new Date().toISOString(),
      created_by_user_id: request.userId,
      audience: validationResult.data.audience,
      audience_user_ids:
        validationResult.data.audience === "individuals"
          ? validationResult.data.audience_user_ids ?? null
          : null,
    })
    .select("*")
    .single();

  if (error || !announcement) {
    return { ok: false, status: 500, error: "Failed to create announcement" };
  }

  return {
    ok: true,
    status: 201,
    announcement,
  };
}

export async function sendAnnouncementNotification(
  request: SendAnnouncementNotificationRequest
): Promise<void> {
  if (!request.input.send_notification) {
    return;
  }

  const audienceUserIds = request.input.audience === "individuals"
    ? request.input.audience_user_ids ?? null
    : null;

  const { data: notification } = await request.supabase
    .from("notifications")
    .insert({
      organization_id: request.orgId,
      title: request.input.title,
      body: request.input.body || null,
      channel: "email",
      audience: mapAnnouncementAudienceToNotificationAudience(request.input.audience),
      target_user_ids: audienceUserIds,
    })
    .select()
    .single();

  if (!notification) {
    return;
  }

  if (request.sendDirectNotification) {
    await request.sendDirectNotification({
      notificationId: notification.id,
      announcementId: request.announcementId,
      organizationId: request.orgId,
      title: request.input.title,
      body: request.input.body || "",
      audience: mapAnnouncementAudienceToNotificationAudience(request.input.audience),
      targetUserIds: audienceUserIds,
    });

    await request.supabase
      .from("notifications")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", notification.id);
    return;
  }

  const fetchImpl = request.fetchImpl ?? fetch;
  const endpoint = request.apiUrlBase
    ? `${request.apiUrlBase}/api/notifications/send`
    : "/api/notifications/send";

  await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      announcementId: request.announcementId,
      category: "announcement",
    }),
  });
}
