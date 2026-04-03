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

/** Check if a nullable expiration date has passed */
export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}
