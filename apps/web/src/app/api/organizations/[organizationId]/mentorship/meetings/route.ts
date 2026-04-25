import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  baseSchemas,
  validateJson,
  ValidationError,
} from "@/lib/security/validation";
import { createMeetingSchema, type CreateMeeting } from "@/lib/mentorship/schemas";
import { createZoomMeeting } from "@/lib/zoom";
import { createMentorshipMeetingCalendarEvent } from "@/lib/mentorship/calendar";
import { getValidAccessToken } from "@/lib/google/oauth";
import { encryptToken, decryptToken } from "@/lib/crypto/token-encryption";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MentorshipMeetingErrorCode =
  | "google_calendar_required"
  | "google_calendar_reconnect_required"
  | "google_meet_creation_failed";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json(
      { error: "Invalid organization id" },
      { status: 400 }
    );
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Extract pairId from query params
  const url = new URL(req.url);
  const pairId = url.searchParams.get("pairId");

  if (!pairId) {
    return NextResponse.json(
      { error: "Missing required query parameter: pairId" },
      { status: 400 }
    );
  }

  const pairIdParsed = baseSchemas.uuid.safeParse(pairId);
  if (!pairIdParsed.success) {
    return NextResponse.json({ error: "Invalid pair id" }, { status: 400 });
  }

  // Verify caller is pair member or admin
  const serviceSupabase = createServiceClient();
  const { data: pair, error: pairError } = await serviceSupabase
    .from("mentorship_pairs")
    .select("id, mentor_user_id, mentee_user_id")
    .eq("id", pairId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (pairError) {
    console.error("[mentorship-meetings GET] Failed to fetch pair:", pairError);
    return NextResponse.json(
      { error: "Unable to verify pair access" },
      { status: 500 }
    );
  }

  if (!pair) {
    return NextResponse.json(
      { error: "Pair not found or access denied" },
      { status: 404 }
    );
  }

  const isPairMember =
    user.id === pair.mentor_user_id || user.id === pair.mentee_user_id;

  const { data: roleData } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  const isAdmin = roleData?.role === "admin";

  if (!isPairMember && !isAdmin) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403 }
    );
  }

  // Fetch meetings and split into upcoming/past
  const now = new Date().toISOString();
  const { data: meetings, error: meetingsError } = await serviceSupabase
    .from("mentorship_meetings")
    .select(
      "id, pair_id, title, scheduled_at, scheduled_end_at, duration_minutes, platform, meeting_link, calendar_event_id, calendar_sync_status, created_by, created_at, updated_at, deleted_at"
    )
    .eq("pair_id", pairId)
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true });

  if (meetingsError) {
    console.error(
      "[mentorship-meetings GET] Failed to fetch meetings:",
      meetingsError
    );
    return NextResponse.json(
      { error: "Failed to fetch meetings" },
      { status: 500 }
    );
  }

  // Decrypt meeting links
  const decryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const decryptedMeetings = (meetings || []).map((m) => ({
    ...m,
    meeting_link: m.meeting_link && decryptionKey
      ? (() => {
          try {
            return decryptToken(m.meeting_link, decryptionKey);
          } catch {
            return null;
          }
        })()
      : null,
  }));

  const upcoming = decryptedMeetings.filter(
    (m) => m.scheduled_end_at && new Date(m.scheduled_end_at) > new Date(now)
  );
  const past = decryptedMeetings
    .filter((m) => m.scheduled_end_at && new Date(m.scheduled_end_at) <= new Date(now))
    .reverse();

  return NextResponse.json({ upcoming, past });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json(
      { error: "Invalid organization id" },
      { status: 400 }
    );
  }

  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(req, {
    limitPerIp: 60,
    limitPerUser: 40,
    userId: user.id,
    feature: "mentorship meetings",
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  let body: CreateMeeting;
  try {
    body = await validateJson(req, createMeetingSchema, { maxBodyBytes: 100_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const serviceSupabase = createServiceClient();

  // Verify pair exists and not deleted
  const { data: pair, error: pairError } = await serviceSupabase
    .from("mentorship_pairs")
    .select("id, mentor_user_id, mentee_user_id, organization_id")
    .eq("id", body.pair_id)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (pairError) {
    console.error(
      "[mentorship-meetings POST] Failed to fetch pair:",
      pairError
    );
    return NextResponse.json(
      { error: "Unable to verify pair" },
      { status: 500 }
    );
  }

  if (!pair) {
    return NextResponse.json(
      { error: "Pair not found or access denied" },
      { status: 404 }
    );
  }

  // Verify caller is mentor or admin
  const { data: roleData } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  const isAdmin = roleData?.role === "admin";
  const isMentor = user.id === pair.mentor_user_id;

  if (!isMentor && !isAdmin) {
    return NextResponse.json(
      { error: "Only mentors can schedule meetings" },
      { status: 403 }
    );
  }

  // Fetch mentor and mentee emails
  const { data: mentorAuth, error: mentorAuthError } = await serviceSupabase
    .auth
    .admin.getUserById(pair.mentor_user_id);

  if (mentorAuthError || !mentorAuth.user?.email) {
    console.error(
      "[mentorship-meetings POST] Failed to fetch mentor email:",
      mentorAuthError
    );
    return NextResponse.json(
      { error: "Unable to fetch mentor email" },
      { status: 500 }
    );
  }

  const { data: menteeAuth, error: menteeAuthError } = await serviceSupabase
    .auth
    .admin.getUserById(pair.mentee_user_id);

  if (menteeAuthError || !menteeAuth.user?.email) {
    console.error(
      "[mentorship-meetings POST] Failed to fetch mentee email:",
      menteeAuthError
    );
    return NextResponse.json(
      { error: "Unable to fetch mentee email" },
      { status: 500 }
    );
  }

  // Fetch org timezone
  const { data: org, error: orgError } = await serviceSupabase
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError || !org?.timezone) {
    console.error(
      "[mentorship-meetings POST] Failed to fetch org timezone:",
      orgError
    );
    return NextResponse.json(
      { error: "Unable to fetch organization timezone" },
      { status: 500 }
    );
  }

  // Handle Zoom meeting creation
  let zoomJoinUrl: string | null = null;
  let zoomPassword: string | null = null;

  if (body.platform === "zoom") {
    const zoomResult = await createZoomMeeting({
      title: body.title,
      startAt: body.scheduled_at,
      durationMinutes: body.duration_minutes,
      timezone: org.timezone,
    });

    if (!zoomResult.ok) {
      console.error(
        "[mentorship-meetings POST] Zoom meeting creation failed:",
        zoomResult.error
      );
      return NextResponse.json(
        { error: `Zoom meeting creation failed: ${zoomResult.error}` },
        { status: 503 }
      );
    }

    zoomJoinUrl = zoomResult.joinUrl;
    zoomPassword = zoomResult.password;
  }

  let googleConnection: { id: string; status: string } | null = null;

  if (body.platform === "google_meet") {
    const { data: connection, error: googleConnectionError } =
      await serviceSupabase
        .from("user_calendar_connections")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("provider", "google")
        .maybeSingle();

    if (googleConnectionError) {
      console.error(
        "[mentorship-meetings POST] Failed to fetch Google Calendar connection:",
        googleConnectionError
      );
      return NextResponse.json(
        { error: "Unable to verify Google Calendar connection" },
        { status: 500 }
      );
    }

    googleConnection = connection;
  }

  // Best-effort for Zoom, required for Google Meet.
  const accessToken = await getValidAccessToken(supabase, user.id);

  if (body.platform === "google_meet" && !accessToken) {
    const errorCode: MentorshipMeetingErrorCode = googleConnection
      ? "google_calendar_reconnect_required"
      : "google_calendar_required";

    const error =
      errorCode === "google_calendar_required"
        ? "Connect Google Calendar before scheduling a Google Meet meeting."
        : "Reconnect Google Calendar before scheduling a Google Meet meeting.";

    return NextResponse.json(
      { error, errorCode },
      { status: errorCode === "google_calendar_required" ? 400 : 403 }
    );
  }

  // Attempt Google Calendar event creation
  let googleEventId: string | null = null;
  let meetLink: string | null = null;
  let calendarError: string | null = null;
  let calendarSyncStatus: "none" | "synced" | "failed" = "none";

  if (accessToken) {
    const calendarResult = await createMentorshipMeetingCalendarEvent(
      accessToken,
      {
        title: body.title,
        startAt: body.scheduled_at,
        durationMinutes: body.duration_minutes,
        timeZone: org.timezone,
        mentorEmail: mentorAuth.user.email,
        menteeEmail: menteeAuth.user.email,
        platform: body.platform,
        zoomJoinUrl: body.platform === "zoom" ? zoomJoinUrl || undefined : undefined,
        zoomPassword: body.platform === "zoom" ? zoomPassword || undefined : undefined,
      }
    );

    if (calendarResult.ok) {
      googleEventId = calendarResult.googleEventId;
      if (body.platform === "google_meet" && calendarResult.meetLink) {
        meetLink = calendarResult.meetLink;
      }
      calendarSyncStatus = "synced";
    } else {
      if (body.platform === "google_meet") {
        return NextResponse.json(
          {
            error:
              calendarResult.error ||
              "Google Meet link could not be created. Reconnect Google Calendar and try again.",
            errorCode: calendarResult.code as MentorshipMeetingErrorCode,
          },
          { status: 503 }
        );
      }

      calendarError = calendarResult.error;
      calendarSyncStatus = "failed";
    }
  }

  // Determine final meeting_link and calendar_sync_status
  let finalMeetingLink: string | null = null;
  let finalCalendarSyncStatus: "none" | "synced" | "failed" = calendarSyncStatus;

  if (body.platform === "zoom" && zoomJoinUrl) {
    finalMeetingLink = zoomJoinUrl;
    // If no access token, calendar status is "none"; otherwise keep current status
    if (!accessToken) {
      finalCalendarSyncStatus = "none";
    }
  } else if (body.platform === "google_meet" && meetLink) {
    finalMeetingLink = meetLink;
  }

  // Encrypt meeting_link if present
  let encryptedMeetingLink: string | null = null;
  if (finalMeetingLink) {
    try {
      const encryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
      if (!encryptionKey) {
        console.error(
          "[mentorship-meetings POST] Missing GOOGLE_TOKEN_ENCRYPTION_KEY"
        );
        return NextResponse.json(
          { error: "Server configuration error" },
          { status: 500 }
        );
      }
      encryptedMeetingLink = encryptToken(finalMeetingLink, encryptionKey);
    } catch (err) {
      console.error(
        "[mentorship-meetings POST] Failed to encrypt meeting_link:",
        err
      );
      return NextResponse.json(
        { error: "Failed to encrypt meeting link" },
        { status: 500 }
      );
    }
  }

  // Insert into mentorship_meetings
  const { data: meeting, error: insertError } = await serviceSupabase
    .from("mentorship_meetings")
    .insert({
      pair_id: body.pair_id,
      organization_id: pair.organization_id,
      title: body.title,
      scheduled_at: body.scheduled_at,
      duration_minutes: body.duration_minutes,
      platform: body.platform,
      meeting_link: encryptedMeetingLink,
      calendar_event_id: googleEventId,
      calendar_sync_status: finalCalendarSyncStatus,
      created_by: user.id,
    })
    .select(
      "id, pair_id, title, scheduled_at, scheduled_end_at, duration_minutes, platform, meeting_link, calendar_event_id, calendar_sync_status, created_by, created_at, updated_at"
    )
    .maybeSingle();

  if (insertError) {
    console.error(
      "[mentorship-meetings POST] Failed to insert meeting:",
      insertError
    );
    return NextResponse.json(
      { error: insertError.message },
      { status: 400 }
    );
  }

  if (!meeting) {
    return NextResponse.json(
      { error: "Failed to create meeting" },
      { status: 500 }
    );
  }

  const responseMeeting = {
    ...(meeting as Record<string, unknown>),
    meeting_link: finalMeetingLink,
  };

  return NextResponse.json({
    meeting: responseMeeting,
    calendarInviteSent: calendarSyncStatus === "synced",
    calendarError: calendarError || undefined,
  });
}
