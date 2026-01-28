/**
 * Shared date formatting utility
 *
 * All Intl.DateTimeFormat instances are hoisted to module scope so they are
 * created once and reused on every call, avoiding the per-call allocation
 * cost of toLocaleDateString / toLocaleTimeString.
 */

// ---------------------------------------------------------------------------
// Module-scoped formatter instances (created once, reused forever)
// ---------------------------------------------------------------------------

/** "Jan", "Feb", ... */
const monthShortFmt = new Intl.DateTimeFormat("en-US", { month: "short" });

/** "Jan 5" */
const monthDayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/** "Jan 5, 2025" */
const monthDayYearFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "Thu, Jan 5" */
const weekdayShortDateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** "Thursday, Jan 5" */
const weekdayLongDateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
});

/** "Thu, Jan 5, 3:00 PM" */
const weekdayShortDateTimeFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "3:00 PM" — hour: numeric */
const timeNumericFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/** "03:00 PM" — hour: 2-digit */
const time2DigitFmt = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

/** "Mon", "Tue", ... */
const weekdayShortFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
});

/** Default locale date — equivalent to date.toLocaleDateString() */
const defaultLocaleDateFmt = new Intl.DateTimeFormat();

/** "Jan 5, 2025" with end-range year — used for week range labels */
const monthDayYearRangeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// ---------------------------------------------------------------------------
// Exported formatting functions
// ---------------------------------------------------------------------------

/**
 * Uppercase short month from a date string: "JAN", "FEB", etc.
 * Used in event date blocks and philanthropy cards.
 */
export function formatMonth(dateString: string): string {
  return monthShortFmt.format(new Date(dateString)).toUpperCase();
}

/**
 * Day of month as a number: 1-31.
 * Used in event date blocks.
 */
export function formatDay(dateString: string): number {
  return new Date(dateString).getDate();
}

/**
 * Time with numeric hour: "3:00 PM".
 * Used in event cards, event detail, check-in, philanthropy, schedule editors.
 */
export function formatTime(dateString: string): string {
  return timeNumericFmt.format(new Date(dateString));
}

/**
 * Short weekday + short date: "Thu, Jan 5".
 * Used in event card detail rows, event detail pages, and check-in.
 */
export function formatShortWeekdayDate(dateString: string): string {
  return weekdayShortDateFmt.format(new Date(dateString));
}

/**
 * Long weekday + short date: "Thursday, Jan 5".
 * Used in events tab empty state for filtered dates.
 */
export function formatLongWeekdayDate(date: Date): string {
  return weekdayLongDateFmt.format(date);
}

/**
 * Short weekday + short date + time: "Thu, Jan 5, 3:00 PM".
 * Used on the home screen for event times.
 */
export function formatWeekdayDateTime(dateString: string): string {
  return weekdayShortDateTimeFmt.format(new Date(dateString));
}

/**
 * Short month + day: "Jan 5".
 * Used in donations list and announcement relative-time fallback.
 */
export function formatMonthDay(dateString: string): string {
  return monthDayFmt.format(new Date(dateString));
}

/**
 * Short month + day + year: "Jan 5, 2025".
 * Used in settings, announcement detail, expenses, schedule/event editors.
 */
export function formatMonthDayYear(dateString: string): string {
  return monthDayYearFmt.format(new Date(dateString));
}

/**
 * Nullable variant of formatMonthDayYear for string inputs.
 * Returns fallback (default "N/A") if the input is null or undefined.
 */
export function formatMonthDayYearSafe(
  dateString: string | null | undefined,
  fallback: string = "N/A"
): string {
  if (!dateString) return fallback;
  return monthDayYearFmt.format(new Date(dateString));
}

/**
 * Nullable variant of formatMonthDay for string inputs.
 * Returns fallback (default "") if the input is null or undefined.
 */
export function formatMonthDaySafe(
  dateString: string | null | undefined,
  fallback: string = ""
): string {
  if (!dateString) return fallback;
  return monthDayFmt.format(new Date(dateString));
}

/**
 * Format a Date object to "Jan 5, 2025" — nullable with custom fallback.
 * Used in event/philanthropy/schedule form date pickers.
 */
export function formatDatePickerLabel(
  value: Date | null,
  fallback: string = "Select date"
): string {
  if (!value) return fallback;
  return monthDayYearFmt.format(value);
}

/**
 * Format a Date object to "3:00 PM" — nullable with custom fallback.
 * Used in event/philanthropy form time pickers.
 */
export function formatTimePickerLabel(
  value: Date | null,
  fallback: string = "Select time"
): string {
  if (!value) return fallback;
  return timeNumericFmt.format(value);
}

/**
 * Time with numeric hour from a Date object: "3:00 PM".
 * Used in schedule form editors.
 */
export function formatTimeFromDate(date: Date): string {
  return timeNumericFmt.format(date);
}

/**
 * Short month + day + year from a Date object: "Jan 5, 2025".
 * Used in schedule form editors.
 */
export function formatDateFromDate(date: Date): string {
  return monthDayYearFmt.format(date);
}

/**
 * Timestamp with 2-digit hour: "03:00 PM".
 * Used in chat message timestamps.
 */
export function formatTimestamp(dateString: string): string {
  return time2DigitFmt.format(new Date(dateString));
}

/**
 * Short weekday name from a Date object: "Mon", "Tue", etc.
 * Used in events tab date strip.
 */
export function formatWeekdayShort(date: Date): string {
  return weekdayShortFmt.format(date);
}

/**
 * Default locale date string from a Date object.
 * Equivalent to date.toLocaleDateString().
 * Used in workouts, competition, mentorship, forms, schedules.
 */
export function formatDefaultDate(date: Date): string {
  return defaultLocaleDateFmt.format(date);
}

/**
 * Default locale date string from a date string.
 * Equivalent to new Date(dateString).toLocaleDateString().
 */
export function formatDefaultDateFromString(dateString: string): string {
  return defaultLocaleDateFmt.format(new Date(dateString));
}

/**
 * Week range label: "Jan 5 - Jan 11, 2025".
 * Used in AvailabilityGrid week navigation.
 */
export function formatWeekRange(start: Date, end: Date): string {
  return `${monthDayFmt.format(start)} - ${monthDayYearRangeFmt.format(end)}`;
}

/**
 * Relative time: "Just now", "5m ago", "3h ago", "2d ago", or "Jan 5".
 * Used in announcement cards.
 */
export function formatRelativeTime(
  dateString: string | null | undefined
): string {
  if (!dateString) return "";

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return monthDayFmt.format(date);
}

/**
 * Non-uppercased short month from a date string: "Jan", "Feb", etc.
 * Used in philanthropy index for month labels.
 */
export function formatMonthShort(dateString: string): string {
  return monthShortFmt.format(new Date(dateString));
}

/**
 * Parse a date-only string ("2025-01-05") as a local date to avoid
 * timezone shifts, then format with the default locale.
 * Used in workouts and competition where date strings lack time components.
 */
export function formatLocalDateString(dateString: string): string {
  const datePart = dateString.split("T")[0];
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return dateString;
  return defaultLocaleDateFmt.format(new Date(year, month - 1, day));
}
