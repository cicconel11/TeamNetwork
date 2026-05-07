import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { JobDetail } from "@/components/jobs/JobDetail";

interface PageProps {
  params: Promise<{ orgSlug: string; jobId: string }>;
}

export default async function JobDetailPage({ params }: PageProps) {
  const { orgSlug, jobId } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  const supabase = await createClient();

  const { data: job } = await supabase
    .from("job_postings")
    .select("*, users!job_postings_posted_by_fkey(name, email)")
    .eq("id", jobId)
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!job) {
    return notFound();
  }

  const { data: { user } } = await supabase.auth.getUser();
  const isAuthor = user?.id === job.posted_by;
  const canEdit = isAuthor || orgCtx.isAdmin;

  return (
    <JobDetail
      job={job}
      orgSlug={orgSlug}
      canEdit={canEdit}
    />
  );
}
