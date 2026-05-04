import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendNotificationBlast, sendEmail as sendEmailStub } from "@/lib/notifications";
import type { EmailParams, NotificationResult, NotificationCategory } from "@/lib/notifications";
import { sendPush, type PushType } from "@/lib/notifications/push";
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

// Supported channel inputs from clients. "push" sends Expo push only;
// "all" sends email/SMS (per existing audience preferences) AND push.
type RequestedChannel = "email" | "sms" | "both" | "push" | "all";

function shouldSendBlast(channel: RequestedChannel): boolean {
  return channel === "email" || channel === "sms" || channel === "both" || channel === "all";
}

function shouldSendPush(channel: RequestedChannel): boolean {
  return channel === "push" || channel === "all";
}

function mapBlastChannel(channel: RequestedChannel): NotificationChannel {
  if (channel === "push") return "email"; // unused when blast skipped, but keep type stable
  if (channel === "sms") return "sms";
  if (channel === "both") return "both";
  if (channel === "all") return "both";
  return "email";
}

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
    channel: z.enum(["email", "sms", "both", "push", "all"]).optional(),
    targetUserIds: uuidArray(500).optional(),
    persistNotification: z.boolean().optional(),
    category: z.enum(["announcement", "discussion", "event", "workout", "competition"]).optional(),
    // Push fan-out fields. When `channel` is "push" or "all", these drive
    // the Expo push payload + per-category preference filtering.
    pushType: z
      .enum([
        "announcement",
        "event",
        "event_reminder",
        "chat",
        "discussion",
        "mentorship",
        "donation",
        "membership",
        "notification",
      ])
      .optional(),
    pushResourceId: baseSchemas.uuid.optional(),
    orgSlug: optionalSafeString(120),
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

    let body: z.infer<typeof notificationSchema>;
    try {
      body = await validateJson(request, notificationSchema, { maxBodyBytes: 40_000 });
    } catch (err) {
      if (err instanceof ValidationError) {
        // Log validation failures so we can see which field tripped them in
        // Vercel runtime logs without forcing the client to surface details.
        console.warn(
          "[notifications/send] validation failed:",
          err.message,
          err.details,
        );
      }
      throw err;
    }
    const { announcementId, notificationId } = body;

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    let organizationId: string | null = null;
    let title: string | null = body.title ?? null;
    let bodyText = body.body ?? "";
    let audience: NotificationAudience = body.audience ?? "both";
    const requestedChannel: RequestedChannel = (body.channel ?? "email") as RequestedChannel;
    let channel: NotificationChannel = mapBlastChannel(requestedChannel);
    let targetUserIds: string[] | null = body.targetUserIds ?? null;
    let resolvedNotificationId: string | null = notificationId ?? null;
    let persistNotification = body.persistNotification !== false;
    let category: NotificationCategory | undefined = body.category;
    let pushType: PushType | undefined = body.pushType;
    let pushResourceId: string | undefined = body.pushResourceId;
    let orgSlug: string | undefined = body.orgSlug ?? undefined;

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

      // Default to announcement category for announcement-based flows
      category = category || "announcement";
      // Auto-fill push routing fields so callers don't have to repeat them.
      // Mobile receives `data.type === "announcement"` and routes to the
      // announcement detail screen via getNotificationRoute().
      pushType = pushType || "announcement";
      pushResourceId = pushResourceId || announcement.id;
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
      channel = mapBlastChannel((body.channel ?? "email") as RequestedChannel);
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
          // Carry deep-link metadata so the inbox row tap can route to the
          // same screen the push tap routes to. Falls back to "notification"
          // (inbox itself) for generic blasts without a tied resource.
          type: pushType ?? "notification",
          resource_id: pushResourceId ?? null,
          data: {
            ...(pushType ? { type: pushType } : {}),
            ...(pushResourceId ? { id: pushResourceId } : {}),
            ...(orgSlug ? { orgSlug } : {}),
          },
        } as never)
        .select("id")
        .maybeSingle();

      if (createdNotification?.id) {
        resolvedNotificationId = createdNotification.id;
        // For generic blasts where pushResourceId wasn't set, the inbox row
        // is the resource — link it to itself so mobile can mark-read on tap.
        if (shouldSendPush(requestedChannel) && !pushResourceId) {
          pushResourceId = createdNotification.id;
        }
      }
    }

    // Check Resend config before doing any send work
    if (!resend && process.env.NODE_ENV === "production") {
      return respond(
        { error: "Notifications not configured: set RESEND_API_KEY and FROM_EMAIL" },
        500,
      );
    }

    // Email + SMS fan-out (existing path). Skipped entirely when channel="push".
    const blastResult = shouldSendBlast(requestedChannel)
      ? await sendNotificationBlast({
          supabase: service,
          organizationId,
          audience,
          channel,
          title,
          body: bodyText,
          targetUserIds: targetUserIds || undefined,
          category,
          sendEmailFn: async (params: EmailParams): Promise<NotificationResult> => {
            return sendEmailWithFallback(params.to, params.subject, params.body);
          },
        })
      : { total: 0, emailCount: 0, smsCount: 0, skippedMissingContact: 0, errors: [] };

    // For generic admin blasts (channel=push|all without an explicit pushType),
    // default to the "notification" type so mobile taps land on the inbox.
    if (shouldSendPush(requestedChannel) && !pushType) {
      pushType = "notification";
      pushResourceId = pushResourceId || resolvedNotificationId || undefined;
    }

    // Resolve orgSlug from organizationId if caller didn't supply one.
    // Mobile push routing requires orgSlug; without it, taps no-op.
    if (shouldSendPush(requestedChannel) && !orgSlug) {
      const { data: org } = await service
        .from("organizations")
        .select("slug")
        .eq("id", organizationId)
        .maybeSingle();
      orgSlug = org?.slug ?? undefined;
    }

    if (shouldSendPush(requestedChannel) && !orgSlug) {
      return respond(
        { error: "Unable to resolve organization slug for push notification" },
        400,
      );
    }

    // Expo push fan-out (P0a). Inline send for now; later phases may move to
    // a worker draining notification_jobs.
    const pushResult = shouldSendPush(requestedChannel)
      ? await sendPush({
          supabase: service,
          organizationId,
          audience,
          targetUserIds: targetUserIds || undefined,
          title,
          body: bodyText,
          category,
          pushType,
          pushResourceId,
          orgSlug,
        })
      : { sent: 0, skipped: 0, errors: [] };

    if (blastResult.total === 0 && pushResult.sent === 0 && shouldSendBlast(requestedChannel)) {
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

    const sent = blastResult.emailCount + blastResult.smsCount + pushResult.sent;
    const allErrors = [...blastResult.errors, ...pushResult.errors];
    const success = allErrors.length === 0 && sent > 0;

    const payload = {
      success,
      sent,
      emailSent: blastResult.emailCount,
      smsSent: blastResult.smsCount,
      pushSent: pushResult.sent,
      total: blastResult.total,
      skipped: blastResult.skippedMissingContact + pushResult.skipped,
      errors: allErrors.length > 0 ? allErrors : undefined,
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

