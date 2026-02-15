import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { JobList } from "@/components/jobs/JobList";
import Link from "next/link";
import { Button } from "@/components/ui";

interface PageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export default async function JobsPage({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const { page: pageParam } = await searchParams;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  const supabase = await createClient();
  const canPost = orgCtx.isAdmin || orgCtx.role === "alumni";

  // Parse pagination params
  const page = parseInt(pageParam || "1", 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  const { data: jobs, count } = await supabase
    .from("job_postings")
    .select("*, users!job_postings_posted_by_fkey(name)", { count: "exact", head: false })
    .eq("organization_id", orgCtx.organization.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Filter out expired jobs
  const now = new Date();
  const activeJobs = (jobs || []).filter((job) => {
    if (!job.expires_at) return true;
    return new Date(job.expires_at) > now;
  });

  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description="Career opportunities shared by our community"
        actions={
          canPost && (
            <Link href={`/${orgSlug}/jobs/new`}>
              <Button>Post a Job</Button>
            </Link>
          )
        }
      />

      <JobList jobs={activeJobs} orgSlug={orgSlug} pagination={{ page, limit, total, totalPages }} />
    </div>
  );
}
