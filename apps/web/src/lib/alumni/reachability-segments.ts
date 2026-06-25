import { CHAT_ELIGIBLE_ORG_ROLES } from "@/lib/chat/recipient-eligibility";

/**
 * Shared reachability predicate for an org's `alumni` roster.
 *
 * A network is only worth its *reachable* nodes. An alumnus is reachable when
 * they are linked to a user that carries an active chat-eligible org role — the
 * same predicate `loadActiveLinkedAlumni` (chat/direct-chat.ts) applies to
 * decide who can be messaged. Unclaimed alumni (`user_id` null) are dead nodes.
 *
 * Two surfaces consume this module:
 *   - the data-health card (counts only), via {@link reachability-health.ts}
 *   - the cohort console (per-row list), via the cohorts API route
 * Both classify with {@link classifyAlumniReachability}, so they can never
 * disagree about who is reachable.
 */

/** The five mutually-exclusive reachability states an alumnus can be in. */
export type ReachabilitySegment =
  /** Linked AND active chat-eligible role — the truly reachable. */
  | "linkedEligible"
  /** Linked but no active chat-eligible role — linked, can't chat. */
  | "linkedNotEligible"
  /** Unclaimed with an email on file — the re-invite target. */
  | "unclaimedWithEmail"
  /** Unclaimed with no email — structurally unreachable. */
  | "unclaimedNoEmail"
  /** Soft-deleted alumni — excluded from totals. */
  | "softDeleted";

/**
 * The minimal alumnus shape the classifier reads. Any richer alumni row (the
 * console pulls names + invite tracking too) structurally satisfies this.
 */
export interface ReachabilityClassifiable {
  user_id: string | null;
  email: string | null;
  deleted_at: string | null;
}

/**
 * Classify a single alumnus into its reachability segment.
 *
 * `eligibleUserIds` is the set of linked user_ids that carry an active
 * chat-eligible org role (resolved once per scan, mirroring
 * loadActiveLinkedAlumni). Soft-deleted rows short-circuit first so they never
 * land in a live segment.
 */
export function classifyAlumniReachability(
  row: ReachabilityClassifiable,
  eligibleUserIds: ReadonlySet<string>
): ReachabilitySegment {
  if (row.deleted_at) return "softDeleted";
  if (row.user_id) {
    return eligibleUserIds.has(row.user_id) ? "linkedEligible" : "linkedNotEligible";
  }
  if (row.email) return "unclaimedWithEmail";
  return "unclaimedNoEmail";
}

/** Roles re-exported so callers resolving eligibility never re-list them. */
export { CHAT_ELIGIBLE_ORG_ROLES };

/** Page size + hard cap shared by every reachability scan. */
export const REACHABILITY_PAGE_SIZE = 1000;
export const REACHABILITY_MAX_ROWS = REACHABILITY_PAGE_SIZE * 20;

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "unknown_error";
}

/**
 * Page a `.range()`-driven query to the shared cap. Throws on the first query
 * error (callers wrap in try/catch); returns `truncated` when the cap is hit.
 */
export async function fetchAllPaged<T>(
  build: (from: number, to: number) => Promise<{ data: unknown; error: unknown }>
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let from = 0;
  while (from < REACHABILITY_MAX_ROWS) {
    const { data, error } = await build(from, from + REACHABILITY_PAGE_SIZE - 1);
    if (error) throw new Error(toMessage(error));
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < REACHABILITY_PAGE_SIZE) return { rows, truncated: false };
    from += REACHABILITY_PAGE_SIZE;
  }
  return { rows, truncated: true };
}

/**
 * Resolve the subset of `linkedUserIds` that carry an active chat-eligible org
 * role — the eligibility half of the reachability predicate, mirroring
 * loadActiveLinkedAlumni (chat/direct-chat.ts). Returns the set plus whether
 * the role scan was truncated. Both reachability surfaces call this, so they
 * resolve eligibility identically.
 */
export async function resolveEligibleUserIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  orgId: string,
  linkedUserIds: string[]
): Promise<{ eligibleUserIds: Set<string>; truncated: boolean }> {
  if (linkedUserIds.length === 0) {
    return { eligibleUserIds: new Set<string>(), truncated: false };
  }
  const { rows, truncated } = await fetchAllPaged<{ user_id: string | null }>((from, to) =>
    sb
      .from("user_organization_roles")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .in("role", CHAT_ELIGIBLE_ORG_ROLES)
      .in("user_id", linkedUserIds)
      .range(from, to)
  );
  const eligibleUserIds = new Set(
    rows.map((row) => row.user_id).filter((value): value is string => Boolean(value))
  );
  return { eligibleUserIds, truncated };
}

/** Distinct non-null user_ids across a set of alumni rows. */
export function linkedUserIdsOf(rows: { user_id: string | null }[]): string[] {
  return [
    ...new Set(
      rows.map((row) => row.user_id).filter((value): value is string => Boolean(value))
    ),
  ];
}
