/**
 * RSVP Label Utilities
 *
 * Canonical RSVP status type and label/normalize helpers shared across
 * web + mobile. The DB enum (`event_rsvps.status`) is the source of truth:
 * `attending | not_attending | maybe`.
 */

/**
 * Canonical RSVP status (mirrors DB enum check).
 */
export type RsvpStatus = "attending" | "not_attending" | "maybe";

/**
 * Mapping of RSVP status values to display labels. Includes legacy aliases
 * (`going`, `not_going`) so older payloads still render correctly.
 */
export const RSVP_LABELS: Record<string, string> = {
  attending: "Going",
  not_attending: "Can't Go",
  maybe: "Maybe",
  going: "Going",
  not_going: "Can't Go",
  declined: "Can't Go",
};

/**
 * Get a user-friendly label for an RSVP status. Accepts any string (including
 * legacy values) and falls back to a humanized version of the input.
 *
 * @example
 * getRsvpLabel("attending")     // "Going"
 * getRsvpLabel("not_attending") // "Can't Go"
 * getRsvpLabel("maybe")         // "Maybe"
 * getRsvpLabel("going")         // "Going" (legacy)
 * getRsvpLabel("unknown")       // "Unknown"
 */
export function getRsvpLabel(status: string): string {
  return RSVP_LABELS[status] ?? capitalizeFirst(status.replace(/_/g, " "));
}

/**
 * Normalize an arbitrary string (including legacy `going`/`not_going`/`declined`
 * variants) into the canonical DB enum value. Mirrors `normalizeRole`.
 *
 * Returns `null` for nullish/unknown inputs so callers can decide what an
 * absent RSVP means.
 *
 * @example
 * normalizeRsvpStatus("going")         // "attending"
 * normalizeRsvpStatus("not_going")     // "not_attending"
 * normalizeRsvpStatus("declined")      // "not_attending"
 * normalizeRsvpStatus("attending")     // "attending"
 * normalizeRsvpStatus(null)            // null
 * normalizeRsvpStatus("foo")           // null
 */
export function normalizeRsvpStatus(
  value: string | null | undefined,
): RsvpStatus | null {
  if (!value) return null;
  switch (value) {
    case "attending":
    case "not_attending":
    case "maybe":
      return value;
    case "going":
      return "attending";
    case "not_going":
    case "declined":
      return "not_attending";
    default:
      return null;
  }
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
