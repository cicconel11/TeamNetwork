import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Button, Badge, EmptyState } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import type { FormDocument } from "@/types/database";

interface DocumentFormsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function DocumentFormsPage({ params }: DocumentFormsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization || !orgCtx.userId) return null;

  const orgId = orgCtx.organization.id;

  // Fetch active documents
  const { data: documents } = await supabase
    .from("form_documents")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Fetch user's submissions
  const { data: submissions } = await supabase
    .from("form_document_submissions")
    .select("document_id")
    .eq("organization_id", orgId)
    .eq("user_id", orgCtx.userId);

  const submittedDocIds = new Set(submissions?.map((s) => s.document_id) || []);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Document Forms"
        description="Download forms, fill them out, and upload your completed version"
        backHref={`/${orgSlug}/forms`}
      />

      {documents && documents.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(documents as FormDocument[]).map((doc) => {
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
      ) : (
        <Card>
          <EmptyState
            title="No document forms available"
            description="Document forms will appear here when available."
          />
        </Card>
      )}
    </div>
  );
}
