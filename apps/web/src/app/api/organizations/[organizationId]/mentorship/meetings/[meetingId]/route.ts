import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { deleteMentorshipMeetingCalendarEvent } from "@/lib/mentorship/calendar";
import { getValidAccessToken } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; meetingId: string }>;
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { organizationId, meetingId } = await params;

  // Validate UUIDs
  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json(
      { error: "Invalid organization id" },
      { status: 400 }
    );
  }

  const meetingIdParsed = baseSchemas.uuid.safeParse(meetingId);
  if (!meetingIdParsed.success) {
    return NextResponse.json(
      { error: "Invalid meeting id" },
      { status: 400 }
    );
  }

  // Authenticate user
  const { supabase, user } = await createAuthenticatedApiClient(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = createServiceClient();

  // Fetch the meeting
  const { data: meeting, error: meetingError } = await serviceSupabase
    .from("mentorship_meetings")
    .select(
      "id, pair_id, organization_id, calendar_event_id, created_by, deleted_at"
    )
    .eq("id", meetingId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (meetingError) {
    console.error(
      "[mentorship-meetings DELETE] Failed to fetch meeting:",
      meetingError
    );
    return NextResponse.json(
      { error: "Unable to fetch meeting" },
      { status: 500 }
    );
  }

  if (!meeting) {
    return NextResponse.json(
      { error: "Meeting not found or access denied" },
      { status: 404 }
    );
  }

  // Fetch the pair to verify caller is mentor or admin
  const { data: pair, error: pairError } = await serviceSupabase
    .from("mentorship_pairs")
    .select("id, mentor_user_id, mentee_user_id")
    .eq("id", meeting.pair_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (pairError) {
    console.error(
      "[mentorship-meetings DELETE] Failed to fetch pair:",
      pairError
    );
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

  // Check if caller is mentor or admin
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
      { error: "Access denied" },
      { status: 403 }
    );
  }

  // Soft-delete the meeting
  const now = new Date().toISOString();
  const { data: deletedMeeting, error: deleteError } = await serviceSupabase
    .from("mentorship_meetings")
    .update({
      deleted_at: now,
      updated_at: now,
    })
    .eq("id", meetingId)
    .select(
      "id, pair_id, title, scheduled_at, scheduled_end_at, duration_minutes, platform, meeting_link, calendar_event_id, calendar_sync_status, created_by, created_at, updated_at"
    )
    .maybeSingle();

  if (deleteError) {
    console.error(
      "[mentorship-meetings DELETE] Failed to soft-delete meeting:",
      deleteError
    );
    return NextResponse.json(
      { error: "Failed to delete meeting" },
      { status: 500 }
    );
  }

  if (!deletedMeeting) {
    return NextResponse.json(
      { error: "Failed to delete meeting" },
      { status: 500 }
    );
  }

  // Best-effort calendar cleanup (non-blocking)
  if (meeting.calendar_event_id) {
    const accessToken = await getValidAccessToken(supabase, meeting.created_by);
    if (accessToken) {
      try {
        await deleteMentorshipMeetingCalendarEvent(
          accessToken,
          meeting.calendar_event_id
        );
      } catch (err) {
        // Log error but don't fail the response
        console.error(
          "[mentorship-meetings DELETE] Calendar event deletion failed:",
          err instanceof Error ? err.message : "Unknown error"
        );
      }
    }
  }

  // Always return 200 regardless of calendar cleanup result
  return NextResponse.json({ meeting: deletedMeeting });
}
