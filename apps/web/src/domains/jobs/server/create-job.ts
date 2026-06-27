import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { createJobSchema, type CreateJobForm } from "@/lib/schemas/jobs";
import { linkMediaToEntity } from "@/lib/media/link";

type DatabaseClient = SupabaseClient<Database>;

export interface CreateJobRequest {
  supabase: DatabaseClient;
  serviceSupabase: DatabaseClient;
  orgId: string;
  userId: string;
  input: CreateJobForm;
}

export type CreateJobResult =
  | {
      ok: true;
      status: 201;
      job: Database["public"]["Tables"]["job_postings"]["Row"];
      headers?: HeadersInit;
    }
  | {
      ok: false;
      status: 400 | 403 | 500;
      error: string;
      details?: string[];
      headers?: HeadersInit;
    };

export async function createJobPosting(request: CreateJobRequest): Promise<CreateJobResult> {
  const validationResult = createJobSchema.safeParse(request.input);
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

  const membership = await getOrgMembership(request.supabase, request.userId, request.orgId);
  if (!membership) {
    return { ok: false, status: 403, error: "Not a member of this organization" };
  }

  const { data: org, error: orgError } = await request.supabase
    .from("organizations")
    .select("job_post_roles")
    .eq("id", request.orgId)
    .maybeSingle();

  if (orgError) {
    return { ok: false, status: 500, error: "Failed to verify job posting permissions" };
  }

  const allowedRoles = (org as Record<string, unknown> | null)?.job_post_roles as string[] || ["admin", "alumni"];
  if (!allowedRoles.includes(membership.role)) {
    return { ok: false, status: 403, error: "You do not have permission to post jobs" };
  }

  const { mediaIds, ...jobInsertData } = validationResult.data;
  const { data: job, error } = await request.supabase
    .from("job_postings")
    .insert({
      organization_id: request.orgId,
      posted_by: request.userId,
      ...jobInsertData,
    })
    .select("*")
    .single();

  if (error || !job) {
    return { ok: false, status: 500, error: "Failed to create job" };
  }

  if (mediaIds && mediaIds.length > 0) {
    const linkResult = await linkMediaToEntity(request.serviceSupabase, {
      mediaIds,
      entityType: "job_posting",
      entityId: job.id,
      orgId: request.orgId,
      userId: request.userId,
    });

    if (linkResult.error) {
      await request.serviceSupabase
        .from("job_postings")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", job.id);

      return { ok: false, status: 400, error: linkResult.error };
    }
  }

  return {
    ok: true,
    status: 201,
    job,
  };
}
