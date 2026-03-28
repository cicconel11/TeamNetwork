import type { AssistantPreparedJob } from "@/lib/schemas/jobs";
import type { AssistantPreparedDiscussion } from "@/lib/schemas/discussion";

export const AI_PENDING_ACTION_EXPIRY_MS = 15 * 60 * 1000;

export type PendingActionType = "create_job_posting" | "create_discussion_thread";
export type PendingActionStatus =
  | "pending"
  | "confirmed"
  | "executed"
  | "cancelled"
  | "expired";

export interface CreateJobPostingPendingPayload extends AssistantPreparedJob {
  orgSlug?: string | null;
}

export interface CreateDiscussionThreadPendingPayload extends AssistantPreparedDiscussion {
  orgSlug?: string | null;
}

export interface PendingActionPayloadByType {
  create_job_posting: CreateJobPostingPendingPayload;
  create_discussion_thread: CreateDiscussionThreadPendingPayload;
}

export type PendingActionPayload = PendingActionPayloadByType[PendingActionType];

export interface PendingActionRecord<TActionType extends PendingActionType = PendingActionType> {
  id: string;
  organization_id: string;
  user_id: string;
  thread_id: string;
  action_type: TActionType;
  payload: PendingActionPayloadByType[TActionType];
  status: PendingActionStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  result_entity_type: string | null;
  result_entity_id: string | null;
}

export interface PendingActionSummary {
  title: string;
  description: string;
}

interface PendingActionUpdateChain {
  eq(column: string, value: string): PendingActionUpdateChain & Promise<{ error: unknown }>;
  select(columns: string): Promise<{ data: unknown[] | null; error: unknown }>;
}

interface PendingActionQueryBuilder {
  insert(payload: Record<string, unknown>): {
    select(columns: string): {
      single(): Promise<{ data: unknown; error: unknown }>;
    };
  };
  select(columns: string): {
    eq(column: string, value: string): {
      maybeSingle(): Promise<{ data: unknown; error: unknown }>;
    };
  };
  update(payload: Record<string, unknown>): PendingActionUpdateChain;
}

interface PendingActionSupabase {
  from(table: "ai_pending_actions"): PendingActionQueryBuilder;
}

export async function createPendingAction(
  supabase: PendingActionSupabase,
  input: {
    organizationId: string;
    userId: string;
    threadId: string;
    actionType: PendingActionType;
    payload: PendingActionPayload;
  }
): Promise<PendingActionRecord> {
  const expiresAt = new Date(Date.now() + AI_PENDING_ACTION_EXPIRY_MS).toISOString();
  const { data, error } = await supabase
    .from("ai_pending_actions")
    .insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      thread_id: input.threadId,
      action_type: input.actionType,
      payload: input.payload,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error("Failed to create pending action");
  }

  return data as PendingActionRecord;
}

export async function getPendingAction(
  supabase: PendingActionSupabase,
  actionId: string
): Promise<PendingActionRecord | null> {
  const { data, error } = await supabase
    .from("ai_pending_actions")
    .select("*")
    .eq("id", actionId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load pending action");
  }

  return (data as PendingActionRecord | null) ?? null;
}

export async function updatePendingActionStatus(
  supabase: PendingActionSupabase,
  actionId: string,
  input: {
    status: PendingActionStatus;
    expectedStatus?: PendingActionStatus;
    resultEntityType?: string | null;
    resultEntityId?: string | null;
    executedAt?: string | null;
  }
): Promise<{ updated: boolean }> {
  const payload: Record<string, unknown> = {
    status: input.status,
  };

  if (input.resultEntityType !== undefined) payload.result_entity_type = input.resultEntityType;
  if (input.resultEntityId !== undefined) payload.result_entity_id = input.resultEntityId;
  if (input.executedAt !== undefined) payload.executed_at = input.executedAt;

  if (input.expectedStatus) {
    const { data, error } = await supabase
      .from("ai_pending_actions")
      .update(payload)
      .eq("id", actionId)
      .eq("status", input.expectedStatus)
      .select("id");

    if (error) {
      throw new Error("Failed to update pending action");
    }

    return { updated: Array.isArray(data) && data.length > 0 };
  }

  const { error } = await supabase
    .from("ai_pending_actions")
    .update(payload)
    .eq("id", actionId);

  if (error) {
    throw new Error("Failed to update pending action");
  }

  return { updated: true };
}

export function isPendingActionExpired(record: PendingActionRecord): boolean {
  return new Date(record.expires_at).getTime() <= Date.now();
}

export function isAuthorizedAction(
  ctx: { orgId: string; userId: string },
  action: PendingActionRecord
): boolean {
  return action.organization_id === ctx.orgId && action.user_id === ctx.userId;
}

export function buildPendingActionSummary(record: PendingActionRecord): PendingActionSummary {
  switch (record.action_type) {
    case "create_job_posting":
      return {
        title: "Review job posting",
        description: "Confirm the drafted job before it is added to the jobs board.",
      };
    case "create_discussion_thread":
      return {
        title: "Review discussion thread",
        description: "Confirm the drafted thread before it is posted to discussions.",
      };
    default:
      return {
        title: "Review action",
        description: "Confirm this assistant action before it runs.",
      };
  }
}
