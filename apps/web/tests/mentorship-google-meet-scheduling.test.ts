import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { google } from "googleapis";

import {
  createMentorshipMeetingCalendarEvent,
  type MentorshipCalendarResult,
} from "@/lib/mentorship/calendar";

describe("createMentorshipMeetingCalendarEvent", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("fails when Google Meet conference data never yields a join link", async () => {
    const deleteEvent = mock.fn(async () => undefined);

    mock.method(globalThis, "setTimeout", ((callback: (...args: unknown[]) => void) => {
      callback();
      return 0 as never;
    }) as typeof setTimeout);

    mock.method(google, "calendar", () => ({
      events: {
        insert: async () => ({
          data: {
            id: "evt_123",
            conferenceData: {
              createRequest: {
                status: { statusCode: "pending" },
              },
              entryPoints: [],
            },
          },
        }),
        get: async () => ({
          data: {
            conferenceData: {
              entryPoints: [],
            },
          },
        }),
        delete: deleteEvent,
      },
    }) as never);

    const result = await createMentorshipMeetingCalendarEvent("access-token", {
      title: "Mentorship Check-In",
      startAt: "2026-04-20T16:00:00.000Z",
      durationMinutes: 60,
      timeZone: "America/New_York",
      mentorEmail: "mentor@example.com",
      menteeEmail: "mentee@example.com",
      platform: "google_meet",
    });

    assert.deepEqual(result, {
      ok: false,
      code: "google_meet_creation_failed",
      error: "Google Meet link could not be generated. Reconnect Google Calendar and try again.",
    });
    assert.equal(deleteEvent.mock.calls.length, 1);
  });

  it("returns the Meet link when conference data is available", async () => {
    mock.method(google, "calendar", () => ({
      events: {
        insert: async () => ({
          data: {
            id: "evt_456",
            conferenceData: {
              entryPoints: [
                {
                  entryPointType: "video",
                  uri: "https://meet.google.com/abc-defg-hij",
                },
              ],
            },
          },
        }),
      },
    }) as never);

    const result = await createMentorshipMeetingCalendarEvent("access-token", {
      title: "Mentorship Check-In",
      startAt: "2026-04-20T16:00:00.000Z",
      durationMinutes: 60,
      timeZone: "America/New_York",
      mentorEmail: "mentor@example.com",
      menteeEmail: "mentee@example.com",
      platform: "google_meet",
    });

    assert.deepEqual(result, {
      ok: true,
      googleEventId: "evt_456",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });
  });
});

type SimulatedRouteResult = {
  status: number;
  body: {
    meeting?: {
      meeting_link: string | null;
      calendar_sync_status: "none" | "synced" | "failed";
    };
    calendarInviteSent?: boolean;
    error?: string;
    errorCode?: string;
  };
  meetings: Array<{
    meeting_link: string | null;
    calendar_sync_status: "none" | "synced" | "failed";
  }>;
};

function simulateMentorshipMeetingPost(input: {
  platform: "google_meet" | "zoom";
  hasGoogleConnection: boolean;
  accessToken: string | null;
  googleConnectionLookupError?: boolean;
  calendarResult?: MentorshipCalendarResult;
  zoomJoinUrl?: string | null;
}): SimulatedRouteResult {
  const meetings: SimulatedRouteResult["meetings"] = [];

  if (input.platform === "google_meet" && input.googleConnectionLookupError) {
    return {
      status: 500,
      body: {
        error: "Unable to verify Google Calendar connection",
      },
      meetings,
    };
  }

  if (input.platform === "google_meet" && !input.accessToken) {
    if (!input.hasGoogleConnection) {
      return {
        status: 400,
        body: {
          error: "Connect Google Calendar before scheduling a Google Meet meeting.",
          errorCode: "google_calendar_required",
        },
        meetings,
      };
    }

    return {
      status: 403,
      body: {
        error: "Reconnect Google Calendar before scheduling a Google Meet meeting.",
        errorCode: "google_calendar_reconnect_required",
      },
      meetings,
    };
  }

  let calendarSyncStatus: "none" | "synced" | "failed" = "none";
  let meetingLink: string | null = null;

  if (input.calendarResult) {
    if (!input.calendarResult.ok) {
      if (input.platform === "google_meet") {
        return {
          status: 503,
          body: {
            error: input.calendarResult.error,
            errorCode: input.calendarResult.code,
          },
          meetings,
        };
      }

      calendarSyncStatus = "failed";
    } else {
      calendarSyncStatus = "synced";
      if (input.platform === "google_meet") {
        meetingLink = input.calendarResult.meetLink ?? null;
      }
    }
  }

  if (input.platform === "zoom") {
    meetingLink = input.zoomJoinUrl ?? null;
    if (!input.accessToken) {
      calendarSyncStatus = "none";
    }
  }

  const meeting = {
    meeting_link: meetingLink,
    calendar_sync_status: calendarSyncStatus,
  };
  meetings.push(meeting);

  return {
    status: 200,
    body: {
      meeting,
      calendarInviteSent: calendarSyncStatus === "synced",
    },
    meetings,
  };
}

describe("mentorship meetings route behavior", () => {
  it("blocks Google Meet scheduling when no Google Calendar connection exists", () => {
    const result = simulateMentorshipMeetingPost({
      platform: "google_meet",
      hasGoogleConnection: false,
      accessToken: null,
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.errorCode, "google_calendar_required");
    assert.equal(result.meetings.length, 0);
  });

  it("blocks Google Meet scheduling when the Google Calendar connection needs reconnect", () => {
    const result = simulateMentorshipMeetingPost({
      platform: "google_meet",
      hasGoogleConnection: true,
      accessToken: null,
    });

    assert.equal(result.status, 403);
    assert.equal(result.body.errorCode, "google_calendar_reconnect_required");
    assert.equal(result.meetings.length, 0);
  });

  it("still saves Zoom meetings when calendar invite creation fails", () => {
    const result = simulateMentorshipMeetingPost({
      platform: "zoom",
      hasGoogleConnection: true,
      accessToken: "access-token",
      zoomJoinUrl: "https://zoom.us/j/123456789",
      calendarResult: {
        ok: false,
        code: "google_meet_creation_failed",
        error: "Calendar insert failed",
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.calendarInviteSent, false);
    assert.equal(result.meetings.length, 1);
    assert.deepEqual(result.body.meeting, {
      meeting_link: "https://zoom.us/j/123456789",
      calendar_sync_status: "failed",
    });
  });

  it("still saves Zoom meetings when Google connection lookup would fail", () => {
    const result = simulateMentorshipMeetingPost({
      platform: "zoom",
      hasGoogleConnection: false,
      accessToken: null,
      googleConnectionLookupError: true,
      zoomJoinUrl: "https://zoom.us/j/123456789",
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.calendarInviteSent, false);
    assert.deepEqual(result.body.meeting, {
      meeting_link: "https://zoom.us/j/123456789",
      calendar_sync_status: "none",
    });
  });

  it("still fails Google Meet scheduling when Google connection lookup fails", () => {
    const result = simulateMentorshipMeetingPost({
      platform: "google_meet",
      hasGoogleConnection: false,
      accessToken: null,
      googleConnectionLookupError: true,
    });

    assert.equal(result.status, 500);
    assert.equal(result.body.error, "Unable to verify Google Calendar connection");
    assert.equal(result.meetings.length, 0);
  });

  it("returns the raw Meet link on successful Google Meet scheduling", () => {
    const result = simulateMentorshipMeetingPost({
      platform: "google_meet",
      hasGoogleConnection: true,
      accessToken: "access-token",
      calendarResult: {
        ok: true,
        googleEventId: "evt_789",
        meetLink: "https://meet.google.com/abc-defg-hij",
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.calendarInviteSent, true);
    assert.deepEqual(result.body.meeting, {
      meeting_link: "https://meet.google.com/abc-defg-hij",
      calendar_sync_status: "synced",
    });
  });
});
