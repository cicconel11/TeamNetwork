import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { createReplySchema, type CreateReplyForm } from "@/lib/schemas/discussion";

type DatabaseClient = SupabaseClient<Database>;

type DiscussionThreadSummary = Pick<
  Database["public"]["Tables"]["discussion_threads"]["Row"],
  "id" | "title" | "organization_id" | "is_locked"
>;

export interface CreateDiscussionReplyRequest {
  supabase: DatabaseClient;
  threadId: string;
  userId: string;
  input: CreateReplyForm;
  orgId?: string;
}

export type CreateDiscussionReplyResult =
  | {
      ok: true;
      status: 201;
      reply: Database["public"]["Tables"]["discussion_replies"]["Row"];
      thread: DiscussionThreadSummary;
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 500;
      error: string;
      details?: string[];
    };

export async function createDiscussionReply(
  request: CreateDiscussionReplyRequest
): Promise<CreateDiscussionReplyResult> {
  const validationResult = createReplySchema.safeParse(request.input);
  if (!validationResult.success) {
    const details = validationResult.error.issues.map(
      (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`
    );
    return {
      ok: false,
      status: 400,
      error: "Validation failed",
      details,
    };
  }

  const { data: thread } = await request.supabase
    .from("discussion_threads")
    .select("id, title, organization_id, is_locked")
    .eq("id", request.threadId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!thread) {
    return { ok: false, status: 404, error: "Thread not found" };
  }

  if (request.orgId && thread.organization_id !== request.orgId) {
    return { ok: false, status: 404, error: "Thread not found" };
  }

  if (thread.is_locked) {
    return { ok: false, status: 403, error: "Thread is locked" };
  }

  const membership = await getOrgMembership(request.supabase, request.userId, thread.organization_id);
  if (!membership) {
    return { ok: false, status: 403, error: "Not a member of this organization" };
  }

  const { data: reply, error } = await request.supabase
    .from("discussion_replies")
    .insert({
      thread_id: request.threadId,
      organization_id: thread.organization_id,
      author_id: request.userId,
      body: validationResult.data.body,
    })
    .select()
    .single();

  if (error || !reply) {
    return { ok: false, status: 500, error: "Failed to create reply" };
  }

  return {
    ok: true,
    status: 201,
    reply,
    thread,
  };
}
