/**
 * Timezone conversion utilities for org-aware date/time handling.
 *
 * Uses Intl.DateTimeFormat (no external dependencies) to convert between
 * local org time and UTC. All orgs store events in UTC; these helpers
 * ensure form input is interpreted in the org's IANA timezone and display
 * uses the same timezone regardless of the viewer's browser.
 */

const DEFAULT_TIMEZONE = "America/New_York";

/** Returns a valid IANA timezone, falling back to defaults for null/invalid values. */
export function resolveOrgTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Format a Date into the YYYY-MM-DD value expected by input[type=date].
 * Defaults to the viewer's local timezone; an explicit timezone may be passed for tests.
 */
export function getDateInputValue(
  date: Date = new Date(),
  timeZone?: string
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}

/**
 * Interpret a date + time as being in the given IANA timezone and return a UTC ISO string.
 *
 * Example: localToUtcIso("2026-06-09", "16:00", "America/New_York") → "2026-06-09T20:00:00.000Z"
 *
 * Uses Intl.DateTimeFormat.formatToParts() to compute the UTC offset for the given
 * timezone at the given date/time, then constructs the correct UTC timestamp.
 */
export function localToUtcIso(date: string, time: string, timeZone: string): string {
  const tz = resolveOrgTimezone(timeZone);

  // Parse input components
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  // Create a rough UTC guess to seed the offset calculation
  const roughUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Use Intl to find what the local time is at this UTC instant in the target timezone
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(roughUtc);

  const v = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const localAtRoughUtc = new Date(
    Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"))
  );

  // The offset is the difference between what the local clock shows and the actual UTC
  const offsetMs = localAtRoughUtc.getTime() - roughUtc.getTime();

  // The desired UTC = local time (what the user typed) minus the offset
  const desiredLocal = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const utc = new Date(desiredLocal.getTime() - offsetMs);

  // Verify: for DST edge cases, the offset at the corrected UTC might differ.
  // Re-check and correct if needed (handles spring-forward / fall-back).
  const verifyParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(utc);

  const v2 = (type: Intl.DateTimeFormatPartTypes) =>
    Number(verifyParts.find((p) => p.type === type)?.value ?? "0");

  const localAtCorrectedUtc = new Date(
    Date.UTC(v2("year"), v2("month") - 1, v2("day"), v2("hour"), v2("minute"), v2("second"))
  );

  const correctedOffsetMs = localAtCorrectedUtc.getTime() - utc.getTime();

  if (correctedOffsetMs !== offsetMs) {
    const finalUtc = new Date(desiredLocal.getTime() - correctedOffsetMs);
    const finalIso = finalUtc.toISOString();
    const roundTrip = utcToLocalParts(finalIso, tz);

    if (roundTrip.date !== date || roundTrip.time !== time) {
      throw new RangeError(`Nonexistent local time in ${tz}: ${date} ${time}`);
    }

    return finalIso;
  }

  const utcIso = utc.toISOString();
  const roundTrip = utcToLocalParts(utcIso, tz);

  if (roundTrip.date !== date || roundTrip.time !== time) {
    throw new RangeError(`Nonexistent local time in ${tz}: ${date} ${time}`);
  }

  return utcIso;
}

/**
 * Decompose a UTC ISO string into date (YYYY-MM-DD) and time (HH:MM) in the given timezone.
 * Used to populate edit forms with the correct local values.
 */
export function utcToLocalParts(
  isoString: string,
  timeZone: string
): { date: string; time: string } {
  const tz = resolveOrgTimezone(timeZone);
  const utcDate = new Date(isoString);

  if (Number.isNaN(utcDate.getTime())) {
    return { date: "", time: "" };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(utcDate);

  const v = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  // Intl may return "24" for midnight in some environments; normalize to "00"
  const hourStr = v("hour") === "24" ? "00" : v("hour");

  return {
    date: `${v("year")}-${v("month")}-${v("day")}`,
    time: `${hourStr}:${v("minute")}`,
  };
}

/**
 * Get the weekday (0=Sun..6=Sat) of a UTC ISO string in the given timezone.
 * Used for recurrence day-of-week calculation.
 */
export function getLocalWeekday(isoString: string, timeZone: string): number {
  const tz = resolveOrgTimezone(timeZone);
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).formatToParts(date);

  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return dayMap[weekdayStr] ?? 0;
}

/**
 * Get the day of month of a UTC ISO string in the given timezone.
 * Used for monthly recurrence calculation.
 */
export function getLocalDayOfMonth(isoString: string, timeZone: string): number {
  const tz = resolveOrgTimezone(timeZone);
  const date = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    day: "numeric",
  }).formatToParts(date);

  return Number(parts.find((p) => p.type === "day")?.value ?? "1");
}
