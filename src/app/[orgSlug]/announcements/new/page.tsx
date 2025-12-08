"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { checkIsOrgAdmin } from "@/lib/auth-client";
import { Card, Button, Input, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";

export default function NewAnnouncementPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    title: "",
    body: "",
    is_pinned: false,
  });

  // Check admin status on mount
  useEffect(() => {
    const checkAdmin = async () => {
      const isAdmin = await checkIsOrgAdmin(orgSlug);
      if (!isAdmin) {
        router.push(`/${orgSlug}/announcements`);
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

    const { error: insertError } = await supabase.from("announcements").insert({
      organization_id: org.id,
      title: formData.title,
      body: formData.body || null,
      is_pinned: formData.is_pinned,
      published_at: new Date().toISOString(),
    });

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/announcements`);
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
        title="New Announcement"
        description="Share news with your organization"
        backHref={`/${orgSlug}/announcements`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., Team Meeting Rescheduled"
            required
          />

          <Textarea
            label="Body"
            value={formData.body}
            onChange={(e) => setFormData({ ...formData, body: e.target.value })}
            placeholder="Write your announcement..."
            rows={6}
          />

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_pinned"
              checked={formData.is_pinned}
              onChange={(e) => setFormData({ ...formData, is_pinned: e.target.checked })}
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
            />
            <label htmlFor="is_pinned" className="text-sm text-foreground">
              Pin this announcement (will appear at the top)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Publish Announcement
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
