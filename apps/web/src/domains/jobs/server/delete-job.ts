export type DeleteJobResult =
  | { ok: true; jobId: string }
  | { ok: false; status: number; error: string };

export async function deleteJobPosting(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  jobId: string;
  actorUserId: string;
  requireAdmin?: boolean;
}): Promise<DeleteJobResult> {
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
    return { ok: false, status: 403, error: "Only the job author or admins can delete this job" };
  }

  const { error } = await input.supabase
    .from("job_postings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.jobId);

  if (error) return { ok: false, status: 500, error: "Failed to delete job" };
  return { ok: true, jobId: input.jobId };
}
