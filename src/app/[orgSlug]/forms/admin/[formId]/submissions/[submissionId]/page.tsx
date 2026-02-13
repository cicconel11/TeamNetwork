import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Button, Badge } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import type { Form, FormSubmission, FormField, User } from "@/types/database";

interface SubmissionDetailPageProps {
  params: Promise<{ orgSlug: string; formId: string; submissionId: string }>;
}

export default async function SubmissionDetailPage({ params }: SubmissionDetailPageProps) {
  const { orgSlug, formId, submissionId } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}/forms`);

  // Fetch form for field definitions
  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("*")
    .eq("id", formId)
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .single();

  if (formError || !form) return notFound();

  const typedForm = form as Form;
  const fields = (typedForm.fields || []) as unknown as FormField[];

  // Fetch submission with user info
  const { data: submission, error: subError } = await supabase
    .from("form_submissions")
    .select("*, users(name, email)")
    .eq("id", submissionId)
    .eq("form_id", formId)
    .single();

  if (subError || !submission) return notFound();

  const typedSubmission = submission as FormSubmission & { users: Pick<User, "name" | "email"> | null };
  const responses = ((typedSubmission.responses ?? {}) as Record<string, unknown>);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Submission Detail"
        description={typedForm.title}
        backHref={`/${orgSlug}/forms/admin/${formId}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/${orgSlug}/forms/admin/${formId}/edit`}>
              <Button variant="secondary" size="sm">Edit Form</Button>
            </Link>
          </div>
        }
      />

      {/* Submitter info */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-foreground">
              {typedSubmission.users?.name || "Unknown"}
            </p>
            <p className="text-sm text-muted-foreground">
              {typedSubmission.users?.email || "No email"}
            </p>
          </div>
          <div className="text-right">
            <Badge variant="muted">
              {typedSubmission.submitted_at
                ? new Date(typedSubmission.submitted_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Unknown date"}
            </Badge>
          </div>
        </div>
      </Card>

      {/* All field values */}
      <Card className="divide-y divide-border">
        {fields.length > 0 ? (
          fields.map((field) => (
            <div key={field.name} className="p-4">
              <dt className="text-sm font-medium text-muted-foreground mb-1">
                {field.label}
              </dt>
              <dd className="text-foreground whitespace-pre-wrap">
                {formatValue(responses[field.name])}
              </dd>
            </div>
          ))
        ) : (
          <div className="p-4">
            <p className="text-sm text-muted-foreground">No fields defined for this form.</p>
          </div>
        )}
      </Card>

      {/* Back link */}
      <div className="flex justify-between">
        <Link href={`/${orgSlug}/forms/admin/${formId}`}>
          <Button variant="secondary">Back to Submissions</Button>
        </Link>
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
