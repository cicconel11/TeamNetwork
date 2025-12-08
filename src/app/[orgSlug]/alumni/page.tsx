import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Avatar, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";

interface AlumniPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ year?: string }>;
}

export default async function AlumniPage({ params, searchParams }: AlumniPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const supabase = await createClient();

  // Fetch organization
  const { data: orgs, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .limit(1);

  const org = orgs?.[0];

  if (!org || orgError) return null;

  const isAdmin = await isOrgAdmin(org.id);

  // Build query with filters
  let query = supabase
    .from("alumni")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("graduation_year", { ascending: false });

  if (filters.year) {
    query = query.eq("graduation_year", parseInt(filters.year));
  }

  const { data: alumni } = await query;

  // Get unique graduation years for filter
  const { data: allAlumni } = await supabase
    .from("alumni")
    .select("graduation_year")
    .eq("organization_id", org.id)
    .is("deleted_at", null);
  
  const years = [...new Set(allAlumni?.map((a) => a.graduation_year).filter(Boolean))].sort((a, b) => (b || 0) - (a || 0));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Alumni"
        description={`${alumni?.length || 0} alumni in our network`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/alumni/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Alumni
              </Button>
            </Link>
          )
        }
      />

      {/* Year Filter */}
      {years.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <Link
            href={`/${orgSlug}/alumni`}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              !filters.year
                ? "bg-org-primary text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All Years
          </Link>
          {years.map((year) => (
            <Link
              key={year}
              href={`/${orgSlug}/alumni?year=${year}`}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                filters.year === String(year)
                  ? "bg-org-primary text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {year}
            </Link>
          ))}
        </div>
      )}

      {/* Alumni Grid */}
      {alumni && alumni.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {alumni.map((alum) => (
            <Link key={alum.id} href={`/${orgSlug}/alumni/${alum.id}`}>
              <Card interactive className="p-5">
                <div className="flex items-center gap-4">
                  <Avatar
                    src={alum.photo_url}
                    name={`${alum.first_name} ${alum.last_name}`}
                    size="lg"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate">
                      {alum.first_name} {alum.last_name}
                    </h3>
                    {alum.job_title && (
                      <p className="text-sm text-muted-foreground truncate">{alum.job_title}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      {alum.graduation_year && (
                        <Badge variant="muted">Class of {alum.graduation_year}</Badge>
                      )}
                      {alum.major && (
                        <span className="text-xs text-muted-foreground truncate">
                          {alum.major}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
              </svg>
            }
            title="No alumni found"
            description={filters.year ? `No alumni from ${filters.year}` : "No alumni in the directory yet"}
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/alumni/new`}>
                  <Button>Add First Alumni</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}

