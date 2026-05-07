import type { AiLogContext } from "./logger";
import { aiLog } from "./logger";

/** Minimal interface satisfied by any Supabase client instance. */
interface AnySupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(relation: string): any;
}

export type AiThreadMetadata = {
  last_chat_recipient_member_id?: string;
};

export type ThreadResolution =
  | { ok: true; thread: { id: string; user_id: string; org_id: string; surface: string; title: string | null; metadata: AiThreadMetadata } }
  | { ok: false; status: 404; message: string };

export async function resolveOwnThread(
  threadId: string,
  userId: string,
  orgId: string,
  serviceSupabase: AnySupabaseClient,
  logContext?: AiLogContext
): Promise<ThreadResolution> {
  // Uses a privileged lookup, but normalizes all inaccessible cases to 404 so
  // thread existence is never exposed to callers outside the owner+org scope.
  const { data: thread, error } = await serviceSupabase
    .from("ai_threads")
    .select("id, user_id, org_id, surface, title, metadata")
    .eq("id", threadId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    aiLog("error", "thread-resolver", "query failed", logContext ?? {
      requestId: "unknown_request",
      orgId,
      threadId,
      userId,
    }, { error, lookupThreadId: threadId });
    return { ok: false, status: 404, message: "Thread not found" };
  }

  if (!thread) {
    return { ok: false, status: 404, message: "Thread not found" };
  }

  if (thread.user_id !== userId || thread.org_id !== orgId) {
    return { ok: false, status: 404, message: "Thread not found" };
  }

  const metadata: AiThreadMetadata =
    thread.metadata && typeof thread.metadata === "object" && !Array.isArray(thread.metadata)
      ? (thread.metadata as AiThreadMetadata)
      : {};

  return { ok: true, thread: { ...thread, metadata } };
}
