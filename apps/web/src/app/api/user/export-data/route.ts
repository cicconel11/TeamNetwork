import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  checkRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";
import { logDataAccess } from "@/lib/audit/data-access-log";

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
    provider: string;
    providerEmail: string | null;
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
  analyticsConsent: Array<{
    organizationId: string;
    consentState: string;
    decidedAt: string | null;
  }>;
  usageSummaries: Array<{
    organizationId: string;
    feature: string;
    visitCount: number;
    totalDurationMs: number;
    periodStart: string;
    periodEnd: string;
  }>;
  chatMessages: Array<{
    id: string;
    chatGroupId: string;
    body: string | null;
    createdAt: string | null;
    deletedAt: string | null;
  }>;
  discussionThreads: Array<{
    id: string;
    organizationId: string;
    title: string | null;
    body: string | null;
    createdAt: string | null;
    deletedAt: string | null;
  }>;
  discussionReplies: Array<{
    id: string;
    threadId: string;
    body: string | null;
    createdAt: string | null;
    deletedAt: string | null;
  }>;
  feedPosts: Array<{
    id: string;
    organizationId: string;
    body: string | null;
    createdAt: string | null;
    deletedAt: string | null;
  }>;
  feedComments: Array<{
    id: string;
    postId: string;
    body: string | null;
    createdAt: string | null;
    deletedAt: string | null;
  }>;
  aiConversations: Array<{
    threadId: string;
    messages: Array<{
      id: string;
      role: string;
      content: string | null;
      createdAt: string | null;
    }>;
  }>;
  workoutLogs: Array<{
    id: string;
    organizationId: string;
    status: string | null;
    notes: string | null;
    metrics: unknown;
    createdAt: string | null;
  }>;
  parentProfiles: Array<{
    id: string;
    organizationId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phoneNumber: string | null;
    relationship: string | null;
    studentName: string | null;
    createdAt: string | null;
  }>;
  mediaItems: Array<{
    id: string;
    organizationId: string;
    title: string | null;
    description: string | null;
    mediaType: string | null;
    mimeType: string | null;
    fileSizeBytes: number | null;
    tags: unknown;
    createdAt: string | null;
  }>;
  mediaUploads: Array<{
    id: string;
    organizationId: string;
    fileName: string | null;
    mimeType: string | null;
    fileSize: number | null;
    status: string | null;
    createdAt: string | null;
  }>;
  competitionPoints: Array<{
    id: string;
    memberId: string;
    points: number | null;
    reason: string | null;
    createdAt: string | null;
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
      analyticsConsent: [],
      usageSummaries: [],
      chatMessages: [],
      discussionThreads: [],
      discussionReplies: [],
      feedPosts: [],
      feedComments: [],
      aiConversations: [],
      workoutLogs: [],
      parentProfiles: [],
      mediaItems: [],
      mediaUploads: [],
      competitionPoints: [],
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
      .select("provider_email, provider, status, created_at")
      .eq("user_id", user.id);

    if (calendarConnections) {
      exportData.calendarConnections = calendarConnections.map((c) => ({
        provider: c.provider,
        providerEmail: c.provider_email,
        status: c.status,
        createdAt: c.created_at,
      }));
    }

    // Fetch calendar sync preferences
    const { data: calendarPrefs } = await serviceSupabase
      .from("calendar_sync_preferences")
      .select("organization_id, sync_general, sync_game, sync_meeting, sync_social, sync_fundraiser, sync_philanthropy, sync_practice, sync_workout")
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
        syncPractice: p.sync_practice ?? true,
        syncWorkout: p.sync_workout ?? true,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: submissions } = await (serviceSupabase as any)
      .from("form_submissions")
      .select("form_id, organization_id, submitted_at, data, deleted_at")
      .eq("user_id", user.id) as { data: Array<{ form_id: string; organization_id: string; submitted_at: string; data: unknown; deleted_at: string | null }> | null };

    if (submissions) {
      exportData.formSubmissions = submissions.map((s) => ({
        formId: s.form_id,
        organizationId: s.organization_id,
        submittedAt: s.submitted_at,
        data: s.data,
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
      .eq("mentor_user_id", user.id)
      .is("deleted_at", null);

    const { data: menteePairs } = await serviceSupabase
      .from("mentorship_pairs")
      .select("id, organization_id, status")
      .eq("mentee_user_id", user.id)
      .is("deleted_at", null);

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

    // Fetch analytics consent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: analyticsConsent } = await (serviceSupabase as any)
      .from("analytics_consent")
      .select("org_id, consent_state, decided_at")
      .eq("user_id", user.id);

    if (analyticsConsent) {
      exportData.analyticsConsent = analyticsConsent.map((row: { org_id: string; consent_state: string; decided_at: string | null }) => ({
        organizationId: row.org_id,
        consentState: row.consent_state,
        decidedAt: row.decided_at,
      }));
    }

    // Fetch usage summaries
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: usageSummaries } = await (serviceSupabase as any)
      .from("usage_summaries")
      .select("organization_id, feature, visit_count, total_duration_ms, period_start, period_end")
      .eq("user_id", user.id);

    if (usageSummaries) {
      exportData.usageSummaries = usageSummaries.map((s: { organization_id: string; feature: string; visit_count: number; total_duration_ms: number; period_start: string; period_end: string }) => ({
        organizationId: s.organization_id,
        feature: s.feature,
        visitCount: s.visit_count,
        totalDurationMs: s.total_duration_ms,
        periodStart: s.period_start,
        periodEnd: s.period_end,
      }));
    }

    // Fetch additional data categories in parallel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = serviceSupabase as any;

    const [
      chatMessagesResult,
      discussionThreadsResult,
      discussionRepliesResult,
      feedPostsResult,
      feedCommentsResult,
      aiThreadsResult,
      workoutLogsResult,
      parentProfilesResult,
      mediaItemsResult,
      mediaUploadsResult,
      memberIdsResult,
    ] = await Promise.all([
      svc.from("chat_messages").select("id, chat_group_id, body, created_at, deleted_at").eq("author_id", user.id),
      svc.from("discussion_threads").select("id, organization_id, title, body, created_at, deleted_at").eq("author_id", user.id),
      svc.from("discussion_replies").select("id, thread_id, body, created_at, deleted_at").eq("author_id", user.id),
      svc.from("feed_posts").select("id, organization_id, body, created_at, deleted_at").eq("author_id", user.id),
      svc.from("feed_comments").select("id, post_id, body, created_at, deleted_at").eq("author_id", user.id),
      svc.from("ai_threads").select("id").eq("user_id", user.id),
      svc.from("workout_logs").select("id, organization_id, status, notes, metrics, created_at").eq("user_id", user.id),
      svc.from("parents").select("id, organization_id, first_name, last_name, email, phone_number, relationship, student_name, created_at").eq("user_id", user.id),
      svc.from("media_items").select("id, organization_id, title, description, media_type, mime_type, file_size_bytes, tags, created_at").eq("uploaded_by", user.id),
      svc.from("media_uploads").select("id, organization_id, file_name, mime_type, file_size, status, created_at").eq("uploader_id", user.id),
      serviceSupabase.from("members").select("id").eq("user_id", user.id),
    ]);

    if (chatMessagesResult.data) {
      exportData.chatMessages = chatMessagesResult.data.map((m: { id: string; chat_group_id: string; body: string | null; created_at: string | null; deleted_at: string | null }) => ({
        id: m.id,
        chatGroupId: m.chat_group_id,
        body: m.body,
        createdAt: m.created_at,
        deletedAt: m.deleted_at,
      }));
    }

    if (discussionThreadsResult.data) {
      exportData.discussionThreads = discussionThreadsResult.data.map((t: { id: string; organization_id: string; title: string | null; body: string | null; created_at: string | null; deleted_at: string | null }) => ({
        id: t.id,
        organizationId: t.organization_id,
        title: t.title,
        body: t.body,
        createdAt: t.created_at,
        deletedAt: t.deleted_at,
      }));
    }

    if (discussionRepliesResult.data) {
      exportData.discussionReplies = discussionRepliesResult.data.map((r: { id: string; thread_id: string; body: string | null; created_at: string | null; deleted_at: string | null }) => ({
        id: r.id,
        threadId: r.thread_id,
        body: r.body,
        createdAt: r.created_at,
        deletedAt: r.deleted_at,
      }));
    }

    if (feedPostsResult.data) {
      exportData.feedPosts = feedPostsResult.data.map((p: { id: string; organization_id: string; body: string | null; created_at: string | null; deleted_at: string | null }) => ({
        id: p.id,
        organizationId: p.organization_id,
        body: p.body,
        createdAt: p.created_at,
        deletedAt: p.deleted_at,
      }));
    }

    if (feedCommentsResult.data) {
      exportData.feedComments = feedCommentsResult.data.map((c: { id: string; post_id: string; body: string | null; created_at: string | null; deleted_at: string | null }) => ({
        id: c.id,
        postId: c.post_id,
        body: c.body,
        createdAt: c.created_at,
        deletedAt: c.deleted_at,
      }));
    }

    // AI conversations: fetch threads then messages per thread
    if (aiThreadsResult.data && aiThreadsResult.data.length > 0) {
      const threadIds = aiThreadsResult.data.map((t: { id: string }) => t.id);
      const { data: aiMessages } = await svc
        .from("ai_messages")
        .select("id, thread_id, role, content, created_at")
        .in("thread_id", threadIds);

      const messagesByThread = new Map<string, Array<{ id: string; role: string; content: string | null; createdAt: string | null }>>();
      if (aiMessages) {
        for (const msg of aiMessages as Array<{ id: string; thread_id: string; role: string; content: string | null; created_at: string | null }>) {
          const existing = messagesByThread.get(msg.thread_id) ?? [];
          existing.push({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.created_at,
          });
          messagesByThread.set(msg.thread_id, existing);
        }
      }

      exportData.aiConversations = threadIds.map((tid: string) => ({
        threadId: tid,
        messages: messagesByThread.get(tid) ?? [],
      }));
    }

    if (workoutLogsResult.data) {
      exportData.workoutLogs = workoutLogsResult.data.map((w: { id: string; organization_id: string; status: string | null; notes: string | null; metrics: unknown; created_at: string | null }) => ({
        id: w.id,
        organizationId: w.organization_id,
        status: w.status,
        notes: w.notes,
        metrics: w.metrics,
        createdAt: w.created_at,
      }));
    }

    if (parentProfilesResult.data) {
      exportData.parentProfiles = parentProfilesResult.data.map((p: { id: string; organization_id: string; first_name: string | null; last_name: string | null; email: string | null; phone_number: string | null; relationship: string | null; student_name: string | null; created_at: string | null }) => ({
        id: p.id,
        organizationId: p.organization_id,
        firstName: p.first_name,
        lastName: p.last_name,
        email: p.email,
        phoneNumber: p.phone_number,
        relationship: p.relationship,
        studentName: p.student_name,
        createdAt: p.created_at,
      }));
    }

    if (mediaItemsResult.data) {
      exportData.mediaItems = mediaItemsResult.data.map((m: { id: string; organization_id: string; title: string | null; description: string | null; media_type: string | null; mime_type: string | null; file_size_bytes: number | null; tags: unknown; created_at: string | null }) => ({
        id: m.id,
        organizationId: m.organization_id,
        title: m.title,
        description: m.description,
        mediaType: m.media_type,
        mimeType: m.mime_type,
        fileSizeBytes: m.file_size_bytes,
        tags: m.tags,
        createdAt: m.created_at,
      }));
    }

    if (mediaUploadsResult.data) {
      exportData.mediaUploads = mediaUploadsResult.data.map((u: { id: string; organization_id: string; file_name: string | null; mime_type: string | null; file_size: number | null; status: string | null; created_at: string | null }) => ({
        id: u.id,
        organizationId: u.organization_id,
        fileName: u.file_name,
        mimeType: u.mime_type,
        fileSize: u.file_size,
        status: u.status,
        createdAt: u.created_at,
      }));
    }

    // Competition points: two-step via member IDs
    if (memberIdsResult.data && memberIdsResult.data.length > 0) {
      const memberIds = memberIdsResult.data.map((m: { id: string }) => m.id);
      const { data: points } = await svc
        .from("competition_points")
        .select("id, member_id, points, reason, created_at")
        .in("member_id", memberIds);

      if (points) {
        exportData.competitionPoints = points.map((p: { id: string; member_id: string; points: number | null; reason: string | null; created_at: string | null }) => ({
          id: p.id,
          memberId: p.member_id,
          points: p.points,
          reason: p.reason,
          createdAt: p.created_at,
        }));
      }
    }

    // Log data export access
    void logDataAccess({
      actorUserId: user.id,
      resourceType: "data_export",
      request,
    });

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
