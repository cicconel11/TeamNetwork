import type { AssistantPreparedJob } from "@/lib/schemas/jobs";
import type { AssistantPreparedDiscussion } from "@/lib/schemas/discussion";
import type { AssistantPreparedDiscussionReply } from "@/lib/schemas/discussion";
import type { AssistantPreparedEvent } from "@/lib/schemas/events-ai";
import type { AssistantPreparedAnnouncement } from "@/lib/schemas/content";
import type { AssistantPreparedChatMessage, AssistantPreparedGroupMessage } from "@/lib/schemas/chat-ai";

export const AI_PENDING_ACTION_EXPIRY_MS = 15 * 60 * 1000;

export type PendingActionType =
  | "create_announcement"
  | "create_job_posting"
  | "send_chat_message"
  | "send_group_chat_message"
  | "create_discussion_reply"
  | "create_discussion_thread"
  | "create_event"
  | "create_enterprise_invite"
  | "revoke_enterprise_invite";
export type PendingActionStatus =
  | "pending"
  | "confirmed"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired";

export interface CreateJobPostingPendingPayload extends AssistantPreparedJob {
  orgSlug?: string | null;
}

export interface CreateAnnouncementPendingPayload extends AssistantPreparedAnnouncement {
  orgSlug?: string | null;
}

export interface CreateDiscussionThreadPendingPayload extends AssistantPreparedDiscussion {
  orgSlug?: string | null;
}

export interface CreateDiscussionReplyPendingPayload extends AssistantPreparedDiscussionReply {
  orgSlug?: string | null;
}

export interface SendChatMessagePendingPayload extends AssistantPreparedChatMessage {
  orgSlug?: string | null;
}

export interface SendGroupChatMessagePendingPayload extends AssistantPreparedGroupMessage {
  orgSlug?: string | null;
}

export interface CreateEventPendingPayload extends AssistantPreparedEvent {
  orgSlug?: string | null;
}

export interface CreateEnterpriseInvitePendingPayload {
  enterpriseId: string;
  enterpriseSlug: string;
  role: "admin" | "active_member" | "alumni";
  organizationId?: string | null;
  organizationName?: string | null;
  usesRemaining?: number | null;
  expiresAt?: string | null;
}

export interface RevokeEnterpriseInvitePendingPayload {
  enterpriseId: string;
  enterpriseSlug: string;
  inviteId: string;
  inviteCode: string;
  role?: string | null;
  organizationId?: string | null;
}

export interface PendingActionPayloadByType {
  create_announcement: CreateAnnouncementPendingPayload;
  create_job_posting: CreateJobPostingPendingPayload;
  send_chat_message: SendChatMessagePendingPayload;
  send_group_chat_message: SendGroupChatMessagePendingPayload;
  create_discussion_reply: CreateDiscussionReplyPendingPayload;
  create_discussion_thread: CreateDiscussionThreadPendingPayload;
  create_event: CreateEventPendingPayload;
  create_enterprise_invite: CreateEnterpriseInvitePendingPayload;
  revoke_enterprise_invite: RevokeEnterpriseInvitePendingPayload;
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
  error_message?: string | null;
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
      eq(nextColumn: string, nextValue: string): {
        lt(targetColumn: string, targetValue: string): Promise<{ data: unknown; error: unknown }>;
      };
      lt(targetColumn: string, targetValue: string): Promise<{ data: unknown; error: unknown }>;
      maybeSingle(): Promise<{ data: unknown; error: unknown }>;
      then?: unknown;
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
    errorMessage?: string | null;
  }
): Promise<{ updated: boolean }> {
  const payload: Record<string, unknown> = {
    status: input.status,
  };

  if (input.resultEntityType !== undefined) payload.result_entity_type = input.resultEntityType;
  if (input.resultEntityId !== undefined) payload.result_entity_id = input.resultEntityId;
  if (input.executedAt !== undefined) payload.executed_at = input.executedAt;
  if (input.errorMessage !== undefined) payload.error_message = input.errorMessage;

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

  const { data, error } = await supabase
    .from("ai_pending_actions")
    .update(payload)
    .eq("id", actionId)
    .select("id");

  if (error) {
    throw new Error("Failed to update pending action");
  }

  return { updated: Array.isArray(data) && data.length > 0 };
}

export async function cleanupStrandedPendingActions(
  supabase: PendingActionSupabase,
  input: {
    organizationId: string;
    olderThanIso: string;
    failureMessage?: string;
  }
): Promise<{ scanned: number; recovered: number; skipped: number }> {
  const { data, error } = await supabase
    .from("ai_pending_actions")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("status", "confirmed")
    .lt("updated_at", input.olderThanIso);

  if (error) {
    throw new Error("Failed to load stranded pending actions");
  }

  const rows = Array.isArray(data) ? data : [];
  let recovered = 0;
  let skipped = 0;

  for (const row of rows) {
    const actionId =
      row && typeof row === "object" && "id" in row && typeof row.id === "string"
        ? row.id
        : null;

    if (!actionId) {
      skipped += 1;
      continue;
    }

    const result = await updatePendingActionStatus(supabase, actionId, {
      status: "failed",
      expectedStatus: "confirmed",
      errorMessage: input.failureMessage ?? "Execution timed out after confirmation",
    });

    if (result.updated) {
      recovered += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    scanned: rows.length,
    recovered,
    skipped,
  };
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
    case "create_announcement":
      return {
        title: "Review announcement",
        description: "Confirm the drafted announcement before it is published.",
      };
    case "create_job_posting":
      return {
        title: "Review job posting",
        description: "Confirm the drafted job before it is added to the jobs board.",
      };
    case "send_chat_message":
      return {
        title: "Review chat message",
        description: "Confirm the drafted chat message before it is sent.",
      };
    case "send_group_chat_message":
      return {
        title: "Review group chat message",
        description: "Confirm the drafted message before it is sent to the chat group.",
      };
    case "create_discussion_reply":
      return {
        title: "Review discussion reply",
        description: "Confirm the drafted reply before it is posted to the discussion thread.",
      };
    case "create_discussion_thread":
      return {
        title: "Review discussion thread",
        description: "Confirm the drafted thread before it is posted to discussions.",
      };
    case "create_event":
      return {
        title: "Review event",
        description: "Confirm the drafted event before it is added to the calendar.",
      };
    case "create_enterprise_invite":
      return {
        title: "Review enterprise invite",
        description: "Confirm the drafted enterprise invite before it is created.",
      };
    case "revoke_enterprise_invite":
      return {
        title: "Revoke enterprise invite",
        description: "Confirm that this enterprise invite should be revoked.",
      };
    default:
      return {
        title: "Review action",
        description: "Confirm this assistant action before it runs.",
      };
  }
}
