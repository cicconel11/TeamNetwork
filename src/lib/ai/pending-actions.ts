import type { AssistantPreparedJob } from "@/lib/schemas/jobs";

export const AI_PENDING_ACTION_EXPIRY_MS = 15 * 60 * 1000;

export type PendingActionType = "create_job_posting";
export type PendingActionStatus =
  | "pending"
  | "confirmed"
  | "executed"
  | "cancelled"
  | "expired";

export interface CreateJobPostingPendingPayload extends AssistantPreparedJob {
  orgSlug?: string | null;
}

export type PendingActionPayload = CreateJobPostingPendingPayload;

export interface PendingActionRecord {
  id: string;
  organization_id: string;
  user_id: string;
  thread_id: string;
  action_type: PendingActionType;
  payload: PendingActionPayload;
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
  update(payload: Record<string, unknown>): {
    eq(column: string, value: string): Promise<{ error: unknown }>;
  };
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
    resultEntityType?: string | null;
    resultEntityId?: string | null;
    executedAt?: string | null;
  }
): Promise<void> {
  const payload: Record<string, unknown> = {
    status: input.status,
  };

  if (input.resultEntityType !== undefined) payload.result_entity_type = input.resultEntityType;
  if (input.resultEntityId !== undefined) payload.result_entity_id = input.resultEntityId;
  if (input.executedAt !== undefined) payload.executed_at = input.executedAt;

  const { error } = await supabase
    .from("ai_pending_actions")
    .update(payload)
    .eq("id", actionId);

  if (error) {
    throw new Error("Failed to update pending action");
  }
}

export function isPendingActionExpired(record: PendingActionRecord): boolean {
  return new Date(record.expires_at).getTime() <= Date.now();
}

export function buildPendingActionSummary(record: PendingActionRecord): PendingActionSummary {
  switch (record.action_type) {
    case "create_job_posting":
      return {
        title: "Review job posting",
        description: "Confirm the drafted job before it is added to the jobs board.",
      };
    default:
      return {
        title: "Review action",
        description: "Confirm this assistant action before it runs.",
      };
  }
}
