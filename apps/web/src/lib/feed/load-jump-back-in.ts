import { createClient } from "@/lib/supabase/server";
import type { ServerSupabase } from "@/lib/supabase/types";

/**
 * Counts of org-feed activity since the member last acknowledged the feed,
 * powering the "Jump back in" digest strip. `since` is the timestamp the counts
 * are measured from (echoed back so the dismiss call advances to a consistent
 * instant). `total` lets the caller skip rendering when nothing is new.
 */
export interface JumpBackInData {
  since: string;
  newPosts: number;
  newRsvps: number;
  newMembers: number;
  total: number;
}

/**
 * Reads the member's prior `feed_last_seen_at` and counts new posts, event
 * RSVPs, and members created after it. A NULL last-seen (never acknowledged)
 * is floored to the membership's `created_at` so a brand-new member doesn't see
 * the org's entire backlog counted as "new"; if that is also missing we floor
 * to now, yielding zero counts rather than a misleading number.
 *
 * Counts use head-only `exact` queries — no rows are transferred.
 */
export async function loadJumpBackInData(params: {
  orgId: string;
  userId: string | null;
  dataClient?: ServerSupabase;
}): Promise<JumpBackInData | null> {
  const { orgId, userId } = params;
  if (!userId) return null;

  const supabase = params.dataClient ?? (await createClient());

  const { data: membership, error: membershipError } = await supabase
    .from("user_organization_roles")
    .select("feed_last_seen_at, created_at")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    console.error("[loadJumpBackInData] membership query failed:", membershipError.message);
    return null;
  }
  if (!membership) return null;

  const since = membership.feed_last_seen_at ?? membership.created_at ?? new Date().toISOString();

  const [
    { count: newPosts, error: postsError },
    { count: newRsvps, error: rsvpsError },
    { count: newMembers, error: membersError },
  ] = await Promise.all([
    supabase
      .from("feed_posts")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .gt("created_at", since),
    supabase
      .from("event_rsvps")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gt("created_at", since),
    supabase
      .from("user_organization_roles")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "active")
      .gt("created_at", since),
  ]);

  if (postsError) console.error("[loadJumpBackInData] posts count failed:", postsError.message);
  if (rsvpsError) console.error("[loadJumpBackInData] rsvps count failed:", rsvpsError.message);
  if (membersError) console.error("[loadJumpBackInData] members count failed:", membersError.message);

  const posts = newPosts ?? 0;
  const rsvps = newRsvps ?? 0;
  // Exclude the viewer's own membership when it was created after `since`
  // (e.g. a brand-new member shouldn't be counted as a new member to themselves).
  const members = Math.max(0, (newMembers ?? 0) - (membership.created_at && membership.created_at > since ? 1 : 0));

  return {
    since,
    newPosts: posts,
    newRsvps: rsvps,
    newMembers: members,
    total: posts + rsvps + members,
  };
}
