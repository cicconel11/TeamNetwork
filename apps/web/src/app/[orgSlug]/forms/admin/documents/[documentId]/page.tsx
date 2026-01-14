import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Badge } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { DocumentSubmissionsList } from "@/components/forms/DocumentSubmissionsList";
import { DocumentActions } from "@/components/forms/DocumentActions";
import type { FormDocument, FormDocumentSubmission, User } from "@/types/database";

interface DocumentSubmissionsPageProps {
  params: Promise<{ orgSlug: string; documentId: string }>;
}

export default async function DocumentSubmissionsPage({ params }: DocumentSubmissionsPageProps) {
  const { orgSlug, documentId } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}/forms`);

  // Fetch document
  const { data: doc } = await supabase
    .from("form_documents")
    .select("*")
    .eq("id", documentId)
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .single();

  if (!doc) return notFound();

  const typedDoc = doc as FormDocument;

  // Fetch submissions with user info
  const { data: submissions } = await supabase
    .from("form_document_submissions")
    .select("*, users(name, email)")
    .eq("document_id", documentId)
    .order("submitted_at", { ascending: false });

  const typedSubmissions = (submissions || []) as (FormDocumentSubmission & { users: Pick<User, "name" | "email"> | null })[];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={typedDoc.title}
        description={`${typedSubmissions.length} submission${typedSubmissions.length !== 1 ? "s" : ""}`}
        backHref={`/${orgSlug}/forms/admin/documents`}
        actions={<DocumentActions document={typedDoc} orgSlug={orgSlug} />}
      />

      <Card className="p-4">
        <div className="flex items-center gap-4 text-sm">
          <Badge variant={typedDoc.is_active ? "success" : "muted"}>
            {typedDoc.is_active ? "Active" : "Inactive"}
          </Badge>
          <span className="text-muted-foreground">{typedDoc.file_name}</span>
          {typedDoc.description && (
            <span className="text-muted-foreground truncate">{typedDoc.description}</span>
          )}
        </div>
      </Card>

      <DocumentSubmissionsList submissions={typedSubmissions} />
    </div>
  );
}
