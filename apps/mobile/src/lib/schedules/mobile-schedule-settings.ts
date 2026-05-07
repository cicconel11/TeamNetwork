import type { NotificationAudience, NotificationChannel } from "@teammeet/types";

// Mobile composer accepts the wider set of channels supported by
// /api/notifications/send. Push and All are mobile-only additions on top of
// the shared NotificationChannel ("email" | "sms" | "both").
export type ComposerChannel = NotificationChannel | "push" | "all";

export interface CalendarSyncPreferences {
  sync_general: boolean;
  sync_game: boolean;
  sync_meeting: boolean;
  sync_social: boolean;
  sync_fundraiser: boolean;
  sync_philanthropy: boolean;
}

export const DEFAULT_CALENDAR_SYNC_PREFERENCES: CalendarSyncPreferences = {
  sync_general: true,
  sync_game: true,
  sync_meeting: true,
  sync_social: true,
  sync_fundraiser: true,
  sync_philanthropy: true,
};

export function normalizeCalendarSyncPreferences(
  prefs: Partial<CalendarSyncPreferences> | null | undefined
): CalendarSyncPreferences {
  return {
    sync_general: prefs?.sync_general ?? true,
    sync_game: prefs?.sync_game ?? true,
    sync_meeting: prefs?.sync_meeting ?? true,
    sync_social: prefs?.sync_social ?? true,
    sync_fundraiser: prefs?.sync_fundraiser ?? true,
    sync_philanthropy: prefs?.sync_philanthropy ?? true,
  };
}

export function getScheduleMySettingsPath(orgSlug: string) {
  return `/(app)/${orgSlug}/schedules/my-settings`;
}

export function getScheduleSourcesPath(orgSlug: string) {
  return `/(app)/${orgSlug}/schedules/sources`;
}

export function getNotificationsPath(orgSlug: string, options?: { refresh?: boolean }) {
  return options?.refresh
    ? `/(app)/${orgSlug}/notifications?refresh=1`
    : `/(app)/${orgSlug}/notifications`;
}

export function getNotificationComposerPath(orgSlug: string) {
  return `/(app)/${orgSlug}/notifications/new`;
}

export interface NotificationComposerValues {
  title: string;
  body: string;
  audience: NotificationAudience;
  channel: ComposerChannel;
}

export function buildNotificationComposerPayload(
  organizationId: string,
  values: NotificationComposerValues
) {
  return {
    organizationId,
    title: values.title.trim(),
    body: values.body.trim() || undefined,
    audience: values.audience,
    channel: values.channel,
  };
}

export function getNotificationComposerErrorMessage(
  status: number,
  payload: { error?: string; message?: string } | null | undefined
) {
  if (payload?.message) return payload.message;
  if (payload?.error) return payload.error;

  if (status === 403) return "You do not have access to send notifications.";
  if (status === 429) return "You are sending notifications too quickly. Please try again.";
  if (status >= 500) return "The notification service is unavailable right now.";
  return "Failed to send notification.";
}
