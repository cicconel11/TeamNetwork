import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { JobForm } from "@/components/jobs/JobForm";

interface PageProps {
  params: Promise<{ orgSlug: string; jobId: string }>;
}

export default async function EditJobPage({ params }: PageProps) {
  const { orgSlug, jobId } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  const supabase = await createClient();

  const { data: job } = await supabase
    .from("job_postings")
    .select("*")
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

  if (!canEdit) {
    return notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Job"
        description="Update the job posting details"
      />

      <div className="max-w-3xl">
        <JobForm
          orgId={orgCtx.organization.id}
          orgSlug={orgSlug}
          initialData={{
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            location_type: job.location_type,
            description: job.description,
            application_url: job.application_url,
            contact_email: job.contact_email,
          }}
        />
      </div>
    </div>
  );
}
