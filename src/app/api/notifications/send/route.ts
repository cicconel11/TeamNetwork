import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { buildNotificationTargets } from "@/lib/notifications";
import type { NotificationAudience } from "@/types/database";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@teamnetwork.app";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { announcementId, notificationId } = body;

    if (!announcementId && !notificationId) {
      return NextResponse.json(
        { error: "announcementId or notificationId required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get current user to verify they're authorized
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let organizationId: string;
    let title: string;
    let bodyText: string;
    let audience: NotificationAudience;
    let targetUserIds: string[] | null = null;

    if (announcementId) {
      // Load announcement
      const { data: announcement, error: announcementError } = await supabase
        .from("announcements")
        .select("*, organizations(id, name)")
        .eq("id", announcementId)
        .single();

      if (announcementError || !announcement) {
        return NextResponse.json(
          { error: "Announcement not found" },
          { status: 404 }
        );
      }

      organizationId = announcement.organization_id;
      title = announcement.title;
      bodyText = announcement.body || "";
      
      // Map announcement audience to notification audience
      const announcementAudience = announcement.audience as string;
      audience =
        announcementAudience === "all" || announcementAudience === "individuals"
          ? "both"
          : announcementAudience === "active_members"
          ? "members"
          : (announcementAudience as NotificationAudience);
      
      targetUserIds = announcement.audience_user_ids;
    } else {
      // Load notification directly
      const { data: notification, error: notificationError } = await supabase
        .from("notifications")
        .select("*")
        .eq("id", notificationId)
        .single();

      if (notificationError || !notification) {
        return NextResponse.json(
          { error: "Notification not found" },
          { status: 404 }
        );
      }

      organizationId = notification.organization_id;
      title = notification.title;
      bodyText = notification.body || "";
      audience = notification.audience as NotificationAudience;
      targetUserIds = notification.target_user_ids;
    }

    // Verify user is admin of this org
    const { data: roleData } = await supabase
      .from("user_organization_roles")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!roleData || roleData.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can send notifications" },
        { status: 403 }
      );
    }

    // Build notification targets
    const { targets, stats } = await buildNotificationTargets({
      supabase,
      organizationId,
      audience,
      channel: "email",
      targetUserIds,
    });

    if (!resend) {
      console.log("[DEV] Resend not configured - would send to:", targets.length, "recipients");
      console.log("[DEV] Stats:", stats);
      
      // In development, just log and mark as sent
      if (notificationId) {
        await supabase
          .from("notifications")
          .update({ sent_at: new Date().toISOString() })
          .eq("id", notificationId);
      }

      return NextResponse.json({
        success: true,
        sent: 0,
        skipped: targets.length,
        message: "Resend not configured - running in development mode",
        stats,
      });
    }

    // Send emails via Resend
    let sentCount = 0;
    const errors: string[] = [];

    for (const target of targets) {
      if (target.email && target.channels.includes("email")) {
        try {
          await resend.emails.send({
            from: FROM_EMAIL,
            to: target.email,
            subject: title,
            text: bodyText,
            // Could add HTML template here
          });
          sentCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to send to ${target.email}: ${errorMsg}`);
          console.error(`Failed to send email to ${target.email}:`, err);
        }
      }
    }

    // Update notification record with sent_at
    if (notificationId) {
      await supabase
        .from("notifications")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", notificationId);
    }

    // If this was triggered by an announcement, also update/create the notification record
    if (announcementId) {
      // Check if notification already exists for this announcement
      const { data: existingNotif } = await supabase
        .from("notifications")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("title", title)
        .limit(1)
        .maybeSingle();

      if (existingNotif) {
        await supabase
          .from("notifications")
          .update({ sent_at: new Date().toISOString() })
          .eq("id", existingNotif.id);
      }
    }

    return NextResponse.json({
      success: true,
      sent: sentCount,
      total: targets.length,
      skipped: stats.skippedMissingContact,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Error sending notifications:", err);
    return NextResponse.json(
      { error: "Failed to send notifications" },
      { status: 500 }
    );
  }
}

