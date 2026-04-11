/**
 * Shared date display helpers.
 */

/** Format a date string as "Mar 9, 2026" */
export function formatShortDate(dateStr: string, timeZone?: string): string {
  // Plain YYYY-MM-DD strings are parsed as UTC midnight by `new Date()`, which
  // shifts to the previous day in US timezones. Parse them as local dates instead.
  const date = dateStr.includes("T")
    ? new Date(dateStr)
    : (() => {
        const [y, m, d] = dateStr.split("-").map(Number);
        return new Date(y, m - 1, d);
      })();

  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  if (timeZone) opts.timeZone = timeZone;

  return date.toLocaleDateString("en-US", opts);
}

/** Format a minute-of-day value as a compact time label (e.g. 810 → "1:30pm") */
export function minutesToTimeLabel(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h < 12 ? "am" : "pm";
  const hour = h % 12 || 12;
  return min > 0 ? `${hour}:${String(min).padStart(2, "0")}${ampm}` : `${hour}${ampm}`;
}

/** Check if a nullable expiration date has passed */
export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}
