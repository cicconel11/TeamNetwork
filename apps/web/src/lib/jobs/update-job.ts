import { updateJobSchema, type UpdateJobForm } from "@/lib/schemas/jobs";

export type UpdateJobResult =
  | { ok: true; job: Record<string, unknown> }
  | { ok: false; status: number; error: string; details?: string[] };

export async function updateJobPosting(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  jobId: string;
  actorUserId: string;
  data: UpdateJobForm;
  requireAdmin?: boolean;
}): Promise<UpdateJobResult> {
  const validationResult = updateJobSchema.safeParse(input.data);
  if (!validationResult.success) {
    return {
      ok: false,
      status: 400,
      error: "Validation failed",
      details: validationResult.error.issues.map(
        (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
      ),
    };
  }

  const { data: existingJob, error: fetchError } = await input.supabase
    .from("job_postings")
    .select("organization_id, posted_by")
    .eq("id", input.jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError) return { ok: false, status: 500, error: "Failed to fetch job" };
  if (!existingJob) return { ok: false, status: 404, error: "Job not found" };

  const { data: membership, error: membershipError } = await input.supabase
    .from("organization_members")
    .select("role, status")
    .eq("organization_id", existingJob.organization_id)
    .eq("user_id", input.actorUserId)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError) return { ok: false, status: 500, error: "Failed to verify permissions" };
  if (!membership) return { ok: false, status: 403, error: "Not a member of this organization" };

  const isAdmin = membership.role === "admin";
  const isAuthor = existingJob.posted_by === input.actorUserId;
  if (input.requireAdmin ? !isAdmin : !isAuthor && !isAdmin) {
    return { ok: false, status: 403, error: "Only the job author or admins can edit this job" };
  }

  const jobUpdateData = { ...validationResult.data };
  delete jobUpdateData.mediaIds;
  const { data: job, error } = await input.supabase
    .from("job_postings")
    .update({ ...jobUpdateData, updated_at: new Date().toISOString() })
    .eq("id", input.jobId)
    .select("*")
    .single();

  if (error) return { ok: false, status: 500, error: "Failed to update job" };
  return { ok: true, job };
}
