import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { createThreadSchema, type CreateThreadForm } from "@/lib/schemas/discussion";
import { linkMediaToEntity } from "@/lib/media/link";
import { notifyNewThread } from "@/lib/discussions/notifications";

type DatabaseClient = SupabaseClient<Database>;

export interface CreateDiscussionThreadDeps {
  getOrgMembership?: typeof getOrgMembership;
  linkMediaToEntity?: typeof linkMediaToEntity;
  notifyNewThread?: typeof notifyNewThread;
}

export interface CreateDiscussionThreadRequest {
  supabase: DatabaseClient;
  serviceSupabase: DatabaseClient;
  orgId: string;
  userId: string;
  input: CreateThreadForm;
  orgSlug?: string | null;
  deps?: CreateDiscussionThreadDeps;
}

export type CreateDiscussionThreadResult =
  | {
      ok: true;
      status: 201;
      thread: Database["public"]["Tables"]["discussion_threads"]["Row"];
      threadUrl: string;
      headers?: HeadersInit;
    }
  | {
      ok: false;
      status: 400 | 403 | 500;
      error: string;
      details?: string[];
      headers?: HeadersInit;
    };

function buildThreadUrl(orgSlug: string | null | undefined, threadId: string): string | null {
  if (typeof orgSlug !== "string" || orgSlug.trim().length === 0) {
    return null;
  }
  return `/${orgSlug}/messages/threads/${threadId}`;
}

export async function createDiscussionThread(
  request: CreateDiscussionThreadRequest
): Promise<CreateDiscussionThreadResult> {
  const getOrgMembershipFn = request.deps?.getOrgMembership ?? getOrgMembership;
  const linkMediaToEntityFn = request.deps?.linkMediaToEntity ?? linkMediaToEntity;
  const notifyNewThreadFn = request.deps?.notifyNewThread ?? notifyNewThread;

  const validationResult = createThreadSchema.safeParse(request.input);
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

  const membership = await getOrgMembershipFn(request.supabase, request.userId, request.orgId);
  if (!membership) {
    return { ok: false, status: 403, error: "Not a member of this organization" };
  }

  const { data: org, error: orgError } = await request.supabase
    .from("organizations")
    .select("slug, discussion_post_roles")
    .eq("id", request.orgId)
    .maybeSingle();

  if (orgError) {
    return { ok: false, status: 500, error: "Failed to verify discussion posting permissions" };
  }

  const allowedRoles =
    ((org as Record<string, unknown> | null)?.discussion_post_roles as string[] | undefined) ??
    ["admin", "active_member", "alumni"];
  if (!allowedRoles.includes(membership.role)) {
    return { ok: false, status: 403, error: "You do not have permission to create discussions" };
  }

  const { data: authorUser } = await request.supabase
    .from("users")
    .select("name")
    .eq("id", request.userId)
    .maybeSingle();

  const { mediaIds, ...threadInsertData } = validationResult.data;
  const { data: thread, error } = await request.supabase
    .from("discussion_threads")
    .insert({
      organization_id: request.orgId,
      author_id: request.userId,
      ...threadInsertData,
    })
    .select("*")
    .single();

  if (error || !thread) {
    return { ok: false, status: 500, error: "Failed to create thread" };
  }

  if (mediaIds && mediaIds.length > 0) {
    const linkResult = await linkMediaToEntityFn(request.serviceSupabase, {
      mediaIds,
      entityType: "discussion_thread",
      entityId: thread.id,
      orgId: request.orgId,
      userId: request.userId,
    });

    if (linkResult.error) {
      await request.serviceSupabase
        .from("discussion_threads")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", thread.id);

      return { ok: false, status: 400, error: linkResult.error };
    }
  }

  const threadUrl =
    buildThreadUrl(request.orgSlug ?? (typeof org?.slug === "string" ? org.slug : null), thread.id) ??
    `/messages/threads/${thread.id}`;

  notifyNewThreadFn({
    supabase: request.supabase,
    organizationId: request.orgId,
    threadTitle: validationResult.data.title,
    threadUrl,
    authorName: authorUser?.name || "A member",
  }).catch(() => {
    // Notification failure should not affect thread creation.
  });

  return {
    ok: true,
    status: 201,
    thread,
    threadUrl,
  };
}
