"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

type Audience = "all" | "members" | "active_members" | "alumni" | "individuals";

type TargetUser = {
  id: string;
  label: string;
};

export default function NewAnnouncementPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [navConfig, setNavConfig] = useState<NavConfig | null>(null);

  // Get the custom label for this page
  const singularLabel = resolveActionLabel("/announcements", navConfig, "").trim();

  const [formData, setFormData] = useState({
    title: "",
    body: "",
    is_pinned: false,
    audience: "all" as Audience,
    send_notification: true,
  });
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id, nav_config")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org) return;

      // Parse nav_config
      if (org.nav_config && typeof org.nav_config === "object" && !Array.isArray(org.nav_config)) {
        setNavConfig(org.nav_config as NavConfig);
      }

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
    };

    load();
  }, [orgSlug]);

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

    const { data: { user } } = await supabase.auth.getUser();

    const audienceUserIds = formData.audience === "individuals" ? targetUserIds : null;

    const { error: insertError, data: announcement } = await supabase
      .from("announcements")
      .insert({
        organization_id: org.id,
        title: formData.title,
        body: formData.body || null,
        is_pinned: formData.is_pinned,
        published_at: new Date().toISOString(),
        created_by_user_id: user?.id || null,
        audience: formData.audience,
        audience_user_ids: audienceUserIds,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    // Send notification if enabled
    if (formData.send_notification && announcement) {
      try {
        // Map announcement audience to notification audience
        const notifAudience = formData.audience === "all" ? "both" 
          : formData.audience === "active_members" ? "members"
          : formData.audience === "individuals" ? "both"
          : formData.audience;
        
        // Create notification record
        const { data: notification } = await supabase.from("notifications").insert({
          organization_id: org.id,
          title: formData.title,
          body: formData.body || null,
          channel: "email,push",
          audience: notifAudience,
          target_user_ids: audienceUserIds,
        }).select().single();

        // Trigger actual email sending via API
        if (notification) {
          await fetch("/api/notifications/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ announcementId: announcement.id }),
          });
        }
      } catch (notifError) {
        console.error("Failed to send notification:", notifError);
        // Don't block on notification failure - announcement was created successfully
      }
    }

    router.push(`/${orgSlug}/announcements`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`New ${singularLabel}`}
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

          <Select
            label="Audience"
            value={formData.audience}
            onChange={(e) => setFormData({ ...formData, audience: e.target.value as Audience })}
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

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="send_notification"
              checked={formData.send_notification}
              onChange={(e) => setFormData({ ...formData, send_notification: e.target.checked })}
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
            />
            <label htmlFor="send_notification" className="text-sm text-foreground">
              Send push notification to selected audience
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Publish {singularLabel}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
