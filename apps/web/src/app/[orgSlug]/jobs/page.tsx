/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound } from "next/navigation";
import { getOrgContext } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { JobList } from "@/components/jobs/JobList";
import { JobsFilters } from "@/components/jobs/JobsFilters";
import Link from "next/link";
import { Button } from "@/components/ui";
import { sanitizeIlikeInput } from "@/lib/security/validation";

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
  const org = orgCtx.organization;
  const jobPostRoles = (org as Record<string, unknown>).job_post_roles as string[] || ["admin", "alumni"];
  const canPost = orgCtx.role ? jobPostRoles.includes(orgCtx.role) : false;

  // Build filtered query with pagination
  const page = parseInt(pageParam || "1", 10);
  const limit = 20;
  const offset = (page - 1) * limit;

  const applyStructuredFilters = (query: any) => {
    let nextQuery = query
      .eq("organization_id", org.id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .or("expires_at.is.null,expires_at.gt.now()");

    if (q) {
      const sanitizedQ = sanitizeIlikeInput(q).replace(/,/g, "");
      nextQuery = nextQuery.or(`title.ilike.%${sanitizedQ}%,company.ilike.%${sanitizedQ}%`);
    }

    if (type) {
      nextQuery = nextQuery.eq("location_type", type);
    }
    if (level) {
      nextQuery = nextQuery.eq("experience_level", level);
    }
    if (location) {
      nextQuery = nextQuery.ilike("location", sanitizeIlikeInput(location));
    }
    if (company) {
      nextQuery = nextQuery.ilike("company", sanitizeIlikeInput(company));
    }
    if (industry) {
      nextQuery = nextQuery.ilike("industry", sanitizeIlikeInput(industry));
    }

    return nextQuery;
  };

  // Run filter-options and main query in parallel
  const filterOptionsPromise = supabase
    .from("job_postings")
    .select("location, company, industry")
    .eq("organization_id", org.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .or("expires_at.is.null,expires_at.gt.now()");

  const mainQueryPromise = applyStructuredFilters(
    supabase
      .from("job_postings")
      .select("*, users!job_postings_posted_by_fkey(name)", { count: "exact", head: false })
  )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const [{ data: allJobs }, mainResult] = await Promise.all([filterOptionsPromise, mainQueryPromise]);

  const allJobRows = allJobs || [];
  const uniqueLocations = [...new Set(allJobRows.map((j) => j.location).filter(Boolean))];
  const uniqueCompanies = [...new Set(allJobRows.map((j) => j.company).filter(Boolean))];
  const uniqueIndustries = [...new Set(allJobRows.map((j) => j.industry).filter(Boolean))];

  const activeJobs = mainResult.data || [];
  const total = mainResult.count || 0;

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
