import { NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendNotificationBlast, sendEmail as sendEmailStub } from "@/lib/notifications";
import type { EmailParams, NotificationResult } from "@/lib/notifications";
import { sendExpoPushNotifications, buildPushMessage } from "@/lib/expo-push";
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
import type { NotificationAudience, NotificationChannel, UserRole } from "@teammeet/types";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";

const CHANNEL_PARTS = ["email", "sms", "both", "push"] as const;
type ChannelPart = typeof CHANNEL_PARTS[number];

type ParsedChannel = {
  raw: string;
  emailSmsChannel: NotificationChannel | null;
  pushRequested: boolean;
  isValid: boolean;
};

const parseChannel = (value: string | undefined): ParsedChannel => {
  const raw = value?.trim() || "email";
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { raw: "email", emailSmsChannel: "email", pushRequested: false, isValid: true };
  }

  const hasInvalid = parts.some((part) => !CHANNEL_PARTS.includes(part as ChannelPart));
  if (hasInvalid) {
    return { raw, emailSmsChannel: null, pushRequested: false, isValid: false };
  }

  const pushRequested = parts.includes("push");
  const baseParts = parts.filter((part) => part !== "push");
  let emailSmsChannel: NotificationChannel | null = null;

  if (baseParts.length === 0) {
    emailSmsChannel = null;
  } else if (baseParts.includes("both")) {
    emailSmsChannel = "both";
  } else if (baseParts.includes("sms")) {
    emailSmsChannel = "sms";
  } else {
    emailSmsChannel = "email";
  }

  return { raw, emailSmsChannel, pushRequested, isValid: true };
};

type PushNotificationType = "announcement" | "event";

type PushSendResult = {
  success: boolean;
  sent: number;
  failed: number;
  totalTargets: number;
  tokensFound: number;
  errors: string[];
  reason?: "no_recipients" | "no_tokens" | "all_disabled" | "org_missing";
};

async function sendMobilePushNotifications(params: {
  service: ReturnType<typeof createServiceClient>;
  organizationId: string;
  title: string;
  body: string;
  type: PushNotificationType;
  resourceId: string;
  audience: NotificationAudience;
  targetUserIds: string[] | null;
}): Promise<PushSendResult> {
  const { service, organizationId, title, body, type, resourceId, audience, targetUserIds } = params;

  const { data: org } = await service
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .single();

  if (!org) {
    return {
      success: false,
      sent: 0,
      failed: 0,
      totalTargets: 0,
      tokensFound: 0,
      errors: ["Organization not found"],
      reason: "org_missing",
    };
  }

  const audienceRoles: readonly UserRole[] =
    audience === "members"
      ? ["admin", "active_member", "member"]
      : audience === "alumni"
      ? ["alumni", "viewer"]
      : ["admin", "active_member", "member", "alumni", "viewer"];

  const membershipFilter = service
    .from("user_organization_roles")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", audienceRoles);

  const membershipsRes = targetUserIds && targetUserIds.length > 0
    ? await membershipFilter.in("user_id", targetUserIds)
    : await membershipFilter;

  const memberUserIds = (membershipsRes.data || []).map((m) => m.user_id);

  if (memberUserIds.length === 0) {
    return {
      success: true,
      sent: 0,
      failed: 0,
      totalTargets: 0,
      tokensFound: 0,
      errors: [],
      reason: "no_recipients",
    };
  }

  const { data: tokens } = await service
    .from("user_push_tokens")
    .select("expo_push_token, user_id")
    .in("user_id", memberUserIds);

  if (!tokens || tokens.length === 0) {
    return {
      success: true,
      sent: 0,
      failed: 0,
      totalTargets: memberUserIds.length,
      tokensFound: 0,
      errors: [],
      reason: "no_tokens",
    };
  }

  const { data: prefs } = await service
    .from("notification_preferences")
    .select("user_id, push_enabled")
    .eq("organization_id", organizationId)
    .in("user_id", memberUserIds);

  const prefsMap = new Map<string, boolean>();
  (prefs || []).forEach((p) => {
    if (p.user_id) prefsMap.set(p.user_id, p.push_enabled ?? true);
  });

  const enabledTokens = tokens.filter((t) => {
    const pushEnabled = prefsMap.get(t.user_id) ?? true;
    return pushEnabled;
  });

  if (enabledTokens.length === 0) {
    return {
      success: true,
      sent: 0,
      failed: 0,
      totalTargets: memberUserIds.length,
      tokensFound: tokens.length,
      errors: [],
      reason: "all_disabled",
    };
  }

  const messages = enabledTokens.map((t) =>
    buildPushMessage(t.expo_push_token, title, body, {
      type,
      orgSlug: org.slug,
      id: resourceId,
    })
  );

  const result = await sendExpoPushNotifications(messages);

  return {
    success: result.success,
    sent: result.sent,
    failed: result.failed,
    totalTargets: memberUserIds.length,
    tokensFound: tokens.length,
    errors: result.errors,
  };
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
    channel: z.string().optional(),
    pushType: z.enum(["announcement", "event"]).optional(),
    pushResourceId: baseSchemas.uuid.optional(),
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
    const parsedChannel = parseChannel(value.channel);
    if (!parsedChannel.isValid) {
      ctx.addIssue({
        code: "custom",
        path: ["channel"],
        message: "channel must be email, sms, both, push, or include push",
      });
    }
    if (value.pushType && !value.pushResourceId) {
      ctx.addIssue({
        code: "custom",
        path: ["pushResourceId"],
        message: "pushResourceId is required when pushType is provided",
      });
    }
    if (value.pushResourceId && !value.pushType) {
      ctx.addIssue({
        code: "custom",
        path: ["pushType"],
        message: "pushType is required when pushResourceId is provided",
      });
    }
    if (parsedChannel.pushRequested && !value.announcementId && !value.pushType) {
      ctx.addIssue({
        code: "custom",
        path: ["pushType"],
        message: "pushType is required when channel includes push",
      });
    }
    if (parsedChannel.pushRequested && !value.announcementId && !value.pushResourceId) {
      ctx.addIssue({
        code: "custom",
        path: ["pushResourceId"],
        message: "pushResourceId is required when channel includes push",
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

    const parsedChannel = parseChannel(body.channel);
    let rawChannel = parsedChannel.raw;
    let emailSmsChannel = parsedChannel.emailSmsChannel;
    let pushRequested = parsedChannel.pushRequested;

    let organizationId: string | null = null;
    let title: string | null = body.title ?? null;
    let bodyText = body.body ?? "";
    let audience: NotificationAudience = body.audience ?? "both";
    let targetUserIds: string[] | null = body.targetUserIds ?? null;
    let resolvedNotificationId: string | null = notificationId ?? null;
    let persistNotification = body.persistNotification !== false;
    let pushType: PushNotificationType | null = body.pushType ?? null;
    let pushResourceId: string | null = body.pushResourceId ?? null;

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
      pushType = "announcement";
      pushResourceId = announcementId;

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
        const existingChannel = parseChannel(existingNotification.channel);
        rawChannel = existingChannel.raw;
        emailSmsChannel = existingChannel.emailSmsChannel;
        pushRequested = existingChannel.pushRequested;
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
      const existingChannel = parseChannel(notification.channel);
      rawChannel = existingChannel.raw;
      emailSmsChannel = existingChannel.emailSmsChannel;
      pushRequested = existingChannel.pushRequested;
      targetUserIds = notification.target_user_ids;
    } else {
      organizationId = body.organizationId ?? null;
      title = body.title ?? null;
      bodyText = body.body ?? "";
      const requestedAudience = body.audience as NotificationAudience | undefined;
      audience = requestedAudience || "both";
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
          channel: rawChannel,
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

    const shouldSendEmail = emailSmsChannel === "email" || emailSmsChannel === "both";
    if (shouldSendEmail && !resend && process.env.NODE_ENV === "production") {
      return respond(
        { error: "Notifications not configured: set RESEND_API_KEY and FROM_EMAIL" },
        500,
      );
    }

    let blastResult = {
      total: 0,
      emailCount: 0,
      smsCount: 0,
      skippedMissingContact: 0,
      errors: [] as string[],
    };

    if (emailSmsChannel) {
      blastResult = await sendNotificationBlast({
        supabase: service,
        organizationId,
        audience,
        channel: emailSmsChannel,
        title,
        body: bodyText,
        targetUserIds: targetUserIds || undefined,
        sendEmailFn: async (params: EmailParams): Promise<NotificationResult> => {
          return sendEmailWithFallback(params.to, params.subject, params.body);
        },
      });
    }

    let pushResult: PushSendResult | null = null;
    if (pushRequested && pushType && pushResourceId) {
      pushResult = await sendMobilePushNotifications({
        service,
        organizationId,
        title,
        body: bodyText,
        type: pushType,
        resourceId: pushResourceId,
        audience,
        targetUserIds,
      });
    }

    const hasTargets = blastResult.total > 0 || (pushResult?.totalTargets ?? 0) > 0;
    if (!hasTargets) {
      return respond(
        {
          error: "No recipients matched the selected audience",
          total: 0,
          skipped: blastResult.skippedMissingContact,
        },
        400,
      );
    }

    const pushSent = pushResult?.sent ?? 0;
    const pushFailed = pushResult?.failed ?? 0;
    const sent = blastResult.emailCount + blastResult.smsCount + pushSent;

    if (resolvedNotificationId && sent > 0) {
      await service
        .from("notifications")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", resolvedNotificationId);
    }

    const pushErrors = pushResult?.errors ?? [];
    const errors = [...blastResult.errors, ...pushErrors];
    const success = errors.length === 0 && sent > 0;

    const payload = {
      success,
      sent,
      emailSent: blastResult.emailCount,
      smsSent: blastResult.smsCount,
      pushSent,
      pushFailed,
      total: blastResult.total,
      pushTargets: pushResult?.totalTargets,
      pushTokensFound: pushResult?.tokensFound,
      pushReason: pushResult?.reason,
      skipped: blastResult.skippedMissingContact,
      errors: errors.length > 0 ? errors : undefined,
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
