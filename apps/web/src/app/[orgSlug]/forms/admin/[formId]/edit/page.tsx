"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { Form, FormField, FormFieldType } from "@/types/database";

const FIELD_TYPES: { label: string; value: FormFieldType }[] = [
  { label: "Short Text", value: "text" },
  { label: "Long Text", value: "textarea" },
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" },
  { label: "Date", value: "date" },
  { label: "Dropdown", value: "select" },
  { label: "Checkboxes", value: "checkbox" },
  { label: "Radio Buttons", value: "radio" },
];

function generateFieldName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 30) || `field_${Date.now()}`;
}

export default function EditFormPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const formId = params.formId as string;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("forms")
        .select("*")
        .eq("id", formId)
        .is("deleted_at", null)
        .single();

      if (!data) {
        router.push(`/${orgSlug}/forms/admin`);
        return;
      }

      const form = data as Form;
      setTitle(form.title);
      setDescription(form.description || "");
      setFields((form.fields || []) as FormField[]);
      setIsActive(form.is_active);
      setIsFetching(false);
    };

    load();
  }, [formId, orgSlug, router]);

  const addField = () => {
    setFields([
      ...fields,
      { name: "", type: "text", label: "", required: false, options: [] },
    ]);
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    if (updates.label && !newFields[index].name) {
      newFields[index].name = generateFieldName(updates.label);
    }
    setFields(newFields);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const moveField = (index: number, direction: "up" | "down") => {
    if (
      (direction === "up" && index === 0) ||
      (direction === "down" && index === fields.length - 1)
    ) {
      return;
    }
    const newFields = [...fields];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    [newFields[index], newFields[newIndex]] = [newFields[newIndex], newFields[index]];
    setFields(newFields);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (fields.length === 0) {
      setError("Add at least one field to the form");
      setIsLoading(false);
      return;
    }

    for (const field of fields) {
      if (!field.label.trim()) {
        setError("All fields must have a label");
        setIsLoading(false);
        return;
      }
      if (["select", "radio", "checkbox"].includes(field.type) && (!field.options || field.options.length === 0)) {
        setError(`Field "${field.label}" requires options`);
        setIsLoading(false);
        return;
      }
    }

    const processedFields = fields.map((f, i) => ({
      ...f,
      name: f.name || generateFieldName(f.label) || `field_${i}`,
    }));

    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("forms")
      .update({
        title,
        description: description || null,
        fields: processedFields,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", formId);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/forms/admin`);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!confirm("Delete this form? This will also delete all submissions.")) return;

    setIsDeleting(true);
    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("forms")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", formId);

    if (deleteError) {
      setError(deleteError.message);
      setIsDeleting(false);
      return;
    }

    router.push(`/${orgSlug}/forms/admin`);
    router.refresh();
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Edit Form" backHref={`/${orgSlug}/forms/admin`} />
        <Card className="p-6">
          <p className="text-muted-foreground">Loading...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Form"
        backHref={`/${orgSlug}/forms/admin`}
      />

      <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <Card className="p-6 space-y-4">
          <Input
            label="Form Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_active"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <label htmlFor="is_active" className="text-sm text-foreground">
              Form is active (visible to members)
            </label>
          </div>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Form Fields</h2>
            <Button type="button" variant="secondary" onClick={addField}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Field
            </Button>
          </div>

          {fields.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-muted-foreground">No fields yet.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {fields.map((field, index) => (
                <Card key={index} className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moveField(index, "up")}
                          disabled={index === 0}
                          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(index, "down")}
                          disabled={index === fields.length - 1}
                          className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          label="Label"
                          value={field.label}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                        />
                        <Select
                          label="Type"
                          value={field.type}
                          onChange={(e) => updateField(index, { type: e.target.value as FormFieldType })}
                          options={FIELD_TYPES}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeField(index)}
                        className="p-2 text-red-500 hover:text-red-600"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {["select", "radio", "checkbox"].includes(field.type) && (
                      <Input
                        label="Options (comma-separated)"
                        value={field.options?.join(", ") || ""}
                        onChange={(e) =>
                          updateField(index, {
                            options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean),
                          })
                        }
                      />
                    )}

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                        className="h-4 w-4 rounded border-border"
                      />
                      <span className="text-foreground">Required field</span>
                    </label>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-between gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={handleDelete}
            isLoading={isDeleting}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            Delete Form
          </Button>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Save Changes
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
