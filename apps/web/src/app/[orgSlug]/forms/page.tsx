import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Button, Badge, EmptyState } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { Form, FormDocument } from "@teammeet/types";

interface FormsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function FormsPage({ params }: FormsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization || !orgCtx.userId) return null;

  const orgId = orgCtx.organization.id;

  // Fetch active forms
  const { data: forms } = await supabase
    .from("forms")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Fetch active document forms
  const { data: documents } = await supabase
    .from("form_documents")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Fetch user's submissions to know which forms they've filled
  const { data: submissions } = await supabase
    .from("form_submissions")
    .select("form_id")
    .eq("organization_id", orgId)
    .eq("user_id", orgCtx.userId);

  const { data: docSubmissions } = await supabase
    .from("form_document_submissions")
    .select("document_id")
    .eq("organization_id", orgId)
    .eq("user_id", orgCtx.userId);

  const submittedFormIds = new Set(submissions?.map((s) => s.form_id) || []);
  const submittedDocIds = new Set(docSubmissions?.map((s) => s.document_id) || []);
  const typedDocs = (documents || []) as FormDocument[];

  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/forms", navConfig);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`View and fill out organization ${pageLabel.toLowerCase()}`}
        actions={
          orgCtx.isAdmin && (
            <Link href={`/${orgSlug}/forms/admin`}>
              <Button variant="secondary">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.204-.107-.397.165-.71.505-.78.929l-.15.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage {pageLabel}
              </Button>
            </Link>
          )
        }
      />

      {forms && forms.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(forms as Form[]).map((form) => {
            const isSubmitted = submittedFormIds.has(form.id);
            return (
              <Card key={form.id} className="p-5">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground">{form.title}</h3>
                    {isSubmitted && (
                      <Badge variant="success">Submitted</Badge>
                    )}
                  </div>
                  {form.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {form.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-muted-foreground">
                      {(form.fields as unknown[])?.length || 0} fields
                    </span>
                    <Link href={`/${orgSlug}/forms/${form.id}`}>
                      <Button size="sm" variant={isSubmitted ? "secondary" : "primary"}>
                        {isSubmitted ? "View / Edit" : "Fill Out"}
                      </Button>
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
            title={`No ${pageLabel.toLowerCase()} available`}
            description={
              orgCtx.isAdmin
                ? `Create a ${pageLabel.toLowerCase().slice(0, -1)} for your organization members to fill out.`
                : `${pageLabel} will appear here when available.`
            }
            action={
              orgCtx.isAdmin && (
                <Link href={`/${orgSlug}/forms/admin/new`}>
                  <Button>Create First Form</Button>
                </Link>
              )
            }
          />
        </Card>
      )}

      {/* Document Forms Section */}
      {typedDocs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Document Forms</h2>
            <Link href={`/${orgSlug}/forms/documents`}>
              <Button variant="secondary" size="sm">View All</Button>
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {typedDocs.slice(0, 3).map((doc) => {
              const isSubmitted = submittedDocIds.has(doc.id);
              return (
                <Card key={doc.id} className="p-5">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4z"/>
                        </svg>
                        <h3 className="font-semibold text-foreground">{doc.title}</h3>
                      </div>
                      {isSubmitted && <Badge variant="success">Submitted</Badge>}
                    </div>
                    {doc.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{doc.description}</p>
                    )}
                    <div className="flex items-center justify-end pt-2">
                      <Link href={`/${orgSlug}/forms/documents/${doc.id}`}>
                        <Button size="sm" variant={isSubmitted ? "secondary" : "primary"}>
                          {isSubmitted ? "View / Resubmit" : "Download & Submit"}
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
