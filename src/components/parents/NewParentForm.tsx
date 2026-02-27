"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { newParentSchema, type NewParentForm as NewParentFormData, PARENT_RELATIONSHIPS } from "@/lib/schemas/member";

interface NewParentFormProps {
  orgId: string;
  orgSlug: string;
}

export function NewParentForm({ orgId, orgSlug }: NewParentFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewParentFormData>({
    resolver: zodResolver(newParentSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone_number: "",
      photo_url: "",
      linkedin_url: "",
      student_name: "",
      relationship: "",
      notes: "",
    },
  });

  const onSubmit = async (data: NewParentFormData) => {
    setIsLoading(true);
    setError(null);

    const res = await fetch(`/api/organizations/${orgId}/parents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email || null,
        phone_number: data.phone_number || null,
        photo_url: data.photo_url || null,
        linkedin_url: data.linkedin_url || null,
        student_name: data.student_name || null,
        relationship: data.relationship || null,
        notes: data.notes || null,
      }),
    });

    const json = await res.json() as { error?: string };
    if (!res.ok) {
      setError(json.error || "Failed to add parent");
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/parents`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Add New Parent"
        description="Add a parent or guardian to your organization&apos;s directory"
        backHref={`/${orgSlug}/parents`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="First Name"
              error={errors.first_name?.message}
              {...register("first_name")}
            />
            <Input
              label="Last Name"
              error={errors.last_name?.message}
              {...register("last_name")}
            />
          </div>

          <Input
            label="Email"
            type="email"
            placeholder="parent@example.com"
            error={errors.email?.message}
            {...register("email")}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Student Name"
              placeholder="e.g., Alex Smith"
              helperText="Name of the student they are a parent/guardian of"
              error={errors.student_name?.message}
              {...register("student_name")}
            />
            <Select
              label="Relationship"
              error={errors.relationship?.message}
              options={[
                { value: "", label: "Select relationship" },
                ...PARENT_RELATIONSHIPS.map((r) => ({ value: r, label: r })),
              ]}
              {...register("relationship")}
            />
          </div>

          <Input
            label="Phone Number"
            type="tel"
            placeholder="e.g., +1 (555) 123-4567"
            error={errors.phone_number?.message}
            {...register("phone_number")}
          />

          <Input
            label="Photo URL"
            type="url"
            placeholder="https://example.com/photo.jpg"
            helperText="Direct link to photo"
            error={errors.photo_url?.message}
            {...register("photo_url")}
          />

          <Input
            label="LinkedIn Profile (optional)"
            type="url"
            placeholder="https://www.linkedin.com/in/username"
            helperText="Must be a valid https:// URL"
            error={errors.linkedin_url?.message}
            {...register("linkedin_url")}
          />

          <Textarea
            label="Notes"
            placeholder="Any additional notes..."
            rows={3}
            error={errors.notes?.message}
            {...register("notes")}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Add Parent
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
