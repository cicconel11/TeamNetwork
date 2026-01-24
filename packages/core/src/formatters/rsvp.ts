/**
 * RSVP Label Utilities
 *
 * Maps database RSVP status values to user-friendly display labels.
 */

/**
 * Mapping of RSVP database values to display labels
 */
export const RSVP_LABELS: Record<string, string> = {
  going: "Going",
  maybe: "Maybe",
  not_going: "Not Going",
  attending: "Going", // normalize legacy value
};

/**
 * Get a user-friendly label for an RSVP status
 *
 * @param status - The RSVP status from the database (e.g., "going", "maybe", "not_going")
 * @returns The user-friendly display label (e.g., "Going", "Maybe", "Not Going")
 *
 * @example
 * getRsvpLabel("going")     // "Going"
 * getRsvpLabel("maybe")     // "Maybe"
 * getRsvpLabel("not_going") // "Not Going"
 * getRsvpLabel("attending") // "Going" (normalized)
 * getRsvpLabel("unknown")   // "Unknown" (fallback for unrecognized values)
 */
export function getRsvpLabel(status: string): string {
  return RSVP_LABELS[status] ?? capitalizeFirst(status.replace(/_/g, " "));
}

/**
 * Capitalize the first letter of a string
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
