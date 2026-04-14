import { google } from "googleapis";
import { randomUUID } from "crypto";

export type MentorshipCalendarErrorCode = "google_meet_creation_failed";

export type MentorshipCalendarResult =
  | { ok: true; googleEventId: string; meetLink?: string }
  | { ok: false; code: MentorshipCalendarErrorCode; error: string };

export async function createMentorshipMeetingCalendarEvent(
  accessToken: string,
  params: {
    title: string;
    startAt: string;           // ISO 8601 with offset
    durationMinutes: number;
    timeZone: string;          // IANA timezone
    mentorEmail: string;
    menteeEmail: string;
    platform: "google_meet" | "zoom";
    zoomJoinUrl?: string;
    zoomPassword?: string;
  }
): Promise<MentorshipCalendarResult> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: "v3", auth });

  const startDate = new Date(params.startAt);
  const endDate = new Date(startDate.getTime() + params.durationMinutes * 60_000);

  const requestBody: Record<string, unknown> = {
    summary: params.title,
    start: { dateTime: startDate.toISOString(), timeZone: params.timeZone },
    end: { dateTime: endDate.toISOString(), timeZone: params.timeZone },
    attendees: [{ email: params.mentorEmail }, { email: params.menteeEmail }],
    guestsCanModify: false,
    reminders: { useDefault: true },
  };

  if (params.platform === 'google_meet') {
    requestBody.conferenceData = {
      createRequest: {
        requestId: randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };
  } else {
    requestBody.location = params.zoomJoinUrl;
    requestBody.description =
      `Platform: Zoom\nJoin URL: ${params.zoomJoinUrl}` +
      (params.zoomPassword ? `\nPassword: ${params.zoomPassword}` : "");
  }

  try {
    const response = await calendar.events.insert({
      calendarId: "primary",
      // conferenceDataVersion MUST be a query param — silently ignored if put in body
      conferenceDataVersion: params.platform === 'google_meet' ? 1 : 0,
      sendUpdates: "all",
      requestBody,
    });

    const event = response.data;

    // conferenceData creation is async — check for "pending" status and retry up to 3x
    let meetLink =
      event.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === 'video'
      )?.uri ?? undefined;

    if (
      params.platform === "google_meet" &&
      event.conferenceData?.createRequest?.status?.statusCode === "pending" &&
      !meetLink
    ) {
      for (let attempt = 0; attempt < 3 && !meetLink; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        const retry = await calendar.events.get({
          calendarId: "primary",
          eventId: event.id!,
        });
        meetLink =
          retry.data.conferenceData?.entryPoints?.find(
            (e) => e.entryPointType === "video"
          )?.uri ?? undefined;
      }
    }

    if (params.platform === "google_meet" && !meetLink) {
      if (event.id) {
        try {
          await calendar.events.delete({
            calendarId: "primary",
            eventId: event.id,
            sendUpdates: "all",
          });
        } catch {
          // Best-effort cleanup for orphaned calendar events.
        }
      }

      return {
        ok: false,
        code: "google_meet_creation_failed",
        error: "Google Meet link could not be generated. Reconnect Google Calendar and try again.",
      };
    }

    return { ok: true, googleEventId: event.id ?? '', meetLink };
  } catch (err: unknown) {
    // Sanitize error before logging — GaxiosError includes request headers with auth token
    const msg = err instanceof Error ? err.message : "Unknown Google Calendar error";
    return {
      ok: false,
      code: "google_meet_creation_failed",
      error: msg,
    };
  }
}

export async function deleteMentorshipMeetingCalendarEvent(
  accessToken: string,
  calendarEventId: string
): Promise<void> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const calendar = google.calendar({ version: "v3", auth });
  try {
    await calendar.events.delete({
      calendarId: "primary",
      eventId: calendarEventId,
      sendUpdates: "all",
    });
  } catch {
    // Best-effort: if deletion fails (event already removed, token expired), log and continue
  }
}
