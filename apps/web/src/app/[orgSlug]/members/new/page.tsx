"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { newMemberSchema, type NewMemberForm } from "@/lib/schemas/member";

export default function NewMemberPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewMemberForm>({
    resolver: zodResolver(newMemberSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      role: "",
      status: "active",
      graduation_year: undefined,
      photo_url: "",
      linkedin_url: "",
    },
  });

  const onSubmit = async (data: NewMemberForm) => {
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    // Get organization ID
    const { data: org } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .single();

    if (!org) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from("members").insert({
      organization_id: org.id,
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email || null,
      role: data.role || null,
      status: data.status,
      graduation_year: data.graduation_year || null,
      photo_url: data.photo_url || null,
      linkedin_url: data.linkedin_url || null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/members`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Add New Member"
        description="Add a new member to your organization"
        backHref={`/${orgSlug}/members`}
      />

      <Card className="max-w-2xl">
        <form data-testid="member-form" onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div data-testid="member-error" className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="First Name"
              error={errors.first_name?.message}
              data-testid="member-first-name"
              {...register("first_name")}
            />
            <Input
              label="Last Name"
              error={errors.last_name?.message}
              data-testid="member-last-name"
              {...register("last_name")}
            />
          </div>

          <Input
            label="Email"
            type="email"
            placeholder="member@example.com"
            error={errors.email?.message}
            data-testid="member-email"
            {...register("email")}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Role/Position"
              placeholder="e.g., Quarterback, Member, Staff"
              error={errors.role?.message}
              data-testid="member-role"
              {...register("role")}
            />
            <Select
              label="Status"
              error={errors.status?.message}
              data-testid="member-status"
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
              {...register("status")}
            />
          </div>

          <Input
            label="Graduation Year"
            type="number"
            placeholder="2025"
            min={1900}
            max={2100}
            error={errors.graduation_year?.message}
            {...register("graduation_year")}
          />

          <Input
            label="Photo URL"
            type="url"
            placeholder="https://example.com/photo.jpg"
            helperText="Direct link to member photo"
            error={errors.photo_url?.message}
            {...register("photo_url")}
          />

          <Input
            label="LinkedIn profile (optional)"
            type="url"
            placeholder="https://www.linkedin.com/in/username"
            helperText="Must be a valid https:// URL"
            error={errors.linkedin_url?.message}
            {...register("linkedin_url")}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()} data-testid="member-cancel">
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading} data-testid="member-submit">
              Add Member
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

