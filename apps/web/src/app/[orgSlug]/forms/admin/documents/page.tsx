import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Button, Badge, EmptyState } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import type { FormDocument } from "@/types/database";

interface AdminDocumentsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function AdminDocumentsPage({ params }: AdminDocumentsPageProps) {
  const { orgSlug } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}/forms`);

  const orgId = orgCtx.organization.id;

  // Fetch all documents
  const { data: documents } = await supabase
    .from("form_documents")
    .select("*")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Get submission counts per document
  const { data: submissionCounts } = await supabase
    .from("form_document_submissions")
    .select("document_id")
    .eq("organization_id", orgId);

  const countByDoc = new Map<string, number>();
  submissionCounts?.forEach((s) => {
    countByDoc.set(s.document_id, (countByDoc.get(s.document_id) || 0) + 1);
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Document Forms"
        description="Upload PDF forms for members to download and submit"
        backHref={`/${orgSlug}/forms/admin`}
        actions={
          <Link href={`/${orgSlug}/forms/admin/documents/upload`}>
            <Button>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Upload Document
            </Button>
          </Link>
        }
      />

      {documents && documents.length > 0 ? (
        <div className="space-y-4">
          {(documents as FormDocument[]).map((doc) => {
            const submissionCount = countByDoc.get(doc.id) || 0;
            return (
              <Card key={doc.id} className="p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <svg className="h-5 w-5 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zm-1 8v6h-2v-4H8l4-4 4 4h-2v-2h-2z"/>
                      </svg>
                      <h3 className="font-semibold text-foreground truncate">{doc.title}</h3>
                      <Badge variant={doc.is_active ? "success" : "muted"}>
                        {doc.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {doc.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1 ml-7">
                        {doc.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground ml-7">
                      <span>{doc.file_name}</span>
                      <span>{submissionCount} submission{submissionCount !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/${orgSlug}/forms/admin/documents/${doc.id}`}>
                      <Button variant="secondary" size="sm">View Submissions</Button>
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
            title="No document forms yet"
            description="Upload PDF forms for members to download, fill out, and re-upload."
            action={
              <Link href={`/${orgSlug}/forms/admin/documents/upload`}>
                <Button>Upload First Document</Button>
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}
