/**
 * Date/Time Formatting Utilities
 *
 * Consistent date and time formatting for display across the app.
 * All functions accept either a Date object or an ISO date string.
 */

/**
 * Ensures the input is a Date object
 */
function ensureDate(date: string | Date): Date {
  return typeof date === "string" ? new Date(date) : date;
}

/**
 * Format a date for event display: "Mon, Jan 23"
 *
 * @param date - Date object or ISO date string
 * @returns Formatted date string (e.g., "Mon, Jan 23")
 *
 * @example
 * formatEventDate("2024-01-23T14:30:00Z") // "Tue, Jan 23"
 * formatEventDate(new Date())              // "Wed, Jan 24"
 */
export function formatEventDate(date: string | Date): string {
  const d = ensureDate(date);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a time for event display: "2:30 PM"
 *
 * @param date - Date object or ISO date string
 * @returns Formatted time string (e.g., "2:30 PM")
 *
 * @example
 * formatEventTime("2024-01-23T14:30:00Z") // "2:30 PM"
 * formatEventTime(new Date())              // "9:45 AM"
 */
export function formatEventTime(date: string | Date): string {
  const d = ensureDate(date);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a date and time for event display: "Mon, Jan 23 at 2:30 PM"
 *
 * @param date - Date object or ISO date string
 * @returns Formatted date and time string (e.g., "Mon, Jan 23 at 2:30 PM")
 *
 * @example
 * formatEventDateTime("2024-01-23T14:30:00Z") // "Tue, Jan 23 at 2:30 PM"
 */
export function formatEventDateTime(date: string | Date): string {
  return `${formatEventDate(date)} at ${formatEventTime(date)}`;
}

/**
 * Format a date as a relative description or short date
 *
 * Returns "Today", "Tomorrow", "Yesterday", or a short date format "Jan 23"
 *
 * @param date - Date object or ISO date string
 * @returns Relative or short date string
 *
 * @example
 * formatRelativeDate(new Date())                          // "Today"
 * formatRelativeDate(tomorrow)                            // "Tomorrow"
 * formatRelativeDate(yesterday)                           // "Yesterday"
 * formatRelativeDate("2024-01-15T00:00:00Z")              // "Jan 15"
 */
export function formatRelativeDate(date: string | Date): string {
  const d = ensureDate(date);
  const now = new Date();

  // Compare dates without time
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a date for announcement display: "Jan 23, 2024"
 *
 * Handles null values gracefully, returning empty string.
 *
 * @param date - Date object, ISO date string, or null
 * @returns Formatted date string (e.g., "Jan 23, 2024") or empty string if null
 *
 * @example
 * formatAnnouncementDate("2024-01-23T14:30:00Z") // "Jan 23, 2024"
 * formatAnnouncementDate(null)                    // ""
 */
export function formatAnnouncementDate(date: string | Date | null): string {
  if (date === null) return "";

  const d = ensureDate(date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
