import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Button, Badge, EmptyState } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import type { Form } from "@/types/database";

interface AdminFormsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AdminFormsPage({ params }: AdminFormsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}/forms`);

  const orgId = orgCtx.organization.id;

  // Fetch all forms (including inactive)
  const { data: forms } = await supabase
    .from("forms")
    .select("*")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Get submission counts per form
  const { data: submissionCounts } = await supabase
    .from("form_submissions")
    .select("form_id")
    .eq("organization_id", orgId);

  const countByForm = new Map<string, number>();
  submissionCounts?.forEach((s) => {
    countByForm.set(s.form_id, (countByForm.get(s.form_id) || 0) + 1);
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Manage Forms"
        description="Create and manage organization forms"
        backHref={`/${orgSlug}/forms`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/${orgSlug}/forms/admin/documents`}>
              <Button variant="secondary">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                Document Forms
              </Button>
            </Link>
            <Link href={`/${orgSlug}/forms/admin/new`}>
              <Button>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Create Form
              </Button>
            </Link>
          </div>
        }
      />

      {forms && forms.length > 0 ? (
        <div className="space-y-4">
          {(forms as Form[]).map((form) => {
            const submissionCount = countByForm.get(form.id) || 0;
            return (
              <Card key={form.id} className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground truncate">{form.title}</h3>
                      <Badge variant={form.is_active ? "success" : "muted"}>
                        {form.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {form.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {form.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{(form.fields as unknown[])?.length || 0} fields</span>
                      <span>{submissionCount} submission{submissionCount !== 1 ? "s" : ""}</span>
                      <span>Created {new Date(form.created_at!).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/${orgSlug}/forms/admin/${form.id}`}>
                      <Button variant="secondary" size="sm">View Submissions</Button>
                    </Link>
                    <Link href={`/${orgSlug}/forms/admin/${form.id}/edit`}>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="No forms yet"
            description="Create your first form for members to fill out."
            action={
              <Link href={`/${orgSlug}/forms/admin/new`}>
                <Button>Create First Form</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}
