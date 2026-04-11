/** Minimal interface satisfied by any Supabase client instance. */
interface AnySupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(relation: string): any;
}

export type ThreadResolution =
  | { ok: true; thread: { id: string; user_id: string; org_id: string; surface: string; title: string | null } }
  | { ok: false; status: 404; message: string };

export async function resolveOwnThread(
  threadId: string,
  userId: string,
  orgId: string,
  serviceSupabase: AnySupabaseClient
): Promise<ThreadResolution> {
  // Uses a privileged lookup, but normalizes all inaccessible cases to 404 so
  // thread existence is never exposed to callers outside the owner+org scope.
  const { data: thread, error } = await serviceSupabase
    .from("ai_threads")
    .select("id, user_id, org_id, surface, title")
    .eq("id", threadId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[thread-resolver] query failed:", error);
    return { ok: false, status: 404, message: "Thread not found" };
  }

  if (!thread) {
    return { ok: false, status: 404, message: "Thread not found" };
  }

  if (thread.user_id !== userId || thread.org_id !== orgId) {
    return { ok: false, status: 404, message: "Thread not found" };
  }

  return { ok: true, thread };
}
