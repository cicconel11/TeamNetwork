import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Button, Badge, EmptyState } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { resolveLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { Form, FormDocument } from "@/types/database";
import { FormsAdminView } from "@/components/forms/FormsAdminView";

interface FormsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function FormsPage({ params }: FormsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization || !orgCtx.userId) return null;

  const orgId = orgCtx.organization.id;
  const navConfig = orgCtx.organization.nav_config as NavConfig | null;
  const pageLabel = resolveLabel("/forms", navConfig);

  if (orgCtx.isAdmin) {
    // Admin view: fetch ALL forms (including inactive)
    const { data: forms, error: formsError } = await supabase
      .from("forms")
      .select("*")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (formsError)
      console.error("[forms] Failed to fetch forms:", formsError.message);

    // Fetch all submissions for counts and last-submitted
    const { data: allSubmissions, error: subsError } = await supabase
      .from("form_submissions")
      .select("form_id, submitted_at")
      .eq("organization_id", orgId);

    if (subsError)
      console.error("[forms] Failed to fetch submissions:", subsError.message);

    const countByForm = new Map<string, number>();
    const lastSubmittedByForm = new Map<string, string>();
    allSubmissions?.forEach((s) => {
      countByForm.set(s.form_id, (countByForm.get(s.form_id) || 0) + 1);
      const current = lastSubmittedByForm.get(s.form_id);
      if (s.submitted_at && (!current || s.submitted_at > current)) {
        lastSubmittedByForm.set(s.form_id, s.submitted_at);
      }
    });

    // Fetch document forms for the documents section
    const { data: documents, error: docsError } = await supabase
      .from("form_documents")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (docsError)
      console.error("[forms] Failed to fetch documents:", docsError.message);

    const typedForms = (forms || []) as Form[];
    const typedDocs = (documents || []) as FormDocument[];

    // Build submission data for each form
    const formSubmissionData = typedForms.map((form) => ({
      formId: form.id,
      count: countByForm.get(form.id) || 0,
      lastSubmittedAt: lastSubmittedByForm.get(form.id) || null,
    }));

    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title={pageLabel}
          description={`Manage organization ${pageLabel.toLowerCase()}`}
          actions={
            <div className="flex items-center gap-2">
              <Link href={`/${orgSlug}/forms/admin/documents`}>
                <Button variant="secondary">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  Document Forms
                </Button>
              </Link>
              <Link href={`/${orgSlug}/forms/admin/new`}>
                <Button>
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4.5v15m7.5-7.5h-15"
                    />
                  </svg>
                  Create Form
                </Button>
              </Link>
            </div>
          }
        />

        <FormsAdminView
          forms={typedForms}
          formSubmissionData={formSubmissionData}
          orgSlug={orgSlug}
          pageLabel={pageLabel}
        />

        {/* Document Forms Section */}
        {typedDocs.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                Document Forms
              </h2>
              <Link href={`/${orgSlug}/forms/documents`}>
                <Button variant="secondary" size="sm">
                  View All
                </Button>
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {typedDocs.slice(0, 3).map((doc) => (
                <Card key={doc.id} className="p-5">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <svg
                        className="h-5 w-5 text-red-500 flex-shrink-0"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4z" />
                      </svg>
                      <h3 className="font-semibold text-foreground">
                        {doc.title}
                      </h3>
                    </div>
                    {doc.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {doc.description}
                      </p>
                    )}
                    <div className="flex items-center justify-end pt-2">
                      <Link
                        href={`/${orgSlug}/forms/admin/documents/${doc.id}`}
                      >
                        <Button size="sm" variant="secondary">
                          Manage
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  // Member view: only active forms
  const { data: forms, error: formsError } = await supabase
    .from("forms")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (formsError)
    console.error("[forms] Failed to fetch forms:", formsError.message);

  const { data: documents, error: docsError } = await supabase
    .from("form_documents")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (docsError)
    console.error("[forms] Failed to fetch documents:", docsError.message);

  const { data: submissions, error: subsError } = await supabase
    .from("form_submissions")
    .select("form_id")
    .eq("organization_id", orgId)
    .eq("user_id", orgCtx.userId);

  if (subsError)
    console.error("[forms] Failed to fetch submissions:", subsError.message);

  const { data: docSubmissions, error: docSubsError } = await supabase
    .from("form_document_submissions")
    .select("document_id")
    .eq("organization_id", orgId)
    .eq("user_id", orgCtx.userId);

  if (docSubsError)
    console.error(
      "[forms] Failed to fetch doc submissions:",
      docSubsError.message,
    );

  const submittedFormIds = new Set(submissions?.map((s) => s.form_id) || []);
  const submittedDocIds = new Set(
    docSubmissions?.map((s) => s.document_id) || [],
  );
  const typedDocs = (documents || []) as FormDocument[];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={pageLabel}
        description={`View and fill out organization ${pageLabel.toLowerCase()}`}
      />

      {forms && forms.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(forms as Form[]).map((form) => {
            const isSubmitted = submittedFormIds.has(form.id);
            return (
              <Card key={form.id} className="p-5">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground">
                      {form.title}
                    </h3>
                    {isSubmitted && <Badge variant="success">Submitted</Badge>}
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
                      <Button
                        size="sm"
                        variant={isSubmitted ? "secondary" : "primary"}
                      >
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
            description={`${pageLabel} will appear here when available.`}
          />
        </Card>
      )}

      {/* Document Forms Section */}
      {typedDocs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              Document Forms
            </h2>
            <Link href={`/${orgSlug}/forms/documents`}>
              <Button variant="secondary" size="sm">
                View All
              </Button>
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
                        <svg
                          className="h-5 w-5 text-red-500 flex-shrink-0"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4z" />
                        </svg>
                        <h3 className="font-semibold text-foreground">
                          {doc.title}
                        </h3>
                      </div>
                      {isSubmitted && (
                        <Badge variant="success">Submitted</Badge>
                      )}
                    </div>
                    {doc.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {doc.description}
                      </p>
                    )}
                    <div className="flex items-center justify-end pt-2">
                      <Link href={`/${orgSlug}/forms/documents/${doc.id}`}>
                        <Button
                          size="sm"
                          variant={isSubmitted ? "secondary" : "primary"}
                        >
                          {isSubmitted
                            ? "View / Resubmit"
                            : "Download & Submit"}
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
