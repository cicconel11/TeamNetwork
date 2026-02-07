import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  checkRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";

interface UserDataExport {
  exportedAt: string;
  user: {
    id: string;
    email: string | null;
    createdAt: string | null;
  };
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    role: string;
    status: string;
    createdAt: string | null;
  }>;
  notificationPreferences: Array<{
    organizationId: string;
    emailAddress: string | null;
    emailEnabled: boolean;
  }>;
  calendarConnections: Array<{
    googleEmail: string;
    status: string;
    createdAt: string | null;
  }>;
  calendarSyncPreferences: Array<{
    organizationId: string;
    syncGeneral: boolean;
    syncGame: boolean;
    syncMeeting: boolean;
    syncSocial: boolean;
    syncFundraiser: boolean;
    syncPhilanthropy: boolean;
  }>;
  eventRsvps: Array<{
    eventId: string;
    status: string;
    createdAt: string | null;
  }>;
  formSubmissions: Array<{
    formId: string;
    organizationId: string;
    submittedAt: string | null;
    data: unknown;
  }>;
  chatGroupMemberships: Array<{
    chatGroupId: string;
    role: string;
    joinedAt: string | null;
    removedAt: string | null;
  }>;
  mentorshipPairs: Array<{
    id: string;
    role: "mentor" | "mentee";
    organizationId: string;
    status: string;
  }>;
}

/**
 * GET /api/user/export-data
 *
 * Exports all user data as JSON for GDPR/COPPA compliance.
 *
 * This endpoint:
 * 1. Gathers all data associated with the user across all tables
 * 2. Returns a JSON blob containing all PII and user-generated content
 * 3. Rate limited to prevent abuse (1 export per day)
 *
 * GDPR Article 20 - Right to data portability:
 * Users have the right to receive their personal data in a
 * structured, commonly used and machine-readable format.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const serviceSupabase = createServiceClient();

    const { data: { user } } = await supabase.auth.getUser();

    // Rate limit: 1 export per day per user
    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "data export",
      limitPerIp: 3,
      limitPerUser: 1,
      windowMs: DAY_MS,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: rateLimit.headers }
      );
    }

    // Gather all user data
    const exportData: UserDataExport = {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email ?? null,
        createdAt: user.created_at ?? null,
      },
      memberships: [],
      notificationPreferences: [],
      calendarConnections: [],
      calendarSyncPreferences: [],
      eventRsvps: [],
      formSubmissions: [],
      chatGroupMemberships: [],
      mentorshipPairs: [],
    };

    // Fetch memberships with organization names
    const { data: memberships } = await serviceSupabase
      .from("user_organization_roles")
      .select("organization_id, role, status, created_at, organizations(name)")
      .eq("user_id", user.id);

    if (memberships) {
      exportData.memberships = memberships.map((m) => {
        const org = m.organizations as { name: string } | { name: string }[] | null;
        const orgName = Array.isArray(org) ? org[0]?.name : org?.name;
        return {
          organizationId: m.organization_id,
          organizationName: orgName || "Unknown",
          role: m.role,
          status: m.status,
          createdAt: m.created_at,
        };
      });
    }

    // Fetch notification preferences
    const { data: notificationPrefs } = await serviceSupabase
      .from("notification_preferences")
      .select("organization_id, email_address, email_enabled")
      .eq("user_id", user.id);

    if (notificationPrefs) {
      exportData.notificationPreferences = notificationPrefs.map((p) => ({
        organizationId: p.organization_id,
        emailAddress: p.email_address,
        emailEnabled: p.email_enabled ?? false,
      }));
    }

    // Fetch calendar connections
    const { data: calendarConnections } = await serviceSupabase
      .from("user_calendar_connections")
      .select("google_email, status, created_at")
      .eq("user_id", user.id);

    if (calendarConnections) {
      exportData.calendarConnections = calendarConnections.map((c) => ({
        googleEmail: c.google_email,
        status: c.status,
        createdAt: c.created_at,
      }));
    }

    // Fetch calendar sync preferences
    const { data: calendarPrefs } = await serviceSupabase
      .from("calendar_sync_preferences")
      .select("organization_id, sync_general, sync_game, sync_meeting, sync_social, sync_fundraiser, sync_philanthropy")
      .eq("user_id", user.id);

    if (calendarPrefs) {
      exportData.calendarSyncPreferences = calendarPrefs.map((p) => ({
        organizationId: p.organization_id,
        syncGeneral: p.sync_general ?? true,
        syncGame: p.sync_game ?? true,
        syncMeeting: p.sync_meeting ?? true,
        syncSocial: p.sync_social ?? true,
        syncFundraiser: p.sync_fundraiser ?? true,
        syncPhilanthropy: p.sync_philanthropy ?? true,
      }));
    }

    // Fetch event RSVPs
    const { data: rsvps } = await serviceSupabase
      .from("event_rsvps")
      .select("event_id, status, created_at")
      .eq("user_id", user.id);

    if (rsvps) {
      exportData.eventRsvps = rsvps.map((r) => ({
        eventId: r.event_id,
        status: r.status,
        createdAt: r.created_at,
      }));
    }

    // Fetch form submissions
    const { data: submissions } = await serviceSupabase
      .from("form_submissions")
      .select("form_id, organization_id, submitted_at, responses")
      .eq("user_id", user.id);

    if (submissions) {
      exportData.formSubmissions = submissions.map((s) => ({
        formId: s.form_id,
        organizationId: s.organization_id,
        submittedAt: s.submitted_at,
        data: s.responses,
      }));
    }

    // Fetch chat group memberships
    const { data: chatMembers } = await serviceSupabase
      .from("chat_group_members")
      .select("chat_group_id, role, joined_at, removed_at")
      .eq("user_id", user.id);

    if (chatMembers) {
      exportData.chatGroupMemberships = chatMembers.map((m) => ({
        chatGroupId: m.chat_group_id,
        role: m.role,
        joinedAt: m.joined_at,
        removedAt: m.removed_at,
      }));
    }

    // Fetch mentorship pairs (as mentor or mentee)
    const { data: mentorPairs } = await serviceSupabase
      .from("mentorship_pairs")
      .select("id, organization_id, status")
      .eq("mentor_user_id", user.id);

    const { data: menteePairs } = await serviceSupabase
      .from("mentorship_pairs")
      .select("id, organization_id, status")
      .eq("mentee_user_id", user.id);

    if (mentorPairs) {
      exportData.mentorshipPairs.push(
        ...mentorPairs.map((p) => ({
          id: p.id,
          role: "mentor" as const,
          organizationId: p.organization_id,
          status: p.status,
        }))
      );
    }

    if (menteePairs) {
      exportData.mentorshipPairs.push(
        ...menteePairs.map((p) => ({
          id: p.id,
          role: "mentee" as const,
          organizationId: p.organization_id,
          status: p.status,
        }))
      );
    }

    // Send notification email
    if (resend && user.email) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: user.email,
        subject: "Your Data Export - TeamNetwork",
        text: `
Hello,

Your data export from TeamNetwork has been generated.

This export contains all personal data associated with your account as required by GDPR Article 20 (Right to data portability).

If you did not request this export, please secure your account by changing your password immediately.

Thank you for using TeamNetwork.
        `.trim(),
      });
    }

    // Return as downloadable JSON
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        ...rateLimit.headers,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="teamnetwork-data-export-${new Date().toISOString().split("T")[0]}.json"`,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to export user data" },
      { status: 500 }
    );
  }
}
