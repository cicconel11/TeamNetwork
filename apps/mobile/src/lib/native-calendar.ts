/**
 * Native device-calendar write-out (R3).
 *
 * One calendar per organization (`TeamMeet — {orgName}`) so users can hide or
 * delete a single org's events from their device calendar without losing the
 * others. Device-event IDs are stored in AsyncStorage keyed by `${orgId}/${eventId}`
 * — local-only, no server round-trip needed for idempotency.
 *
 * v1 scope is manual "Add to calendar" from the event detail screen. Realtime
 * auto-sync, per-category preferences, and the org-removal sign-out prompt are
 * deferred to a follow-up.
 *
 * Schedule-sync regression guard: callers MUST filter `events.deleted_at IS NULL`
 * before invoking `syncEventToDevice` (per docs/REPRO.md issue #6).
 */

import * as Calendar from "expo-calendar";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CALENDAR_TITLE_PREFIX = "TeamMeet";
const STORAGE_KEY_PREFIX = "teammeet.calendar.v1";

function calendarTitleForOrg(orgName: string): string {
  return `${CALENDAR_TITLE_PREFIX} — ${orgName}`;
}

function eventIdStorageKey(orgId: string, eventId: string): string {
  return `${STORAGE_KEY_PREFIX}.event.${orgId}.${eventId}`;
}

function calendarIdStorageKey(orgId: string): string {
  return `${STORAGE_KEY_PREFIX}.calendar.${orgId}`;
}

export interface CalendarSyncEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_date: string;
  end_date: string | null;
}

/** Resolve (or create) the per-org TeamMeet calendar. Returns the calendar id. */
export async function getOrCreateAppCalendar(
  orgId: string,
  orgName: string,
  color = "#2563eb"
): Promise<string> {
  // Cache hit?
  const cached = await AsyncStorage.getItem(calendarIdStorageKey(orgId));
  if (cached) {
    // Verify it still exists in case the user deleted it from the OS.
    try {
      const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      if (all.some((c) => c.id === cached)) return cached;
    } catch {
      /* fall through */
    }
    await AsyncStorage.removeItem(calendarIdStorageKey(orgId));
  }

  // Find existing by title (handles app reinstall / cache miss).
  const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const wanted = calendarTitleForOrg(orgName);
  const existing = all.find((c) => c.title === wanted && c.allowsModifications);
  if (existing) {
    await AsyncStorage.setItem(calendarIdStorageKey(orgId), existing.id);
    return existing.id;
  }

  // Create. iOS needs a source; Android has its own concept.
  let source: Calendar.Source | undefined;
  if (Platform.OS === "ios") {
    const sources = await Calendar.getSourcesAsync();
    source =
      sources.find((s) => s.type === Calendar.SourceType.LOCAL) ??
      sources.find((s) => s.name === "iCloud") ??
      sources[0];
  }

  const id = await Calendar.createCalendarAsync({
    title: wanted,
    color,
    entityType: Calendar.EntityTypes.EVENT,
    name: wanted,
    sourceId: source?.id,
    source: source
      ? undefined
      : { isLocalAccount: true, name: "TeamMeet", type: Calendar.SourceType.LOCAL },
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
    ownerAccount: "TeamMeet",
  });
  await AsyncStorage.setItem(calendarIdStorageKey(orgId), id);
  return id;
}

/** Idempotently mirror a TeamMeet event into the per-org device calendar. */
export async function syncEventToDevice(input: {
  orgId: string;
  orgName: string;
  event: CalendarSyncEvent;
  color?: string;
}): Promise<{ deviceEventId: string }> {
  const calendarId = await getOrCreateAppCalendar(input.orgId, input.orgName, input.color);

  const start = new Date(input.event.start_date);
  // Default 1-hour block if no end_date set — better than zero-length.
  const end = input.event.end_date
    ? new Date(input.event.end_date)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const details: Partial<Calendar.Event> = {
    title: input.event.title,
    notes: input.event.description ?? undefined,
    location: input.event.location ?? undefined,
    startDate: start,
    endDate: end,
    timeZone: undefined,
  };

  const existing = await AsyncStorage.getItem(eventIdStorageKey(input.orgId, input.event.id));
  if (existing) {
    try {
      await Calendar.updateEventAsync(existing, details);
      return { deviceEventId: existing };
    } catch {
      // Stale local mapping (event deleted in OS calendar) — fall through and recreate.
      await AsyncStorage.removeItem(eventIdStorageKey(input.orgId, input.event.id));
    }
  }

  const deviceEventId = await Calendar.createEventAsync(calendarId, details);
  await AsyncStorage.setItem(eventIdStorageKey(input.orgId, input.event.id), deviceEventId);
  return { deviceEventId };
}

/** Remove a single event mirror from the device calendar. */
export async function removeEventFromDevice(
  orgId: string,
  eventId: string
): Promise<void> {
  const key = eventIdStorageKey(orgId, eventId);
  const deviceEventId = await AsyncStorage.getItem(key);
  if (!deviceEventId) return;
  try {
    await Calendar.deleteEventAsync(deviceEventId);
  } catch {
    /* OS event already gone — fine */
  }
  await AsyncStorage.removeItem(key);
}

/** Delete the entire TeamMeet — {orgName} calendar from the device. */
export async function removeOrgCalendar(orgId: string): Promise<void> {
  const id = await AsyncStorage.getItem(calendarIdStorageKey(orgId));
  if (!id) return;
  try {
    await Calendar.deleteCalendarAsync(id);
  } catch {
    /* Already gone — fine */
  }
  await AsyncStorage.removeItem(calendarIdStorageKey(orgId));
}

/** Returns true if this event currently has a device-calendar mirror. */
export async function isEventSynced(orgId: string, eventId: string): Promise<boolean> {
  const key = eventIdStorageKey(orgId, eventId);
  const value = await AsyncStorage.getItem(key);
  return value != null;
}

const CALENDAR_KEY_PREFIX = `${STORAGE_KEY_PREFIX}.calendar.`;
const EVENT_KEY_PREFIX = `${STORAGE_KEY_PREFIX}.event.`;

/** Org IDs the user has at least one TeamMeet calendar for on this device. */
export async function listSyncedOrgIds(): Promise<string[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  return allKeys
    .filter((k) => k.startsWith(CALENDAR_KEY_PREFIX))
    .map((k) => k.slice(CALENDAR_KEY_PREFIX.length));
}

/**
 * Delete every TeamMeet device calendar this user has on this device, plus all
 * local event-id mappings. Used at sign-out so the next user who signs in
 * doesn't see the previous user's events leaking into their device calendar.
 */
export async function removeAllOrgCalendars(): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const calendarKeys = allKeys.filter((k) => k.startsWith(CALENDAR_KEY_PREFIX));

  await Promise.all(
    calendarKeys.map(async (key) => {
      const id = await AsyncStorage.getItem(key);
      if (id) {
        try {
          await Calendar.deleteCalendarAsync(id);
        } catch {
          /* already gone */
        }
      }
    })
  );

  const eventKeys = allKeys.filter((k) => k.startsWith(EVENT_KEY_PREFIX));
  await AsyncStorage.multiRemove([...calendarKeys, ...eventKeys]);
}
