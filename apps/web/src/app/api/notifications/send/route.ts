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
  optionalSafeString,
  uuidArray,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import type { NotificationAudience, NotificationChannel } from "@/types/database";

// Channels the request body may carry. The route normalizes everything below.
type RequestedChannel = "email" | "sms" | "both" | "push" | "all" | "email_sms";

function shouldSendBlast(channel: RequestedChannel): boolean {
  return (
    channel === "email" ||
    channel === "sms" ||
    channel === "both" ||
    channel === "email_sms" ||
    channel === "all"
  );
}

function shouldSendPush(channel: RequestedChannel): boolean {
  return channel === "push" || channel === "all";
}

function mapBlastChannel(channel: RequestedChannel): NotificationChannel {
  if (channel === "push") return "email"; // unused when blast skipped, but keep type stable
  if (channel === "sms") return "sms";
  if (channel === "both" || channel === "email_sms" || channel === "all") return "both";
  return "email";
}

// Lenient UUID — accepts any 36-char hex+dash form. Postgres `gen_random_uuid()`
// emits v4 UUIDs which always pass, but zod's strict UUID regex rejects
// non-RFC4122 shapes (e.g. v0/legacy). Bad inputs simply find no row and get a
// 404, so a relaxed regex is safe.
const looseUuid = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: "Must be a 36-char UUID",
  });

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
    announcementId: looseUuid.optional(),
    notificationId: looseUuid.optional(),
    organizationId: looseUuid.optional(),
    title: optionalSafeString(200),
    body: optionalSafeString(8_000),
    // Accept the historical web values plus push variants.
    audience: z
      .enum(["members", "alumni", "both", "all", "active_members", "individuals", "parents"])
      .optional(),
    // Accept discrete values plus comma-separated combos like "email,push".
    channel: z
      .string()
      .trim()
      .max(64)
      .optional()
      .transform((raw) => {
        if (!raw) return undefined;
        const parts = raw
          .split(",")
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
        const wantsPush = parts.includes("push") || parts.includes("all");
        const blastValues = parts.filter((p) => p !== "push" && p !== "all");
        const hasEmail = blastValues.includes("email");
        const hasSms = blastValues.includes("sms");
        const wantsBoth =
          blastValues.includes("both") ||
          blastValues.includes("email_sms") ||
          (hasEmail && hasSms) ||
          parts.includes("all");
        if (wantsPush && wantsBoth) return "all";
        if (wantsPush && hasEmail) return "all";
        if (wantsPush && hasSms) return "all";
        if (wantsPush) return "push";
        if (wantsBoth) return "both";
        if (hasSms) return "sms";
        if (hasEmail) return "email";
        return undefined;
      }),
    targetUserIds: uuidArray(500).optional(),
    persistNotification: z.boolean().optional(),
    category: z.enum(["announcement", "discussion", "event", "workout", "competition"]).optional(),
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
    pushResourceId: looseUuid.optional(),
    orgSlug: optionalSafeString(120),
  })
  .passthrough()
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
    // Audience accepted from clients includes mobile-shaped values; normalize to DB enum.
    const normalizeAudience = (v: string | undefined): NotificationAudience => {
      if (v === "alumni") return "alumni";
      if (v === "members" || v === "active_members") return "members";
      return "both"; // "all" | "both" | "individuals" | "parents" | undefined
    };
    let audience: NotificationAudience = normalizeAudience(body.audience);
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
      audience = normalizeAudience(body.audience);
      channel = mapBlastChannel(requestedChannel);
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
    // Email/SMS blast — only run when channel includes them. Resend is only
    // required for the blast path; gating it earlier blocks push-only sends
    // whenever email is unconfigured.
    let runBlast = shouldSendBlast(requestedChannel);
    if (runBlast && !resend && process.env.NODE_ENV === "production") {
      // For "all", degrade gracefully so push still fires.
      // For email/sms-only, the request can't succeed — return a config error.
      if (!shouldSendPush(requestedChannel)) {
        return respond(
          { error: "Email/SMS not configured: set RESEND_API_KEY and FROM_EMAIL" },
          500,
        );
      }
      console.warn(
        "[notifications/send] Resend missing in production; degrading channel='all' to push-only",
      );
      runBlast = false;
    }

    const blastResult = runBlast
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

    // Default deep-link metadata for announcement category if caller didn't supply it.
    if (announcementId && shouldSendPush(requestedChannel)) {
      pushType = pushType || "announcement";
      pushResourceId = pushResourceId || announcementId;
    }

    // Resolve orgSlug from organizationId if caller didn't supply one — mobile
    // push routing requires it for taps to deep-link.
    if (shouldSendPush(requestedChannel) && !orgSlug && organizationId) {
      const { data: org } = await service
        .from("organizations")
        .select("slug")
        .eq("id", organizationId)
        .maybeSingle();
      orgSlug = (org as { slug?: string } | null)?.slug ?? undefined;
    }

    // Expo push fan-out.
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
      : { sent: 0, queued: 0, skipped: 0, errors: [] };

    const acceptedPushCount = pushResult.sent + pushResult.queued;

    if (
      blastResult.total === 0 &&
      acceptedPushCount === 0 &&
      shouldSendBlast(requestedChannel)
    ) {
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
    const accepted = sent + pushResult.queued;
    const allErrors = [...blastResult.errors, ...pushResult.errors];
    const success = allErrors.length === 0 && accepted > 0;

    const payload = {
      success,
      sent,
      accepted,
      emailSent: blastResult.emailCount,
      smsSent: blastResult.smsCount,
      pushSent: pushResult.sent,
      pushQueued: pushResult.queued,
      pushSkipped: pushResult.skipped,
      total: blastResult.total + pushResult.sent + pushResult.queued + pushResult.skipped,
      skipped: blastResult.skippedMissingContact,
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

