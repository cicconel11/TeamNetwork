import { z } from "zod";
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

// Single source of truth for the draft_type enum. The prior CHECK constraint
// (see migration 20261101000000) was dropped; this tuple plus the Zod guard in
// saveDraftSession enforces the contract at the application boundary.
export const DRAFT_SESSION_TYPES = [
  "create_announcement",
  "create_job_posting",
  "send_chat_message",
  "send_group_chat_message",
  "create_discussion_reply",
  "create_discussion_thread",
  "create_event",
] as const;

export type DraftSessionType = (typeof DRAFT_SESSION_TYPES)[number];

export interface DraftSessionPayloadByType {
  create_announcement: AssistantAnnouncementDraft;
  create_job_posting: AssistantJobDraft;
  send_chat_message: AssistantChatMessageDraft;
  send_group_chat_message: AssistantGroupMessageDraft;
  create_discussion_reply: AssistantDiscussionReplyDraft;
  create_discussion_thread: AssistantDiscussionDraft;
  create_event: AssistantEventDraft;
}

// Compile fails if DRAFT_SESSION_TYPES and DraftSessionPayloadByType diverge.
type _MissingFromPayload = Exclude<DraftSessionType, keyof DraftSessionPayloadByType>;
type _MissingFromTypes = Exclude<keyof DraftSessionPayloadByType, DraftSessionType>;
type _DraftSessionCoverageOK = [
  _MissingFromPayload,
  _MissingFromTypes,
] extends [never, never]
  ? true
  : never;
const _draftSessionCoverageOK: _DraftSessionCoverageOK = true;
void _draftSessionCoverageOK;

const draftSessionTypeSchema = z.enum(DRAFT_SESSION_TYPES);

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
  order(
    column: string,
    options: { ascending: boolean }
  ): DraftSessionSelectChain;
  limit(count: number): DraftSessionSelectChain;
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
    // When provided, narrows the lookup to a specific draft type — required
    // for any caller that needs to discriminate between concurrent drafts
    // (e.g. a `create_announcement` vs `edit_announcement` draft on the
    // same thread). When omitted, returns the most-recently-updated draft
    // of any type for backwards compatibility with legacy "do they have an
    // active draft?" callers.
    draftType?: DraftSessionType;
  }
): Promise<DraftSessionRecord | null> {
  let chain = supabase
    .from("ai_draft_sessions")
    .select("*")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId);

  if (input.draftType) {
    chain = chain.eq("draft_type", input.draftType);
  }

  // order + limit keeps `.maybeSingle()` safe once the unique key widens
  // to (thread_id, draft_type): a thread can legitimately carry multiple
  // rows after widening, and un-narrowed callers want the most recent.
  const { data, error } = await chain
    .order("updated_at", { ascending: false })
    .limit(1)
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
  if (!draftSessionTypeSchema.safeParse(input.draftType).success) {
    throw new Error(`Invalid draft_type: ${String(input.draftType)}`);
  }

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

  // Existence check narrowed to draft_type so two draft types on the same
  // thread round-trip as two rows under the widened (thread_id, draft_type)
  // unique key.
  const existing = await getDraftSession(supabase, {
    organizationId: input.organizationId,
    userId: input.userId,
    threadId: input.threadId,
    draftType: input.draftType,
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
    // When provided, clears only the matching draft type. When omitted,
    // clears every draft type for the thread (the legacy behaviour —
    // still valid for callers that want a blanket reset).
    draftType?: DraftSessionType;
  }
): Promise<void> {
  let query = supabase
    .from("ai_draft_sessions")
    .delete()
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId);

  if (input.draftType) {
    query = query.eq("draft_type", input.draftType);
  }

  if (input.pendingActionId) {
    query = query.eq("pending_action_id", input.pendingActionId);
  }

  const { error } = await query;
  if (error) {
    throw new Error("Failed to clear draft session");
  }
}
