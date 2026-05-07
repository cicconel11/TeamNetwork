import {
  DEFAULT_CALENDAR_SYNC_PREFERENCES,
  buildNotificationComposerPayload,
  getNotificationComposerErrorMessage,
  getNotificationComposerPath,
  getNotificationsPath,
  getScheduleMySettingsPath,
  getScheduleSourcesPath,
  normalizeCalendarSyncPreferences,
} from "../../src/lib/schedules/mobile-schedule-settings";

describe("mobile schedule settings helpers", () => {
  it("fills missing sync preferences with defaults", () => {
    expect(
      normalizeCalendarSyncPreferences({
        sync_game: false,
        sync_social: false,
      })
    ).toEqual({
      ...DEFAULT_CALENDAR_SYNC_PREFERENCES,
      sync_game: false,
      sync_social: false,
    });
  });

  it("returns mobile route paths for schedules and notifications", () => {
    expect(getScheduleMySettingsPath("wildcats")).toBe(
      "/(app)/wildcats/schedules/my-settings"
    );
    expect(getScheduleSourcesPath("wildcats")).toBe(
      "/(app)/wildcats/schedules/sources"
    );
    expect(getNotificationComposerPath("wildcats")).toBe(
      "/(app)/wildcats/notifications/new"
    );
    expect(getNotificationsPath("wildcats", { refresh: true })).toBe(
      "/(app)/wildcats/notifications?refresh=1"
    );
  });

  it("builds notification composer payload with trimmed values", () => {
    expect(
      buildNotificationComposerPayload("org-123", {
        title: "  Team meeting  ",
        body: "  Bring your jersey.  ",
        audience: "members",
        channel: "both",
      })
    ).toEqual({
      organizationId: "org-123",
      title: "Team meeting",
      body: "Bring your jersey.",
      audience: "members",
      channel: "both",
    });
  });

  it("omits an empty body from the composer payload", () => {
    expect(
      buildNotificationComposerPayload("org-123", {
        title: "Reminder",
        body: "   ",
        audience: "both",
        channel: "email",
      })
    ).toEqual({
      organizationId: "org-123",
      title: "Reminder",
      body: undefined,
      audience: "both",
      channel: "email",
    });
  });

  it("prefers server messages when formatting notification errors", () => {
    expect(
      getNotificationComposerErrorMessage(403, {
        message: "Organization is read-only.",
      })
    ).toBe("Organization is read-only.");
    expect(
      getNotificationComposerErrorMessage(429, {
        error: "Too many requests.",
      })
    ).toBe("Too many requests.");
  });

  it("falls back to status-based notification error copy", () => {
    expect(getNotificationComposerErrorMessage(403, null)).toBe(
      "You do not have access to send notifications."
    );
    expect(getNotificationComposerErrorMessage(429, null)).toBe(
      "You are sending notifications too quickly. Please try again."
    );
    expect(getNotificationComposerErrorMessage(500, null)).toBe(
      "The notification service is unavailable right now."
    );
  });
});
