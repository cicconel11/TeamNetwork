"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { editAlumniSchema, type EditAlumniForm } from "@/lib/schemas/member";
import type { Alumni } from "@/types/database";

const READ_ONLY_ERROR =
  "This organization is in its billing grace period. Existing alumni cannot be edited until billing is restored.";

interface EditAlumniFormProps {
  alumni: Alumni;
  orgSlug: string;
  isReadOnly: boolean;
}

export function EditAlumniForm({ alumni, orgSlug, isReadOnly }: EditAlumniFormProps) {
  const router = useRouter();
  const alumniId = alumni.id;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EditAlumniForm>({
    resolver: zodResolver(editAlumniSchema),
    defaultValues: {
      first_name: alumni.first_name || "",
      last_name: alumni.last_name || "",
      email: alumni.email || "",
      graduation_year: alumni.graduation_year?.toString() || "",
      birth_year: alumni.birth_year?.toString() || "",
      major: alumni.major || "",
      job_title: alumni.job_title || "",
      photo_url: alumni.photo_url || "",
      notes: alumni.notes || "",
      linkedin_url: alumni.linkedin_url || "",
      phone_number: alumni.phone_number || "",
      industry: alumni.industry || "",
      current_company: alumni.current_company || "",
      current_city: alumni.current_city || "",
      position_title: alumni.position_title || "",
    },
  });

  const onSubmit = async (data: EditAlumniForm) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/organizations/${alumni.organization_id}/alumni/${alumniId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          payload.code === "ORG_READ_ONLY"
            ? READ_ONLY_ERROR
            : payload.error || "Unable to update alumni",
        );
        return;
      }
    } catch {
      setError("Unable to update alumni");
      return;
    } finally {
      setIsLoading(false);
    }

    router.push(`/${orgSlug}/alumni/${alumniId}`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Alumni"
        description={isReadOnly ? "Viewing alumni information during grace period" : "Update alumni information"}
        backHref={`/${orgSlug}/alumni/${alumniId}`}
      />

      {isReadOnly && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
          Alumni editing is disabled while this organization is in its billing grace period. You can still add new alumni, but existing records cannot be changed until billing is restored.
        </div>
      )}

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <fieldset disabled={isReadOnly || isLoading} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="First Name"
                data-testid="alumni-first-name"
                error={errors.first_name?.message}
                {...register("first_name")}
              />
              <Input
                label="Last Name"
                data-testid="alumni-last-name"
                error={errors.last_name?.message}
                {...register("last_name")}
              />
            </div>

            <Input
              label="Email"
              type="email"
              placeholder="alumni@example.com"
              data-testid="alumni-email"
              error={errors.email?.message}
              {...register("email")}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Graduation Year"
                type="number"
                placeholder="2020"
                min={1900}
                max={2100}
                data-testid="alumni-graduation-year"
                error={errors.graduation_year?.message}
                {...register("graduation_year")}
              />
              <Input
                label="Year of Birth"
                type="number"
                placeholder="1998"
                min={1900}
                max={new Date().getFullYear()}
                data-testid="alumni-birth-year"
                error={errors.birth_year?.message}
                {...register("birth_year")}
              />
            </div>

            <Input
              label="Major"
              placeholder="e.g., Finance, Computer Science"
              error={errors.major?.message}
              {...register("major")}
            />

            <Input
              label="Current Position (Legacy)"
              placeholder="e.g., Software Engineer at Google"
              helperText="Optional - use Position Title and Company below for better filtering"
              error={errors.job_title?.message}
              {...register("job_title")}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Position Title"
                placeholder="e.g., Software Engineer"
                error={errors.position_title?.message}
                {...register("position_title")}
              />
              <Input
                label="Current Company"
                placeholder="e.g., Google"
                error={errors.current_company?.message}
                {...register("current_company")}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Industry"
                placeholder="e.g., Technology, Finance, Healthcare"
                error={errors.industry?.message}
                {...register("industry")}
              />
              <Input
                label="Current City"
                placeholder="e.g., San Francisco, CA"
                error={errors.current_city?.message}
                {...register("current_city")}
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
              helperText="Direct link to alumni photo"
              error={errors.photo_url?.message}
              {...register("photo_url")}
            />

            <Input
              label="LinkedIn profile URL (optional)"
              type="url"
              placeholder="https://www.linkedin.com/in/username"
              helperText="Use a public LinkedIn profile URL under linkedin.com/in/..."
              error={errors.linkedin_url?.message}
              {...register("linkedin_url")}
            />

            <Textarea
              label="Notes"
              placeholder="Any additional notes about this alumni..."
              rows={3}
              error={errors.notes?.message}
              {...register("notes")}
            />
          </fieldset>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="alumni-edit-submit"
              isLoading={isLoading}
              disabled={isReadOnly}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
