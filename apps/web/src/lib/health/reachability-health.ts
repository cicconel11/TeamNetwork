import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyAlumniReachability,
  fetchAllPaged,
  linkedUserIdsOf,
  resolveEligibleUserIds,
  type ReachabilitySegment,
} from "@/lib/alumni/reachability-segments";

/**
 * Read-only reachability checker for an org's `alumni` roster.
 *
 * A network is only worth its *reachable* nodes. An alumnus is reachable when
 * they are linked to a user that carries an active chat-eligible org role —
 * the same predicate `loadActiveLinkedAlumni` (chat/direct-chat.ts) applies to
 * decide who can be messaged. Unclaimed alumni (`user_id` null) are dead nodes:
 * they can't be messaged and can't be surfaced into warm paths.
 *
 * This module computes all five mutually-exclusive reachability segments. The
 * data-health card renders four counts derived from them; the segment counts
 * are the seam a future cohort console reuses, so the two surfaces can never
 * disagree about who is reachable.
 *
 * Runs on the service-role client (RLS-bypassing, admin-gated upstream) and
 * emits counts only — no emails or PII leave the module.
 */

/**
 * Mutually-exclusive reachability segments over an org's alumni rows.
 * The first four partition the non-deleted alumni; `softDeleted` is disjoint
 * and excluded from every total.
 */
export interface ReachabilitySegmentCounts {
  /** Linked AND active chat-eligible role — the truly reachable. */
  linkedEligible: number;
  /** Linked but no active chat-eligible role — linked, can't chat. */
  linkedNotEligible: number;
  /** Unclaimed with an email on file — the re-invite target. */
  unclaimedWithEmail: number;
  /** Unclaimed with no email — structurally unreachable. */
  unclaimedNoEmail: number;
  /** Soft-deleted alumni — excluded from totals. */
  softDeleted: number;
}

export interface ReachabilityHealthReport {
  orgId: string;
  state: "ok" | "gaps" | "degraded";
  reason: string | null;
  segments: ReachabilitySegmentCounts;
  /** Card-facing counts, all derived from {@link ReachabilitySegmentCounts}. */
  counts: {
    /** Non-deleted alumni (the partition the card totals over). */
    totalAlumni: number;
    /** Non-deleted alumni with a linked user_id. */
    linkedAlumni: number;
    /** linkedEligible / linkedAlumni as a 0–100 integer percent (0 when none linked). */
    chatEligiblePercent: number;
    /** Re-invitable stragglers. */
    unclaimedWithEmail: number;
  };
  truncated: boolean;
}

interface AlumniRow {
  id: string;
  user_id: string | null;
  email: string | null;
}

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "unknown_error";
}

const ZERO_SEGMENTS: ReachabilitySegmentCounts = {
  linkedEligible: 0,
  linkedNotEligible: 0,
  unclaimedWithEmail: 0,
  unclaimedNoEmail: 0,
  softDeleted: 0,
};

function degraded(orgId: string, reason: string): ReachabilityHealthReport {
  return {
    orgId,
    state: "degraded",
    reason,
    segments: { ...ZERO_SEGMENTS },
    counts: {
      totalAlumni: 0,
      linkedAlumni: 0,
      chatEligiblePercent: 0,
      unclaimedWithEmail: 0,
    },
    truncated: false,
  };
}

export async function checkReachabilityHealth(
  serviceSupabase: SupabaseClient,
  orgId: string
): Promise<ReachabilityHealthReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = serviceSupabase as any;

  let nonDeleted: AlumniRow[];
  let softDeletedCount: number;
  let truncated = false;

  try {
    // Soft-deleted alumni: counted (head only — they never enter a segment scan).
    const { count: deletedCount, error: deletedError } = await sb
      .from("alumni")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("deleted_at", "is", null);
    if (deletedError) return degraded(orgId, toMessage(deletedError));
    softDeletedCount = typeof deletedCount === "number" ? deletedCount : 0;

    // Non-deleted alumni rows: the partition the four live segments cover.
    // We need user_id + email per row to bucket them, so we page the rows
    // (bounded by the shared cap) rather than issuing four separate count
    // queries that could drift from one another.
    const alumniResult = await fetchAllPaged<AlumniRow>((from, to) =>
      sb
        .from("alumni")
        .select("id, user_id, email")
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .range(from, to)
    );
    nonDeleted = alumniResult.rows;
    truncated = alumniResult.truncated;
  } catch (error) {
    return degraded(orgId, toMessage(error));
  }

  // Resolve which linked user_ids carry an active chat-eligible org role —
  // shared with the cohort console's list path, so both resolve eligibility
  // identically (and the roles are never re-listed here).
  let eligibleUserIds: Set<string>;
  try {
    const resolved = await resolveEligibleUserIds(sb, orgId, linkedUserIdsOf(nonDeleted));
    eligibleUserIds = resolved.eligibleUserIds;
    truncated = truncated || resolved.truncated;
  } catch (error) {
    return degraded(orgId, toMessage(error));
  }

  // Bucket every non-deleted row through the shared classifier — the same
  // predicate the cohort console's list path uses, so counts can't drift from
  // the per-row segmentation. softDeleted is counted separately (head query);
  // these rows are pre-filtered to deleted_at IS NULL, so the classifier never
  // returns "softDeleted" here.
  const segments: ReachabilitySegmentCounts = { ...ZERO_SEGMENTS, softDeleted: softDeletedCount };
  for (const row of nonDeleted) {
    const segment: ReachabilitySegment = classifyAlumniReachability(
      { user_id: row.user_id, email: row.email, deleted_at: null },
      eligibleUserIds
    );
    segments[segment] += 1;
  }

  const totalAlumni = nonDeleted.length;
  const linkedAlumni = segments.linkedEligible + segments.linkedNotEligible;
  const chatEligiblePercent =
    linkedAlumni > 0 ? Math.round((segments.linkedEligible / linkedAlumni) * 100) : 0;

  return {
    orgId,
    // Re-invitable stragglers are a remediable gap, mirroring the sibling
    // checkers that report `gaps` when there is actionable divergence.
    state: segments.unclaimedWithEmail > 0 ? "gaps" : "ok",
    reason: truncated ? "partial_scan" : null,
    segments,
    counts: {
      totalAlumni,
      linkedAlumni,
      chatEligiblePercent,
      unclaimedWithEmail: segments.unclaimedWithEmail,
    },
    truncated,
  };
}
