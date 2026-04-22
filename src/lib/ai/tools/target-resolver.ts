// Target resolver for agent edit/delete tool calls. Phase 1b-narrow scope:
// answer "which entity id are we talking about" without fetching the row or
// touching per-domain logic. Per-domain by-id and by-name predicates arrive
// alongside each domain tool in Phase 2+.
//
// The resolver handles three paths:
//   1. Explicit targetId → short-circuit, return as-is.
//   2. Most-recent fallback (edit only) → consult ai_pending_actions and
//      surface the result_entity_id of the caller's most recent executed
//      action on the same entity type, bounded by windowMs.
//   3. fallback: "none" or fallback disabled → return needs_target_id so the
//      model asks the user for an explicit id.
//
// Destructive ops (delete, cancel) deliberately disable the most-recent
// fallback — security addendum A2.1. The lookback window is narrowed to 15m
// for edit per performance review, down from the original 1h proposal.

export type EntityType =
  | "announcement"
  | "event"
  | "job"
  | "discussion_thread"
  | "discussion_reply"
  | "chat_message";

export type TargetOp = "edit" | "delete" | "cancel" | "expire";

export type ResolverFallback = "most_recent" | "none";

export const AI_RECENT_ENTITY_LOOKBACK_EDIT_MS = 15 * 60 * 1000;
export const AI_RECENT_ENTITY_LOOKBACK_DELETE_MS = 0;

// Minimal Supabase-shape the resolver relies on. Deliberately narrow so unit
// tests don't need the real client or a heavyweight stub.
export interface ResolverSupabaseClient {
  from(table: "ai_pending_actions"): {
    select(columns: string): ResolverFilterChain;
  };
}

type ResolverRow = { result_entity_id: string | null };

export interface ResolverFilterChain
  extends PromiseLike<{ data: ResolverRow[] | null; error: unknown }> {
  eq(column: string, value: unknown): ResolverFilterChain;
  gte(column: string, value: string): ResolverFilterChain;
  order(
    column: string,
    options: { ascending: boolean }
  ): ResolverFilterChain;
  limit(n: number): ResolverFilterChain;
}

export interface ResolveArgs {
  supabase: ResolverSupabaseClient;
  caller: { userId: string; organizationId: string };
  entityType: EntityType;
  op: TargetOp;
  targetId?: string;
  fallback: ResolverFallback;
  windowMs?: number;
}

export type ResolveResult =
  | { kind: "resolved"; targetId: string; entityType: EntityType }
  | { kind: "needs_target_id"; reason: string }
  | { kind: "not_found" };

export async function resolveAgentActionTarget(
  args: ResolveArgs
): Promise<ResolveResult> {
  if (args.targetId) {
    return {
      kind: "resolved",
      targetId: args.targetId,
      entityType: args.entityType,
    };
  }

  if (args.fallback === "none") {
    return {
      kind: "needs_target_id",
      reason: "Explicit target_id is required for this operation.",
    };
  }

  const windowMs = args.windowMs ?? windowForOp(args.op);
  if (windowMs <= 0) {
    return {
      kind: "needs_target_id",
      reason: `Most-recent fallback is disabled for ${args.op}; supply an explicit target_id.`,
    };
  }

  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const { data, error } = await args.supabase
    .from("ai_pending_actions")
    .select("result_entity_id")
    .eq("user_id", args.caller.userId)
    .eq("organization_id", args.caller.organizationId)
    .eq("result_entity_type", args.entityType)
    .eq("status", "executed")
    .gte("executed_at", cutoff)
    .order("executed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(
      "resolveAgentActionTarget: ai_pending_actions most-recent query failed"
    );
  }

  const row = (data ?? [])[0];
  if (!row?.result_entity_id) {
    return { kind: "not_found" };
  }

  return {
    kind: "resolved",
    targetId: row.result_entity_id,
    entityType: args.entityType,
  };
}

function windowForOp(op: TargetOp): number {
  switch (op) {
    case "edit":
    case "expire":
      return AI_RECENT_ENTITY_LOOKBACK_EDIT_MS;
    case "delete":
    case "cancel":
      return AI_RECENT_ENTITY_LOOKBACK_DELETE_MS;
  }
}
