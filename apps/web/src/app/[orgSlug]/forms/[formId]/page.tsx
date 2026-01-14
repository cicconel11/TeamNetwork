"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { Form, FormField, FormSubmission } from "@/types/database";

export default function FillFormPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const formId = params.formId as string;

  const [form, setForm] = useState<Form | null>(null);
  const [existingSubmission, setExistingSubmission] = useState<FormSubmission | null>(null);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      // Fetch form
      const { data: formData } = await supabase
        .from("forms")
        .select("*")
        .eq("id", formId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .single();

      if (!formData) {
        router.push(`/${orgSlug}/forms`);
        return;
      }

      setForm(formData as Form);

      // Check for existing submission
      if (user) {
        const { data: submission } = await supabase
          .from("form_submissions")
          .select("*")
          .eq("form_id", formId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (submission) {
          setExistingSubmission(submission as FormSubmission);
          setResponses((submission.responses as Record<string, unknown>) || {});
        }
      }

      setIsFetching(false);
    };

    load();
  }, [formId, orgSlug, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;

    setIsLoading(true);
    setError(null);

    const fields = (form.fields || []) as FormField[];

    // Validate required fields
    for (const field of fields) {
      if (field.required) {
        const value = responses[field.name];
        if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
          setError(`"${field.label}" is required`);
          setIsLoading(false);
          return;
        }
      }
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be logged in");
      setIsLoading(false);
      return;
    }

    if (existingSubmission) {
      // Update existing
      const { error: updateError } = await supabase
        .from("form_submissions")
        .update({ responses, submitted_at: new Date().toISOString() })
        .eq("id", existingSubmission.id);

      if (updateError) {
        setError(updateError.message);
        setIsLoading(false);
        return;
      }
    } else {
      // Create new
      const { error: insertError } = await supabase.from("form_submissions").insert({
        form_id: formId,
        organization_id: form.organization_id,
        user_id: user.id,
        responses,
      });

      if (insertError) {
        setError(insertError.message);
        setIsLoading(false);
        return;
      }
    }

    setSuccess(true);
    setIsLoading(false);
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Loading..." backHref={`/${orgSlug}/forms`} />
        <Card className="p-6">
          <p className="text-muted-foreground">Loading form...</p>
        </Card>
      </div>
    );
  }

  if (!form) return null;

  const fields = (form.fields || []) as FormField[];

  if (success) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={form.title} backHref={`/${orgSlug}/forms`} />
        <Card className="p-8 text-center max-w-xl mx-auto">
          <div className="text-green-500 mb-4">
            <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {existingSubmission ? "Response Updated!" : "Form Submitted!"}
          </h2>
          <p className="text-muted-foreground mb-6">Your response has been recorded.</p>
          <Button onClick={() => router.push(`/${orgSlug}/forms`)}>Back to Forms</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={form.title}
        description={form.description || undefined}
        backHref={`/${orgSlug}/forms`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {existingSubmission && (
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm">
              You have already submitted this form. You can update your response below.
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {fields.map((field) => (
            <FieldInput
              key={field.name}
              field={field}
              value={responses[field.name]}
              onChange={(value) => setResponses({ ...responses, [field.name]: value })}
            />
          ))}

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              {existingSubmission ? "Update Response" : "Submit"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

interface FieldInputProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}

function FieldInput({ field, value, onChange }: FieldInputProps) {
  const label = field.required ? `${field.label} *` : field.label;

  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          label={label}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
        />
      );

    case "select":
      return (
        <Select
          label={label}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { label: "Select...", value: "" },
            ...(field.options || []).map((opt) => ({ label: opt, value: opt })),
          ]}
        />
      );

    case "radio":
      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">{label}</label>
          <div className="space-y-2">
            {(field.options || []).map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={field.name}
                  checked={value === opt}
                  onChange={() => onChange(opt)}
                  className="h-4 w-4"
                />
                <span className="text-foreground">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      );

    case "checkbox":
      const checkedValues = (value as string[]) || [];
      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">{label}</label>
          <div className="space-y-2">
            {(field.options || []).map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checkedValues.includes(opt)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onChange([...checkedValues, opt]);
                    } else {
                      onChange(checkedValues.filter((v) => v !== opt));
                    }
                  }}
                  className="h-4 w-4 rounded"
                />
                <span className="text-foreground">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      );

    case "date":
      return (
        <Input
          label={label}
          type="date"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "email":
      return (
        <Input
          label={label}
          type="email"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "phone":
      return (
        <Input
          label={label}
          type="tel"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default:
      return (
        <Input
          label={label}
          type="text"
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
