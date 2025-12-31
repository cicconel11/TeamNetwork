import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildNotificationTargets, sendEmail as sendEmailStub, sendSMS } from "@/lib/notifications";
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
  try {
    const body = await request.json();
    const { announcementId, notificationId } = body;

    if (!announcementId && !notificationId && !body.organizationId) {
      return NextResponse.json(
        { error: "announcementId, notificationId, or organizationId required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const service = createServiceClient();

    // Get current user to verify they're authorized
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let organizationId: string | null = null;
    let title: string | null = null;
    let bodyText = "";
    let audience: NotificationAudience = "both";
    let channel: NotificationChannel = "email";
    let targetUserIds: string[] | null = null;
    let resolvedNotificationId: string | null = notificationId ?? null;
    let persistNotification = true;

    if (announcementId) {
      const { data: announcement, error: announcementError } = await service
        .from("announcements")
        .select("id, title, body, organization_id, audience, audience_user_ids")
        .eq("id", announcementId)
        .maybeSingle();

      if (announcementError || !announcement) {
        return NextResponse.json(
          { error: "Announcement not found" },
          { status: 404 }
        );
      }

      organizationId = announcement.organization_id;
      title = announcement.title;
      bodyText = announcement.body || "";
      audience = mapAnnouncementAudience(announcement.audience as string);
      targetUserIds = announcement.audience_user_ids;

      // Try to locate an existing notification created alongside the announcement
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
        return NextResponse.json(
          { error: "Notification not found" },
          { status: 404 }
        );
      }

      organizationId = notification.organization_id;
      title = notification.title;
      bodyText = notification.body || "";
      audience = (notification.audience as NotificationAudience) || "both";
      channel = validChannel(notification.channel);
      targetUserIds = notification.target_user_ids;
    } else {
      organizationId = body.organizationId;
      title = body.title;
      bodyText = body.body || "";
      const requestedAudience = body.audience as NotificationAudience | undefined;
      audience = requestedAudience || "both";
      channel = validChannel(body.channel);
      targetUserIds = body.targetUserIds ?? null;
      resolvedNotificationId = body.notificationId ?? null;
      persistNotification = body.persistNotification !== false;
    }

    if (!organizationId || !title) {
      return NextResponse.json(
        { error: "Missing notification details" },
        { status: 400 }
      );
    }

    // Verify user is admin of this org
    const { data: roleData } = await supabase
      .from("user_organization_roles")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!roleData || roleData.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can send notifications" },
        { status: 403 }
      );
    }

    // Ensure we have a notification record to mark as sent (optional)
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

    // Build notification targets using service client to bypass RLS for preferences
    const { targets, stats } = await buildNotificationTargets({
      supabase: service,
      organizationId,
      audience,
      channel,
      targetUserIds: targetUserIds || undefined,
    });

    if (targets.length === 0) {
      return NextResponse.json(
        {
          error: "No recipients matched the selected audience",
          total: 0,
          skipped: stats.skippedMissingContact,
        },
        { status: 400 }
      );
    }

    // In production require configured provider; in dev allow stub
    if (!resend && process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Notifications not configured: set RESEND_API_KEY and FROM_EMAIL" },
        { status: 500 }
      );
    }

    let emailSent = 0;
    let smsSent = 0;
    const errors: string[] = [];

    for (const target of targets) {
      if (target.channels.includes("email") && target.email) {
        const result = await sendEmailWithFallback(target.email, title, bodyText);
        if (result.success) {
          emailSent += 1;
        } else if (result.error) {
          errors.push(`Email to ${target.email}: ${result.error}`);
        }
      }

      if (target.channels.includes("sms") && target.phone) {
        const smsResult = await sendSMS({
          to: target.phone,
          message: `${title}\n\n${bodyText}`,
        });

        if (smsResult.success) {
          smsSent += 1;
        } else if (smsResult.error) {
          errors.push(`SMS to ${target.phone}: ${smsResult.error}`);
        }
      }
    }

    // Update notification record with sent_at
    if (resolvedNotificationId) {
      await service
        .from("notifications")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", resolvedNotificationId);
    }

    const sent = emailSent + smsSent;
    const success = errors.length === 0 && sent > 0;

    const payload = {
      success,
      sent,
      emailSent,
      smsSent,
      total: targets.length,
      skipped: stats.skippedMissingContact,
      errors: errors.length > 0 ? errors : undefined,
    };

    const status = success ? 200 : 500;
    if (!success) {
      console.error("Notification send failed:", payload);
    }

    return NextResponse.json(payload, { status });
  } catch (err) {
    console.error("Error sending notifications:", err);
    return NextResponse.json(
      { error: "Failed to send notifications" },
      { status: 500 }
    );
  }
}
