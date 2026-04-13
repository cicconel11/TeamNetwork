import type { AssistantAnnouncementDraft } from "@/lib/schemas/content";
import type {
  AssistantDiscussionDraft,
  AssistantDiscussionReplyDraft,
} from "@/lib/schemas/discussion";
import type { AssistantEventDraft } from "@/lib/schemas/events-ai";
import type { AssistantJobDraft } from "@/lib/schemas/jobs";
import type { AssistantChatMessageDraft, AssistantGroupMessageDraft } from "@/lib/schemas/chat-ai";
import { AI_PENDING_ACTION_EXPIRY_MS } from "@/lib/ai/pending-actions";

export type DraftSessionStatus = "collecting_fields" | "ready_for_confirmation";

export interface DraftSessionPayloadByType {
  create_announcement: AssistantAnnouncementDraft;
  create_job_posting: AssistantJobDraft;
  send_chat_message: AssistantChatMessageDraft;
  send_group_chat_message: AssistantGroupMessageDraft;
  create_discussion_reply: AssistantDiscussionReplyDraft;
  create_discussion_thread: AssistantDiscussionDraft;
  create_event: AssistantEventDraft;
}

export type DraftSessionType = keyof DraftSessionPayloadByType;

export type DraftSessionPayload = DraftSessionPayloadByType[DraftSessionType];

export interface DraftSessionRecord<TDraftType extends DraftSessionType = DraftSessionType> {
  id: string;
  organization_id: string;
  user_id: string;
  thread_id: string;
  draft_type: TDraftType;
  status: DraftSessionStatus;
  draft_payload: DraftSessionPayloadByType[TDraftType];
  missing_fields: string[];
  pending_action_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface DraftSessionSelectChain {
  eq(column: string, value: string): DraftSessionSelectChain;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
}

interface DraftSessionUpdateChain {
  eq(column: string, value: string): DraftSessionUpdateChain;
  select(columns: string): Promise<{ data: unknown[] | null; error: unknown }>;
}

interface DraftSessionDeleteChain {
  eq(column: string, value: string): DraftSessionDeleteChain & Promise<{ error: unknown }>;
}

interface DraftSessionQueryBuilder {
  insert(payload: Record<string, unknown>): {
    select(columns: string): {
      single(): Promise<{ data: unknown; error: unknown }>;
    };
  };
  select(columns: string): DraftSessionSelectChain;
  update(payload: Record<string, unknown>): DraftSessionUpdateChain;
  delete(): DraftSessionDeleteChain;
}

interface DraftSessionSupabase {
  from(table: "ai_draft_sessions"): DraftSessionQueryBuilder;
}

export function supportsDraftSessionsStore(
  supabase: unknown
): supabase is DraftSessionSupabase {
  return (
    supabase != null &&
    typeof supabase === "object" &&
    "from" in supabase &&
    typeof (supabase as { from?: unknown }).from === "function"
  );
}

export function isDraftSessionExpired(record: DraftSessionRecord): boolean {
  return new Date(record.expires_at).getTime() <= Date.now();
}

export async function getDraftSession(
  supabase: DraftSessionSupabase,
  input: {
    organizationId: string;
    userId: string;
    threadId: string;
  }
): Promise<DraftSessionRecord | null> {
  const { data, error } = await supabase
    .from("ai_draft_sessions")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load draft session");
  }

  return (data as DraftSessionRecord | null) ?? null;
}

export async function saveDraftSession(
  supabase: DraftSessionSupabase,
  input: {
    organizationId: string;
    userId: string;
    threadId: string;
    draftType: DraftSessionType;
    status: DraftSessionStatus;
    draftPayload: DraftSessionPayload;
    missingFields: string[];
    pendingActionId?: string | null;
    expiresAt?: string;
  }
): Promise<DraftSessionRecord> {
  const payload = {
    organization_id: input.organizationId,
    user_id: input.userId,
    thread_id: input.threadId,
    draft_type: input.draftType,
    status: input.status,
    draft_payload: input.draftPayload,
    missing_fields: input.missingFields,
    pending_action_id: input.pendingActionId ?? null,
    expires_at:
      input.expiresAt ?? new Date(Date.now() + AI_PENDING_ACTION_EXPIRY_MS).toISOString(),
  };

  const existing = await getDraftSession(supabase, {
    organizationId: input.organizationId,
    userId: input.userId,
    threadId: input.threadId,
  });

  if (existing) {
    const { data, error } = await supabase
      .from("ai_draft_sessions")
      .update(payload)
      .eq("id", existing.id)
      .select("*");

    if (error || !Array.isArray(data) || data.length === 0) {
      throw new Error("Failed to update draft session");
    }

    return data[0] as DraftSessionRecord;
  }

  const { data, error } = await supabase
    .from("ai_draft_sessions")
    .insert(payload)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error("Failed to create draft session");
  }

  return data as DraftSessionRecord;
}

export async function clearDraftSession(
  supabase: DraftSessionSupabase,
  input: {
    organizationId: string;
    userId: string;
    threadId: string;
    pendingActionId?: string | null;
  }
): Promise<void> {
  let query = supabase
    .from("ai_draft_sessions")
    .delete()
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId);

  if (input.pendingActionId) {
    query = query.eq("pending_action_id", input.pendingActionId);
  }

  const { error } = await query;
  if (error) {
    throw new Error("Failed to clear draft session");
  }
}
