import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { PageHeader } from "@/components/layout";
import { JobForm } from "@/components/jobs/JobForm";

interface PageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function NewJobPage({ params }: PageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  // Check configurable job posting roles
  const jobPostRoles = (orgCtx.organization as Record<string, unknown>).job_post_roles as string[] || ["admin", "alumni"];
  const canPost = orgCtx.role ? jobPostRoles.includes(orgCtx.role) : false;
  if (!canPost) {
    return notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Post a Job"
        description="Share a career opportunity with the community"
      />

      <div className="max-w-3xl">
        <JobForm
          orgId={orgCtx.organization.id}
          orgSlug={orgSlug}
        />
      </div>
    </div>
  );
}
