import type { AiScope } from "@/lib/ai/scope";
import { toAiScope } from "@/lib/ai/scope";

/** Minimal interface satisfied by any Supabase client instance. */
interface AnySupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(relation: string): any;
}

export interface ResolvedThread {
  id: string;
  user_id: string;
  org_id: string | null;
  enterprise_id: string | null;
  surface: string;
  title: string | null;
}

export type ThreadResolution =
  | { ok: true; thread: ResolvedThread }
  | { ok: false; status: 404; message: string };

/**
 * Resolve a thread the caller owns within the given scope.
 *
 * Backwards-compatible: passing a bare orgId string is treated as
 * `{ scope: "org", orgId }`. Mismatched scope (e.g. enterprise caller asking
 * about an org-scoped thread) returns 404 — never leak existence outside the
 * caller's scope.
 */
export async function resolveOwnThread(
  threadId: string,
  userId: string,
  scopeOrOrgId: string | AiScope,
  serviceSupabase: AnySupabaseClient
): Promise<ThreadResolution> {
  const scope = toAiScope(scopeOrOrgId);

  const { data: thread, error } = await serviceSupabase
    .from("ai_threads")
    .select("id, user_id, org_id, enterprise_id, surface, title")
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

  if (thread.user_id !== userId) {
    return { ok: false, status: 404, message: "Thread not found" };
  }

  // Scope-mismatch defense: a thread tied to a different scope is invisible.
  if (scope.scope === "org") {
    if (thread.org_id !== scope.orgId) {
      return { ok: false, status: 404, message: "Thread not found" };
    }
  } else {
    if (thread.enterprise_id !== scope.enterpriseId) {
      return { ok: false, status: 404, message: "Thread not found" };
    }
  }

  // Normalize: ensure both columns are present in the returned shape.
  return {
    ok: true,
    thread: {
      id: thread.id,
      user_id: thread.user_id,
      org_id: thread.org_id ?? null,
      enterprise_id: thread.enterprise_id ?? null,
      surface: thread.surface,
      title: thread.title,
    },
  };
}
