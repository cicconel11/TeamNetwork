import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { isOrgAdmin } from "@/lib/auth";

interface RecordsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ category?: string }>;
}

export default async function RecordsPage({ params, searchParams }: RecordsPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;
  const supabase = await createClient();

  // Fetch organization
  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", orgSlug)
    .single();

  if (!org) return null;

  const isAdmin = await isOrgAdmin(org.id);

  // Build query
  let query = supabase
    .from("records")
    .select("*")
    .eq("organization_id", org.id)
    .order("category")
    .order("title");

  if (filters.category) {
    query = query.eq("category", filters.category);
  }

  const { data: records } = await query;

  // Get unique categories for filter
  const { data: allRecords } = await supabase
    .from("records")
    .select("category")
    .eq("organization_id", org.id);
  
  const categories = [...new Set(allRecords?.map((r) => r.category).filter(Boolean))];

  // Group records by category
  type RecordItem = NonNullable<typeof records>[number];
  const recordsByCategory = records?.reduce((acc, record) => {
    const category = record.category || "General";
    if (!acc[category]) acc[category] = [];
    acc[category].push(record);
    return acc;
  }, {} as Record<string, RecordItem[]>) || {};

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Record Book"
        description={`${records?.length || 0} records in ${categories.length || 1} categories`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/records/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Record
              </Button>
            </Link>
          )
        }
      />

      {/* Category Filters */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <Link
            href={`/${orgSlug}/records`}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              !filters.category
                ? "bg-org-primary text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            All Categories
          </Link>
          {categories.map((category) => (
            <Link
              key={category}
              href={`/${orgSlug}/records?category=${encodeURIComponent(category!)}`}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                filters.category === category
                  ? "bg-org-primary text-white"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {category}
            </Link>
          ))}
        </div>
      )}

      {/* Records by Category */}
      {records && records.length > 0 ? (
        <div className="space-y-8 stagger-children">
          {(Object.entries(recordsByCategory) as [string, RecordItem[]][]).map(([category, categoryRecords]) => (
            <div key={category}>
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0"/>
                </svg>
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {categoryRecords?.map((record) => (
                  <Card key={record.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground">{record.title}</h3>
                        <p className="text-2xl font-bold text-org-primary mt-1 font-mono">
                          {record.value}
                        </p>
                        <p className="text-sm text-muted-foreground mt-2">
                          {record.holder_name}
                          {record.year && ` • ${record.year}`}
                        </p>
                      </div>
                      {record.year && (
                        <Badge variant="muted">{record.year}</Badge>
                      )}
                    </div>
                    {record.notes && (
                      <p className="text-sm text-muted-foreground mt-3 pt-3 border-t border-border">
                        {record.notes}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0" />
              </svg>
            }
            title="No records yet"
            description="Add records to create your organization's record book"
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/records/new`}>
                  <Button>Add First Record</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}

