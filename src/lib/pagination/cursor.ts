/**
 * Cursor-based pagination utility using (created_at, id) composite cursor.
 *
 * The cursor is a base64url-encoded JSON string containing the timestamp and id
 * of the last item in the current page. This allows efficient keyset pagination
 * without offset-based scanning.
 */

type CursorPayload = {
  /** ISO 8601 timestamp */
  t: string;
  /** UUID */
  i: string;
};

/**
 * Encodes a (created_at, id) pair into a cursor string.
 */
export function encodeCursor(createdAt: string, id: string): string {
  const payload: CursorPayload = { t: createdAt, i: id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Decodes a cursor string into the (created_at, id) pair.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const payload = JSON.parse(json) as CursorPayload;

    if (typeof payload.t !== "string" || typeof payload.i !== "string") {
      return null;
    }

    // Validate timestamp is parseable
    const ts = new Date(payload.t);
    if (isNaN(ts.getTime())) {
      return null;
    }

    // Basic UUID format check
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.i)) {
      return null;
    }

    return { createdAt: payload.t, id: payload.i };
  } catch {
    return null;
  }
}

/**
 * Applies cursor-based pagination filters to a Supabase query builder.
 * Assumes descending order by (created_at, id).
 *
 * For descending pagination, items after the cursor have:
 *   created_at < cursor.t OR (created_at = cursor.t AND id < cursor.i)
 *
 * Supabase doesn't support composite < on two columns directly,
 * so we use the or() filter.
 */
export function applyCursorFilter<T extends { or: (filter: string) => T }>(
  query: T,
  cursor: { createdAt: string; id: string },
): T {
  return query.or(
    `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
  );
}

/**
 * Builds cursor pagination response metadata.
 * Fetches limit+1 items to determine if there are more pages.
 */
export function buildCursorResponse<T extends { created_at: string; id: string }>(
  items: T[],
  limit: number,
): { data: T[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const lastItem = data[data.length - 1];
  const nextCursor = hasMore && lastItem
    ? encodeCursor(lastItem.created_at, lastItem.id)
    : null;

  return { data, nextCursor, hasMore };
}
