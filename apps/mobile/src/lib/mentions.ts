/**
 * Mention helpers for chat / discussions / announcements.
 *
 * Strategy: client serializes mentions as `[@uuid|Display Name]` markers in
 * the body string AND populates the row's `mentioned_user_ids uuid[]`
 * column. The DB trigger fans out push notifications from the array; the
 * markers are for client-side rendering (turn into clickable chips).
 *
 * Markers chosen for unambiguity: a stray `@` in prose won't false-match.
 */

const MARKER_RE = /\[@([0-9a-f-]{36})\|(.+?)\]/gi;

export interface MentionMarker {
  userId: string;
  displayName: string;
}

/** Returns the user ids referenced in body via [@uuid|Name] markers. */
export function extractMentionedUserIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MARKER_RE)) {
    ids.add(match[1].toLowerCase());
  }
  return Array.from(ids);
}

/** Parses every marker in body in order. */
export function parseMentionMarkers(body: string): MentionMarker[] {
  const out: MentionMarker[] = [];
  for (const match of body.matchAll(MARKER_RE)) {
    out.push({ userId: match[1].toLowerCase(), displayName: match[2] });
  }
  return out;
}

/** Replaces each marker with `@DisplayName` for plain-text rendering. */
export function renderMentionPlainText(body: string): string {
  return body.replace(MARKER_RE, (_full, _id, name) => `@${name}`);
}

/**
 * Builds a marker for an autocomplete pick. Display names with `]` are
 * sanitized so the regex stays unambiguous.
 */
export function buildMentionMarker(userId: string, displayName: string): string {
  const safeName = displayName.replace(/\[|\]/g, "");
  return `[@${userId}|${safeName}]`;
}
