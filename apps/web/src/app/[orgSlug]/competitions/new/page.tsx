"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Textarea, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout";

type Audience = "members" | "alumni" | "both" | "specific";
type Channel = "email" | "sms" | "both";
type TargetUser = { id: string; label: string };

export default function NewCompetitionPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: "Intersquad Competition",
    description: "",
    season: new Date().getFullYear().toString(),
    audience: "both" as Audience,
    send_notification: true,
    channel: "email" as Channel,
  });
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org) return;
      setOrgId(org.id);

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

    if (formData.audience === "specific" && targetUserIds.length === 0) {
      setError("Select at least one recipient for this notification.");
      setIsLoading(false);
      return;
    }

    const supabase = createClient();

    const orgIdToUse = orgId
      ? orgId
      : (await supabase.from("organizations").select("id").eq("slug", orgSlug).maybeSingle()).data?.id;

    if (!orgIdToUse) {
      setError("Organization not found");
      setIsLoading(false);
      return;
    }

    const audienceValue = formData.audience === "specific" ? "both" : formData.audience;
    const targetIds = formData.audience === "specific" ? targetUserIds : null;

    const { error: insertError, data: competition } = await supabase.from("competitions").insert({
      organization_id: orgIdToUse,
      name: formData.name,
      description: formData.description || null,
      season: formData.season || null,
    }).select().single();

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    if (formData.send_notification && competition) {
      const seasonLine = formData.season ? `Season: ${formData.season}` : "";
      const notificationBody = [formData.description || "", seasonLine]
        .filter(Boolean)
        .join("\n\n");

      try {
        await fetch("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgIdToUse,
            title: `New Competition: ${formData.name}`,
            body: notificationBody || "A new competition has been created.",
            channel: formData.channel,
            audience: audienceValue,
            targetUserIds: targetIds,
          }),
        });
      } catch (notifError) {
        console.error("Failed to send competition notification:", notifError);
      }
    }

    router.push(`/${orgSlug}/competition`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Create Competition"
        description="Set up a new internal competition"
        backHref={`/${orgSlug}/competition`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label="Competition Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Wagner Cup"
            required
          />

          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the competition and how points are earned..."
            rows={3}
          />

          <Input
            label="Season"
            value={formData.season}
            onChange={(e) => setFormData({ ...formData, season: e.target.value })}
            placeholder="e.g., 2025, Fall 2025"
          />

          <Select
            label="Audience"
            value={formData.audience}
            onChange={(e) => setFormData({ ...formData, audience: e.target.value as Audience })}
            options={[
              { label: "Members + Alumni", value: "both" },
              { label: "Members only", value: "members" },
              { label: "Alumni only", value: "alumni" },
              { label: "Specific individuals", value: "specific" },
            ]}
          />

          {formData.audience === "specific" && (
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

          <Select
            label="Notification Channel"
            value={formData.channel}
            onChange={(e) => setFormData({ ...formData, channel: e.target.value as Channel })}
            options={[
              { label: "Email", value: "email" },
              { label: "SMS", value: "sms" },
              { label: "Email + SMS", value: "both" },
            ]}
          />

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="send_notification"
              checked={formData.send_notification}
              onChange={(e) => setFormData({ ...formData, send_notification: e.target.checked })}
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
            />
            <label htmlFor="send_notification" className="text-sm text-foreground">
              Send email or text notification to selected audience
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Create Competition
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
