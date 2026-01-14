"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, EmptyState, Button } from "@/components/ui";
import { FormAdminCard } from "@/components/forms/FormAdminCard";
import Link from "next/link";
import type { Form } from "@/types/database";

interface FormSubmissionData {
  formId: string;
  count: number;
  lastSubmittedAt: string | null;
}

interface FormsAdminViewProps {
  forms: Form[];
  formSubmissionData: FormSubmissionData[];
  orgSlug: string;
  pageLabel: string;
}

export function FormsAdminView({
  forms,
  formSubmissionData,
  orgSlug,
  pageLabel,
}: FormsAdminViewProps) {
  const router = useRouter();

  const handleToggleActive = async (formId: string, isActive: boolean) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("forms")
      .update({ is_active: isActive })
      .eq("id", formId);

    if (error) {
      console.error("[forms-admin] Failed to toggle form:", error.message);
      return;
    }
    router.refresh();
  };

  const handleDelete = async (formId: string) => {
    const supabase = createClient();
    const { error } = await supabase
      .from("forms")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", formId);

    if (error) {
      console.error("[forms-admin] Failed to delete form:", error.message);
      return;
    }
    router.refresh();
  };

  if (forms.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No forms yet"
          description={`Create your first ${pageLabel.toLowerCase().slice(0, -1)} for members to fill out.`}
          action={
            <Link href={`/${orgSlug}/forms/admin/new`}>
              <Button>Create First Form</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {forms.map((form) => {
        const subData = formSubmissionData.find((d) => d.formId === form.id);
        return (
          <FormAdminCard
            key={form.id}
            form={form}
            orgSlug={orgSlug}
            submissionCount={subData?.count || 0}
            lastSubmittedAt={subData?.lastSubmittedAt || null}
            onToggleActive={handleToggleActive}
            onDelete={handleDelete}
          />
        );
      })}
    </div>
  );
}
