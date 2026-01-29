"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { editAlumniSchema, type EditAlumniForm } from "@/lib/schemas/member";
import type { Alumni } from "@/types/database";

export default function EditAlumniPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const alumniId = params.alumniId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditAlumniForm>({
    resolver: zodResolver(editAlumniSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      graduation_year: "",
      major: "",
      job_title: "",
      photo_url: "",
      notes: "",
      linkedin_url: "",
      phone_number: "",
      industry: "",
      current_company: "",
      current_city: "",
      position_title: "",
    },
  });

  useEffect(() => {
    const fetchAlumni = async () => {
      const supabase = createClient();

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (!org) {
        setError("Organization not found");
        setIsFetching(false);
        return;
      }

      const { data: alumni } = await supabase
        .from("alumni")
        .select("*")
        .eq("id", alumniId)
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .single();

      if (!alumni) {
        setError("Alumni not found");
        setIsFetching(false);
        return;
      }

      const alum = alumni as Alumni;
      reset({
        first_name: alum.first_name || "",
        last_name: alum.last_name || "",
        email: alum.email || "",
        graduation_year: alum.graduation_year?.toString() || "",
        major: alum.major || "",
        job_title: alum.job_title || "",
        photo_url: alum.photo_url || "",
        notes: alum.notes || "",
        linkedin_url: alum.linkedin_url || "",
        phone_number: alum.phone_number || "",
        industry: alum.industry || "",
        current_company: alum.current_company || "",
        current_city: alum.current_city || "",
        position_title: alum.position_title || "",
      });
      setIsFetching(false);
    };

    fetchAlumni();
  }, [orgSlug, alumniId, reset]);

  const onSubmit = async (data: EditAlumniForm) => {
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

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

    const { error: updateError } = await supabase
      .from("alumni")
      .update({
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email || null,
        graduation_year: data.graduation_year ? parseInt(data.graduation_year) : null,
        major: data.major || null,
        job_title: data.job_title || null,
        photo_url: data.photo_url || null,
        notes: data.notes || null,
        linkedin_url: data.linkedin_url || null,
        phone_number: data.phone_number || null,
        industry: data.industry || null,
        current_company: data.current_company || null,
        current_city: data.current_city || null,
        position_title: data.position_title || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", alumniId)
      .eq("organization_id", org.id);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/alumni/${alumniId}`);
    router.refresh();
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Edit Alumni"
          description="Loading..."
          backHref={`/${orgSlug}/alumni/${alumniId}`}
        />
        <Card className="max-w-2xl p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-xl" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Alumni"
        description="Update alumni information"
        backHref={`/${orgSlug}/alumni/${alumniId}`}
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
            placeholder="alumni@example.com"
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
              error={errors.graduation_year?.message}
              {...register("graduation_year")}
            />
            <Input
              label="Major"
              placeholder="e.g., Finance, Computer Science"
              error={errors.major?.message}
              {...register("major")}
            />
          </div>

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
            label="LinkedIn profile (optional)"
            type="url"
            placeholder="https://www.linkedin.com/in/username"
            helperText="Must be a valid https:// URL"
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

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
