import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the set of user ids the given user has a mutual block with — both
 * directions: people `userId` blocked, and people who blocked `userId`. Apple
 * Guideline 1.2 requires blocks to be bidirectional (neither party sees the
 * other's content), so callers use this to filter author_id out of feed,
 * comment, and chat queries.
 *
 * Soft-deleted blocks (`deleted_at IS NOT NULL`, i.e. unblocked) are excluded.
 * Returns an empty array on query failure so a transient error degrades to
 * "show everything" rather than throwing inside a content fetch — the failure
 * is logged with context for follow-up.
 */
export async function getBlockedUserIds(
  // The generated Database type isn't threaded through every caller's client;
  // this helper only touches user_blocks, so an untyped client is acceptable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .is("deleted_at", null)
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);

  if (error) {
    console.error("[moderation] getBlockedUserIds query failed", {
      userId,
      error: error.message,
    });
    return [];
  }

  return deriveBlockedIds(
    (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>,
    userId,
  );
}

/**
 * Pure id-derivation from user_blocks rows: returns the "other party" id for
 * every row touching `userId`, deduplicated. Exported for unit testing.
 */
export function deriveBlockedIds(
  rows: Array<{ blocker_id: string; blocked_id: string }>,
  userId: string,
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.blocker_id === userId) ids.add(row.blocked_id);
    if (row.blocked_id === userId) ids.add(row.blocker_id);
  }
  return Array.from(ids);
}

/**
 * Postgrest `.not("col", "in", "(...)")` requires a parenthesised,
 * comma-separated list and rejects an empty `()`. Returns the formatted filter
 * value, or null when there are no blocked ids (caller should skip the filter).
 */
export function blockedIdsInFilter(ids: string[]): string | null {
  if (ids.length === 0) return null;
  return `(${ids.join(",")})`;
}
