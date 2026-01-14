"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import type { Announcement, AnnouncementAudience } from "@/types/database";

type TargetUser = {
  id: string;
  label: string;
};

export default function EditAnnouncementPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const announcementId = params.announcementId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);

  const [formData, setFormData] = useState({
    title: "",
    body: "",
    is_pinned: false,
    audience: "all" as AnnouncementAudience,
  });
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);

  useEffect(() => {
    const fetchData = async () => {
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

      // Fetch announcement
      const { data: announcement } = await supabase
        .from("announcements")
        .select("*")
        .eq("id", announcementId)
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .single();

      if (!announcement) {
        setError("Announcement not found");
        setIsFetching(false);
        return;
      }

      const a = announcement as Announcement;
      setFormData({
        title: a.title || "",
        body: a.body || "",
        is_pinned: a.is_pinned || false,
        audience: (a.audience as AnnouncementAudience) || "all",
      });
      setTargetUserIds(a.audience_user_ids || []);

      // Fetch user options for specific individuals
      const { data: memberships } = await supabase
        .from("user_organization_roles")
        .select("user_id, users(name,email)")
        .eq("organization_id", org.id)
        .eq("status", "active");

      const options =
        memberships?.map((m) => {
          const user = Array.isArray(m.users) ? m.users[0] : m.users;
          return {
            id: m.user_id,
            label: user?.name || user?.email || "User",
          };
        }) || [];

      setUserOptions(options);
      setIsFetching(false);
    };

    fetchData();
  }, [orgSlug, announcementId]);

  const toggleTarget = (id: string) => {
    setTargetUserIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    const audienceUserIds = formData.audience === "individuals" ? targetUserIds : null;

    const { error: updateError } = await supabase
      .from("announcements")
      .update({
        title: formData.title,
        body: formData.body || null,
        is_pinned: formData.is_pinned,
        audience: formData.audience,
        audience_user_ids: audienceUserIds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", announcementId)
      .eq("organization_id", org.id);

    if (updateError) {
      setError(updateError.message);
      setIsLoading(false);
      return;
    }

    router.push(`/${orgSlug}/announcements`);
    router.refresh();
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Edit Announcement"
          description="Loading..."
          backHref={`/${orgSlug}/announcements`}
        />
        <Card className="max-w-2xl p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded-xl" />
            <div className="h-24 bg-muted rounded-xl" />
            <div className="h-10 bg-muted rounded-xl" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Edit Announcement"
        description="Update announcement details"
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

          <Select
            label="Audience"
            value={formData.audience}
            onChange={(e) => setFormData({ ...formData, audience: e.target.value as AnnouncementAudience })}
            options={[
              { label: "All Members", value: "all" },
              { label: "Active Members Only", value: "active_members" },
              { label: "Members (Active + Inactive)", value: "members" },
              { label: "Alumni Only", value: "alumni" },
              { label: "Specific Individuals", value: "individuals" },
            ]}
          />

          {formData.audience === "individuals" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Select recipients</p>
              <div className="max-h-48 overflow-y-auto space-y-2 rounded-xl border border-border p-3">
                {userOptions.length === 0 && (
                  <p className="text-sm text-muted-foreground">No users available</p>
                )}
                {userOptions.map((user) => (
                  <label key={user.id} className="flex items-center gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={targetUserIds.includes(user.id)}
                      onChange={() => toggleTarget(user.id)}
                    />
                    <span className="truncate">{user.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

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
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

