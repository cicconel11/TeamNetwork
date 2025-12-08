"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { checkIsOrgAdmin } from "@/lib/auth-client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function NewAlumniPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
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
  });

  // Check admin status on mount
  useEffect(() => {
    const checkAdmin = async () => {
      const isAdmin = await checkIsOrgAdmin(orgSlug);
      if (!isAdmin) {
        router.push(`/${orgSlug}/alumni`);
        return;
      }
      setIsChecking(false);
    };
    checkAdmin();
  }, [orgSlug, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const supabase = createClient();

    // Get organization ID
    const { data: orgs, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", orgSlug)
      .limit(1);

    const org = orgs?.[0];

    if (!org || orgError) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const { error: insertError } = await supabase.from("alumni").insert({
      organization_id: org.id,
      first_name: formData.first_name,
      last_name: formData.last_name,
      email: formData.email || null,
      graduation_year: formData.graduation_year ? parseInt(formData.graduation_year) : null,
      major: formData.major || null,
      job_title: formData.job_title || null,
      photo_url: formData.photo_url || null,
      notes: formData.notes || null,
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/alumni`);
    router.refresh();
  };

  if (isChecking) {
    return (
      <div className="animate-pulse">
        <div className="h-8 w-48 bg-muted rounded-xl mb-4" />
        <div className="h-4 w-64 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Add New Alumni"
        description="Add an alumni to your organization's network"
        backHref={`/${orgSlug}/alumni`}
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
            label="Current Position"
            value={formData.job_title}
            onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
            placeholder="e.g., Software Engineer at Google"
          />

          <Input
            label="Photo URL"
            type="url"
            value={formData.photo_url}
            onChange={(e) => setFormData({ ...formData, photo_url: e.target.value })}
            placeholder="https://example.com/photo.jpg"
            helperText="Direct link to alumni photo"
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
              Add Alumni
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
