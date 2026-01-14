import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendNotificationBlast, sendEmail as sendEmailStub } from "@/lib/notifications";
import type { EmailParams, NotificationResult } from "@/lib/notifications";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  uuidArray,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import type { NotificationAudience, NotificationChannel } from "@/types/database";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";

const validChannel = (value: string | undefined): NotificationChannel => {
  if (value === "sms" || value === "both") return value;
  return "email";
};

const mapAnnouncementAudience = (audience: string): NotificationAudience => {
  if (audience === "active_members") return "members";
  if (audience === "alumni") return "alumni";
  if (audience === "members") return "members";
  return "both";
};

const notificationSchema = z
  .object({
    announcementId: baseSchemas.uuid.optional(),
    notificationId: baseSchemas.uuid.optional(),
    organizationId: baseSchemas.uuid.optional(),
    title: optionalSafeString(200),
    body: optionalSafeString(8_000),
    audience: z.enum(["members", "alumni", "both"]).optional(),
    channel: z.enum(["email", "sms", "both"]).optional(),
    targetUserIds: uuidArray(500).optional(),
    persistNotification: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.announcementId && !value.notificationId && !value.organizationId) {
      ctx.addIssue({
        code: "custom",
        path: ["organizationId"],
        message: "announcementId, notificationId, or organizationId is required",
      });
    }
    if (!value.announcementId && !value.notificationId && !value.title) {
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "title is required when sending a new notification",
      });
    }
  });

async function sendEmailWithFallback(to: string, subject: string, bodyText: string) {
  if (resend) {
    try {
      const response = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject,
        text: bodyText,
      });

      if (response.error) {
        return { success: false, error: response.error.message };
      }

      return { success: true, messageId: response.data?.id };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMsg };
    }
  }

  return sendEmailStub({ to, subject, body: bodyText });
}

export async function POST(request: Request) {
  let respond: ((payload: unknown, status?: number) => ReturnType<typeof NextResponse.json>) | null = null;
  try {
    const supabase = await createClient();
    const service = createServiceClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "notification send",
      limitPerIp: 15,
      limitPerUser: 10,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    const body = await validateJson(request, notificationSchema, { maxBodyBytes: 40_000 });
    const { announcementId, notificationId } = body;

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    let organizationId: string | null = null;
    let title: string | null = body.title ?? null;
    let bodyText = body.body ?? "";
    let audience: NotificationAudience = body.audience ?? "both";
    let channel: NotificationChannel = body.channel ?? "email";
    let targetUserIds: string[] | null = body.targetUserIds ?? null;
    let resolvedNotificationId: string | null = notificationId ?? null;
    let persistNotification = body.persistNotification !== false;

    if (announcementId) {
      const { data: announcement, error: announcementError } = await service
        .from("announcements")
        .select("id, title, body, organization_id, audience, audience_user_ids")
        .eq("id", announcementId)
        .maybeSingle();

      if (announcementError || !announcement) {
        return respond(
          { error: "Announcement not found" },
          404,
        );
      }

      organizationId = announcement.organization_id;
      title = announcement.title;
      bodyText = announcement.body || "";
      audience = mapAnnouncementAudience(announcement.audience as string);
      targetUserIds = announcement.audience_user_ids;

      const { data: existingNotification } = await service
        .from("notifications")
        .select("id, channel, audience, target_user_ids")
        .eq("organization_id", organizationId)
        .eq("title", announcement.title)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingNotification) {
        resolvedNotificationId = existingNotification.id;
        channel = validChannel(existingNotification.channel);
        audience = (existingNotification.audience as NotificationAudience) || audience;
        targetUserIds = existingNotification.target_user_ids || targetUserIds;
      }
    } else if (notificationId) {
      const { data: notification, error: notificationError } = await service
        .from("notifications")
        .select("*")
        .eq("id", notificationId)
        .maybeSingle();

      if (notificationError || !notification) {
        return respond(
          { error: "Notification not found" },
          404,
        );
      }

      organizationId = notification.organization_id;
      title = notification.title;
      bodyText = notification.body || "";
      audience = (notification.audience as NotificationAudience) || "both";
      channel = validChannel(notification.channel);
      targetUserIds = notification.target_user_ids;
    } else {
      organizationId = body.organizationId ?? null;
      title = body.title ?? null;
      bodyText = body.body ?? "";
      const requestedAudience = body.audience as NotificationAudience | undefined;
      audience = requestedAudience || "both";
      channel = body.channel ?? "email";
      targetUserIds = body.targetUserIds ?? null;
      resolvedNotificationId = body.notificationId ?? null;
      persistNotification = body.persistNotification !== false;
    }

    if (!organizationId || !title) {
      return respond(
        { error: "Missing notification details" },
        400,
      );
    }

    const { data: roleData } = await supabase
      .from("user_organization_roles")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!roleData || roleData.role !== "admin") {
      return respond(
        { error: "Only admins can send notifications" },
        403,
      );
    }

    // Block mutations if org is in grace period (read-only mode)
    const { isReadOnly } = await checkOrgReadOnly(organizationId);
    if (isReadOnly) {
      return respond(readOnlyResponse(), 403);
    }

    if (!resolvedNotificationId && persistNotification) {
      const { data: createdNotification } = await service
        .from("notifications")
        .insert({
          organization_id: organizationId,
          title,
          body: bodyText || null,
          channel,
          audience,
          target_user_ids: targetUserIds,
          created_by_user_id: user.id,
        })
        .select("id")
        .maybeSingle();

      if (createdNotification?.id) {
        resolvedNotificationId = createdNotification.id;
      }
    }

    // Check Resend config before doing any send work
    if (!resend && process.env.NODE_ENV === "production") {
      return respond(
        { error: "Notifications not configured: set RESEND_API_KEY and FROM_EMAIL" },
        500,
      );
    }

    // Use sendNotificationBlast which handles targeting, concurrency, and sending
    const blastResult = await sendNotificationBlast({
      supabase: service,
      organizationId,
      audience,
      channel,
      title,
      body: bodyText,
      targetUserIds: targetUserIds || undefined,
      sendEmailFn: async (params: EmailParams): Promise<NotificationResult> => {
        return sendEmailWithFallback(params.to, params.subject, params.body);
      },
    });

    if (blastResult.total === 0) {
      return respond(
        {
          error: "No recipients matched the selected audience",
          total: 0,
          skipped: blastResult.skippedMissingContact,
        },
        400,
      );
    }

    if (resolvedNotificationId) {
      await service
        .from("notifications")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", resolvedNotificationId);
    }

    const sent = blastResult.emailCount + blastResult.smsCount;
    const success = blastResult.errors.length === 0 && sent > 0;

    const payload = {
      success,
      sent,
      emailSent: blastResult.emailCount,
      smsSent: blastResult.smsCount,
      total: blastResult.total,
      skipped: blastResult.skippedMissingContact,
      errors: blastResult.errors.length > 0 ? blastResult.errors : undefined,
    };

    const status = success ? 200 : 500;
    if (!success) {
      console.error("Notification send failed:", payload);
    }

    return respond(payload, status);
  } catch (err) {
    console.error("Error sending notifications:", err);
    if (err instanceof ValidationError) {
      if (respond) {
        return respond(
          {
            error: err.message,
            details: err.details,
          },
          400,
        );
      }
      return validationErrorResponse(err);
    }
    return NextResponse.json(
      { error: "Failed to send notifications" },
      { status: 500 },
    );
  }
}

