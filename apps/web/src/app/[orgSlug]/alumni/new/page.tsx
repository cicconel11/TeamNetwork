"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

interface SubscriptionInfo {
  bucket: string;
  alumniLimit: number | null;
  alumniCount: number;
  remaining: number | null;
}

export default function NewAlumniPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [quota, setQuota] = useState<SubscriptionInfo | null>(null);
  const [isLoadingQuota, setIsLoadingQuota] = useState(true);
  
  const [formData, setFormData] = useState({
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      quota &&
      quota.alumniLimit !== null &&
      quota.remaining !== null &&
      quota.remaining <= 0
    ) {
      setError("Alumni quota reached. Upgrade your plan from Settings → Invites to add more alumni.");
      return;
    }

    setIsLoading(true);
    setError(null);

    const linkedin = formData.linkedin_url?.trim();
    if (linkedin) {
      try {
        const url = new URL(linkedin);
        if (url.protocol !== "https:") {
          throw new Error("LinkedIn URL must start with https://");
        }
      } catch {
        setError("Please enter a valid LinkedIn profile URL (https://...)");
        setIsLoading(false);
        return;
      }
    }

    const supabase = createClient();
    let organizationId = orgId;

    if (!organizationId) {
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
      organizationId = org.id;
      setOrgId(org.id);
    }

    const { error: insertError } = await supabase.from("alumni").insert({
      organization_id: organizationId,
      first_name: formData.first_name,
      last_name: formData.last_name,
      email: formData.email || null,
      graduation_year: formData.graduation_year ? parseInt(formData.graduation_year) : null,
      major: formData.major || null,
      job_title: formData.job_title || null,
      photo_url: formData.photo_url || null,
      notes: formData.notes || null,
      linkedin_url: linkedin || null,
      phone_number: formData.phone_number || null,
      industry: formData.industry || null,
      current_company: formData.current_company || null,
      current_city: formData.current_city || null,
      position_title: formData.position_title || null,
    });

    if (insertError) {
      setError(insertError.message);
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

      {quota && quota.alumniLimit !== null && quota.alumniCount >= quota.alumniLimit && (
        <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
          Alumni limit reached. Upgrade your plan from Settings → Invites to add more alumni.
        </div>
      )}

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              required
            />
            <Input
              label="Last Name"
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              required
            />
          </div>

          <Input
            label="Email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="alumni@example.com"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Graduation Year"
              type="number"
              value={formData.graduation_year}
              onChange={(e) => setFormData({ ...formData, graduation_year: e.target.value })}
              placeholder="2020"
              min={1900}
              max={2100}
            />
            <Input
              label="Major"
              value={formData.major}
              onChange={(e) => setFormData({ ...formData, major: e.target.value })}
              placeholder="e.g., Finance, Computer Science"
            />
          </div>

          <Input
            label="Current Position (Legacy)"
            value={formData.job_title}
            onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
            placeholder="e.g., Software Engineer at Google"
            helperText="Optional - use Position Title and Company below for better filtering"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Position Title"
              value={formData.position_title}
              onChange={(e) => setFormData({ ...formData, position_title: e.target.value })}
              placeholder="e.g., Software Engineer"
            />
            <Input
              label="Current Company"
              value={formData.current_company}
              onChange={(e) => setFormData({ ...formData, current_company: e.target.value })}
              placeholder="e.g., Google"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Industry"
              value={formData.industry}
              onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
              placeholder="e.g., Technology, Finance, Healthcare"
            />
            <Input
              label="Current City"
              value={formData.current_city}
              onChange={(e) => setFormData({ ...formData, current_city: e.target.value })}
              placeholder="e.g., San Francisco, CA"
            />
          </div>

          <Input
            label="Phone Number"
            type="tel"
            value={formData.phone_number}
            onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
            placeholder="e.g., +1 (555) 123-4567"
          />

          <Input
            label="Photo URL"
            type="url"
            value={formData.photo_url}
            onChange={(e) => setFormData({ ...formData, photo_url: e.target.value })}
            placeholder="https://example.com/photo.jpg"
            helperText="Direct link to alumni photo"
          />

          <Input
            label="LinkedIn profile (optional)"
            type="url"
            value={formData.linkedin_url}
            onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
            placeholder="https://www.linkedin.com/in/username"
            helperText="Must be a valid https:// URL"
          />

          <Textarea
            label="Notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Any additional notes about this alumni..."
            rows={3}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
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
