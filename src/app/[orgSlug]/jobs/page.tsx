import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { JobList } from "@/components/jobs/JobList";
import { JobsFilters } from "@/components/jobs/JobsFilters";
import Link from "next/link";
import { Button } from "@/components/ui";

interface PageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    page?: string;
    q?: string;
    type?: string;
    level?: string;
    location?: string;
    company?: string;
    industry?: string;
  }>;
}

export default async function JobsPage({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const {
    page: pageParam,
    q,
    type,
    level,
    location,
    company,
    industry,
  } = await searchParams;
  const orgCtx = await getOrgContext(orgSlug);

  if (!orgCtx.organization) {
    return notFound();
  }

  const supabase = await createClient();
  const jobPostRoles = (orgCtx.organization as Record<string, unknown>).job_post_roles as string[] || ["admin", "alumni"];
  const canPost = orgCtx.role ? jobPostRoles.includes(orgCtx.role) : false;

  // Fetch ALL active jobs (for extracting unique filter values)
  const { data: allJobs } = await supabase
    .from("job_postings")
    .select("location, company, industry")
    .eq("organization_id", orgCtx.organization.id)
    .eq("is_active", true)
    .is("deleted_at", null);

  const allJobRows = allJobs || [];
  const uniqueLocations = allJobRows.map((j) => j.location);
  const uniqueCompanies = allJobRows.map((j) => j.company);
  const uniqueIndustries = allJobRows.map((j) => j.industry);

  // Build filtered query with pagination
  const page = parseInt(pageParam || "1", 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = supabase
    .from("job_postings")
    .select("*, users!job_postings_posted_by_fkey(name)", { count: "exact", head: false })
    .eq("organization_id", orgCtx.organization.id)
    .eq("is_active", true)
    .is("deleted_at", null);

  // Apply filters
  if (q) {
    query = query.or(`title.ilike.%${q}%,company.ilike.%${q}%`);
  }
  if (type) {
    query = query.eq("location_type", type);
  }
  if (level) {
    query = query.eq("experience_level", level);
  }
  if (location) {
    query = query.ilike("location", location);
  }
  if (company) {
    query = query.ilike("company", company);
  }
  if (industry) {
    query = query.ilike("industry", industry);
  }

  const { data: jobs, count } = await query
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

  // Build filter params string for pagination links
  const filterEntries: [string, string][] = [];
  if (q) filterEntries.push(["q", q]);
  if (type) filterEntries.push(["type", type]);
  if (level) filterEntries.push(["level", level]);
  if (location) filterEntries.push(["location", location]);
  if (company) filterEntries.push(["company", company]);
  if (industry) filterEntries.push(["industry", industry]);
  const filterParams = new URLSearchParams(filterEntries).toString();

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

      <JobsFilters
        orgId={orgCtx.organization.id}
        locations={uniqueLocations}
        companies={uniqueCompanies}
        industries={uniqueIndustries}
      />

      <JobList
        jobs={activeJobs}
        orgSlug={orgSlug}
        pagination={{ page, limit, total, totalPages }}
        filterParams={filterParams}
      />
    </div>
  );
}
