"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { newAlumniSchema, type NewAlumniForm } from "@/lib/schemas/member";

interface SubscriptionInfo {
  bucket: string;
  alumniLimit: number | null;
  alumniCount: number;
  remaining: number | null;
  status?: string;
}

export default function NewAlumniPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const orgSlug = params.orgSlug as string;
  const prefilledLinkedinUrl = searchParams.get("linkedin_url") ?? "";

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [quota, setQuota] = useState<SubscriptionInfo | null>(null);
  const [isLoadingQuota, setIsLoadingQuota] = useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewAlumniForm>({
    resolver: zodResolver(newAlumniSchema),
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      graduation_year: "",
      birth_year: "",
      major: "",
      job_title: "",
      photo_url: "",
      notes: "",
      linkedin_url: prefilledLinkedinUrl,
      phone_number: "",
      industry: "",
      current_company: "",
      current_city: "",
      position_title: "",
    },
  });

  const fetchQuota = useCallback(async (organizationId: string) => {
    setIsLoadingQuota(true);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/subscription`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        setQuota(data as SubscriptionInfo);
      } else {
        setError(data.error || "Unable to load subscription details");
      }
    } catch {
      setError("Unable to load subscription details");
    } finally {
      setIsLoadingQuota(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const loadOrg = async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .single();

      if (org?.id) {
        setOrgId(org.id);
        await fetchQuota(org.id);
      } else {
        setError("Organization not found");
      }
    };

    void loadOrg();
  }, [orgSlug, fetchQuota]);

  const onSubmit = async (data: NewAlumniForm) => {
    if (
      quota &&
      quota.alumniLimit !== null &&
      quota.remaining !== null &&
      quota.remaining <= 0
    ) {
      setError("Alumni quota reached. Upgrade your plan from Settings → Invites to add more alumni.");
      return;
    }

    if (!orgId) {
      setError("Organization not found");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const organizationId = orgId;
      const response = await fetch(`/api/organizations/${organizationId}/alumni`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error || "Unable to create alumni");
        setIsLoading(false);
        return;
      }
    } catch {
      setError("Unable to create alumni");
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/alumni`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Add New Alumni"
        description="Add an alumni to your organization&apos;s network"
        backHref={`/${orgSlug}/alumni`}
      />

      {quota && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Plan: {quota.bucket} ·{" "}
            {quota.alumniLimit === null
              ? `${quota.alumniCount} alumni (unlimited plan)`
              : `${quota.alumniCount}/${quota.alumniLimit} alumni used`}
          </p>
          <Link href={`/${orgSlug}/settings/invites`} className="text-sm text-emerald-600 hover:text-emerald-700">
            Manage subscription
          </Link>
        </div>
      )}

      {quota?.status === "canceled" && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
          This organization is in its billing grace period. You can still add alumni here, but editing and deleting existing alumni stay locked until billing is restored.
        </div>
      )}

      {quota && quota.alumniLimit !== null && quota.alumniCount >= quota.alumniLimit && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
          Alumni limit reached. Upgrade your plan from Settings → Invites to add more alumni.
        </div>
      )}

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

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="alumni-submit"
              isLoading={isLoading}
              disabled={
                isLoadingQuota ||
                Boolean(quota && quota.alumniLimit !== null && quota.alumniCount >= quota.alumniLimit)
              }
            >
              Add Alumni
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
