import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout";
import { Card, Button, Badge } from "@/components/ui";
import { getOrgContext } from "@/lib/auth/roles";
import { ExportCSVButton } from "@/components/forms/ExportCSVButton";
import { NonSubmitters } from "@/components/forms/NonSubmitters";
import type { Form, FormSubmission, FormField, User } from "@/types/database";

interface FormSubmissionsPageProps {
  params: Promise<{ orgSlug: string; formId: string }>;
}

export default async function FormSubmissionsPage({ params }: FormSubmissionsPageProps) {
  const { orgSlug, formId } = await params;
  const orgCtx = await getOrgContext(orgSlug);
  const supabase = await createClient();

  if (!orgCtx.organization) return null;
  if (!orgCtx.isAdmin) redirect(`/${orgSlug}/forms`);

  // Fetch form
  const { data: form, error: formError } = await supabase
    .from("forms")
    .select("*")
    .eq("id", formId)
    .eq("organization_id", orgCtx.organization.id)
    .is("deleted_at", null)
    .single();

  if (formError) console.error("[forms-admin] Failed to fetch form:", formError.message);
  if (!form) return notFound();

  const typedForm = form as Form;

  // Fetch submissions with user info
  const { data: submissions, error: submissionsError } = await supabase
    .from("form_submissions")
    .select("*, users(name, email)")
    .eq("form_id", formId)
    .order("submitted_at", { ascending: false });

  if (submissionsError) {
    console.error("[forms-admin] Failed to fetch submissions:", submissionsError.message);
  }

  const typedSubmissions = (submissions || []) as (FormSubmission & { users: Pick<User, "name" | "email"> | null })[];
  const fields = (typedForm.fields || []) as unknown as FormField[];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={typedForm.title}
        description={`${typedSubmissions.length} submission${typedSubmissions.length !== 1 ? "s" : ""}`}
        backHref={`/${orgSlug}/forms`}
        actions={
          <div className="flex items-center gap-2">
            <ExportCSVButton form={typedForm} submissions={typedSubmissions} />
            <Link href={`/${orgSlug}/forms/admin/${formId}/edit`}>
              <Button variant="secondary">Edit Form</Button>
            </Link>
          </div>
        }
      />

      <Card className="p-4">
        <div className="flex items-center gap-4 text-sm">
          <Badge variant={typedForm.is_active ? "success" : "muted"}>
            {typedForm.is_active ? "Active" : "Inactive"}
          </Badge>
          <span className="text-muted-foreground">{fields.length} fields</span>
          {typedForm.description && (
            <span className="text-muted-foreground truncate">{typedForm.description}</span>
          )}
        </div>
      </Card>

      {typedSubmissions.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left p-3 font-medium text-muted-foreground">Submitted By</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                  {fields.map((field) => (
                    <th key={field.name} className="text-left p-3 font-medium text-muted-foreground">
                      {field.label}
                    </th>
                  ))}
                  <th className="text-left p-3 font-medium text-muted-foreground w-16"></th>
                </tr>
              </thead>
              <tbody>
                {typedSubmissions.map((submission) => {
                  const responses = (submission.data || {}) as Record<string, unknown>;
                  return (
                    <tr key={submission.id} className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer">
                      <td className="p-3 text-foreground">
                        {submission.users?.name || submission.users?.email || "Unknown"}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {submission.submitted_at
                          ? new Date(submission.submitted_at).toLocaleDateString()
                          : "-"}
                      </td>
                      {fields.map((field) => (
                        <td key={field.name} className="p-3 text-foreground max-w-[200px] truncate">
                          {formatValue(responses[field.name])}
                        </td>
                      ))}
                      <td className="p-3">
                        <Link href={`/${orgSlug}/forms/admin/${formId}/submissions/${submission.id}`} className="text-sm text-blue-500 hover:text-blue-600">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No submissions yet.</p>
        </Card>
      )}

      <NonSubmitters
        orgId={orgCtx.organization.id}
        submitterUserIds={typedSubmissions.map((s) => s.user_id)}
      />
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
