"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { Alumni } from "@/types/database";

export default function EditAlumniPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const alumniId = params.alumniId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setFormData({
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
  }, [orgSlug, alumniId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
            <Button type="submit" isLoading={isLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}







