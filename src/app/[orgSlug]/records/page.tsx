import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Button, EmptyState } from "@/components/ui";
import { SoftDeleteButton } from "@/components/ui/SoftDeleteButton";
import { PageHeader } from "@/components/layout";
import { getOrgContext } from "@/lib/auth/roles";
import { resolveLabel, resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

interface RecordsPageProps {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ category?: string }>;
}

export default async function RecordsPage({ params, searchParams }: RecordsPageProps) {
  const { orgSlug } = await params;
  const filters = await searchParams;

  const { organization: org, isAdmin } = await getOrgContext(orgSlug);

  if (!org) return null;

  const supabase = await createClient();

  // Build query — filter out soft-deleted records
  let query = supabase
    .from("records")
    .select("*")
    .eq("organization_id", org.id)
    .is("deleted_at", null)
    .order("category")
    .order("title");

  if (filters.category) {
    query = query.eq("category", filters.category);
  }

  const { data: records } = await query;

  // Get unique categories for filter — also filter soft-deleted
  const { data: allRecords } = await supabase
    .from("records")
    .select("category")
    .eq("organization_id", org.id)
    .is("deleted_at", null);

  const categories = [...new Set(allRecords?.map((r) => r.category).filter(Boolean))];

  // Group records by category
  const recordsByCategory: Record<string, NonNullable<typeof records>> = (records ?? []).reduce(
    (acc, record) => {
      const category = record.category || "General";
      if (!acc[category]) acc[category] = [];
      acc[category].push(record);
      return acc;
    },
    {} as Record<string, NonNullable<typeof records>>
  );

  const navConfig = org.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/records", navConfig);
  const actionLabel = resolveActionLabel("/records", navConfig);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`${records?.length || 0} ${pageLabel.toLowerCase()} in ${categories.length || 1} categories`}
        actions={
          isAdmin && (
            <Link href={`/${orgSlug}/records/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {actionLabel}
              </Button>
            </Link>
          )
        }
      />

      {/* Category Filters */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-8">
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

      {/* Records by Category — Table Layout */}
      {records && records.length > 0 ? (
        <div className="space-y-10 stagger-children">
          {Object.entries(recordsByCategory).map(([category, categoryRecords]) => (
            <section key={category}>
              <div className="flex items-center gap-2 mb-4">
                <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044-1.35a6.726 6.726 0 01-2.748 1.35m0 0a6.772 6.772 0 01-3.044 0" />
                </svg>
                <h2 className="text-lg font-semibold text-foreground">{category}</h2>
                <Badge variant="muted">{categoryRecords.length}</Badge>
              </div>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left font-medium text-muted-foreground px-4 py-3">Record</th>
                        <th className="text-left font-medium text-muted-foreground px-4 py-3">Holder</th>
                        <th className="text-left font-medium text-muted-foreground px-4 py-3">Value</th>
                        <th className="text-left font-medium text-muted-foreground px-4 py-3 w-20">Year</th>
                        {isAdmin && (
                          <th className="text-right font-medium text-muted-foreground px-4 py-3 w-28">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {categoryRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <span className="font-medium text-foreground">{record.title}</span>
                            {record.notes && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{record.notes}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-foreground">{record.holder_name}</td>
                          <td className="px-4 py-3 font-mono font-semibold text-org-primary">{record.value}</td>
                          <td className="px-4 py-3 text-muted-foreground tabular-nums">{record.year ?? "—"}</td>
                          {isAdmin && (
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <Link
                                  href={`/${orgSlug}/records/${record.id}/edit`}
                                  className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  Edit
                                </Link>
                                <SoftDeleteButton
                                  table="records"
                                  id={record.id}
                                  organizationField="organization_id"
                                  organizationId={org.id}
                                  label="Delete"
                                  confirmMessage="Are you sure you want to delete this record? It will be removed from the record book."
                                />
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
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
            title={`No ${pageLabel.toLowerCase()} yet`}
            description={`Add ${pageLabel.toLowerCase()} to create your organization's record book`}
            action={
              isAdmin && (
                <Link href={`/${orgSlug}/records/new`}>
                  <Button>{resolveActionLabel("/records", navConfig, "Add First")}</Button>
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
