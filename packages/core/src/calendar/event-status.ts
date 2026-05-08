/**
 * Event status + countdown utilities shared by web and mobile.
 *
 * Pure functions (no React) so they can be unit-tested with a fake `now`
 * and consumed identically from a React Server Component, a Next.js client
 * component, or a React Native screen.
 */

const DEFAULT_DURATION_MINUTES = 60;
const STARTING_SOON_THRESHOLD_SECONDS = 15 * 60;
export const DEFAULT_GRACE_PERIOD_MINUTES = 30;

export type EventStatus =
  | { kind: "upcoming"; secondsUntilStart: number }
  | { kind: "starting-soon"; secondsUntilStart: number }
  | { kind: "live"; secondsUntilEnd: number | null }
  | { kind: "recently-ended"; secondsSinceEnd: number }
  | { kind: "past" };

function toMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function getEventStatus(
  startAt: string | Date,
  endAt: string | Date | null,
  now: Date,
  gracePeriodMinutes: number = DEFAULT_GRACE_PERIOD_MINUTES,
): EventStatus {
  const startMs = toMs(startAt);
  const nowMs = now.getTime();

  if (startMs === null) {
    return { kind: "past" };
  }

  const explicitEndMs = toMs(endAt);
  const effectiveEndMs =
    explicitEndMs !== null && explicitEndMs > startMs
      ? explicitEndMs
      : startMs + DEFAULT_DURATION_MINUTES * 60 * 1000;

  const graceMs = Math.max(0, gracePeriodMinutes) * 60 * 1000;

  if (nowMs < startMs) {
    const secondsUntilStart = Math.ceil((startMs - nowMs) / 1000);
    if (secondsUntilStart <= STARTING_SOON_THRESHOLD_SECONDS) {
      return { kind: "starting-soon", secondsUntilStart };
    }
    return { kind: "upcoming", secondsUntilStart };
  }

  if (nowMs < effectiveEndMs) {
    const secondsUntilEnd =
      explicitEndMs !== null
        ? Math.ceil((effectiveEndMs - nowMs) / 1000)
        : null;
    return { kind: "live", secondsUntilEnd };
  }

  if (nowMs < effectiveEndMs + graceMs) {
    return {
      kind: "recently-ended",
      secondsSinceEnd: Math.floor((nowMs - effectiveEndMs) / 1000),
    };
  }

  return { kind: "past" };
}

/**
 * Compact relative-time formatter for countdowns.
 * Negative values are treated as absolute (caller decides "in" vs "ago" prefix).
 *
 *   45  -> "45s"
 *   90  -> "1m"
 *   720 -> "12m"
 *   3900 -> "1h 5m"
 *   90000 -> "1d 1h"
 */
export function formatCountdown(seconds: number): string {
  const abs = Math.max(0, Math.floor(Math.abs(seconds)));
  if (abs < 60) return `${abs}s`;
  const totalMinutes = Math.floor(abs / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const remMinutes = totalMinutes % 60;
    return remMinutes === 0 ? `${totalHours}h` : `${totalHours}h ${remMinutes}m`;
  }
  const totalDays = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours === 0 ? `${totalDays}d` : `${totalDays}d ${remHours}h`;
}

/**
 * Render a complete badge label for an EventStatus, including direction.
 */
export function describeEventStatus(status: EventStatus): string {
  switch (status.kind) {
    case "upcoming":
    case "starting-soon":
      return `Starts in ${formatCountdown(status.secondsUntilStart)}`;
    case "live":
      return status.secondsUntilEnd !== null && status.secondsUntilEnd > 0
        ? `Live · ${formatCountdown(status.secondsUntilEnd)} left`
        : "Live now";
    case "recently-ended":
      return "Just ended";
    case "past":
      return "Past event";
  }
}
