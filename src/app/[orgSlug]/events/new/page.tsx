"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveActionLabel } from "@/lib/navigation/label-resolver";
import type { NavConfig } from "@/lib/navigation/nav-items";

type Audience = "members" | "alumni" | "both" | "specific";
type Channel = "email" | "sms" | "both";

type TargetUser = {
  id: string;
  label: string;
};

export default function NewEventPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);

  // Get the custom label for this page
  const singularLabel = resolveActionLabel("/events", navConfig, "").trim();

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    start_date: "",
    start_time: "",
    end_date: "",
    end_time: "",
    location: "",
    event_type: "general",
    is_philanthropy: false,
    audience: "both" as Audience,
    send_notification: true,
    channel: "email" as Channel,
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
      setOrgId(org.id);
      
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

    const { data: { user } } = await supabase.auth.getUser();

    // Combine date and time
    const startDateTime = new Date(`${formData.start_date}T${formData.start_time}`).toISOString();
    const endDateTime = formData.end_date && formData.end_time
      ? new Date(`${formData.end_date}T${formData.end_time}`).toISOString()
      : null;

    const audienceValue = formData.audience === "specific" ? "both" : formData.audience;
    const targetIds = formData.audience === "specific" ? targetUserIds : null;

    const { error: insertError, data: event } = await supabase.from("events").insert({
      organization_id: orgIdToUse,
      title: formData.title,
      description: formData.description || null,
      start_date: startDateTime,
      end_date: endDateTime,
      location: formData.location || null,
      event_type: formData.event_type as "general" | "philanthropy" | "game" | "meeting" | "social" | "fundraiser",
      is_philanthropy: formData.is_philanthropy || formData.event_type === "philanthropy",
      created_by_user_id: user?.id || null,
      audience: audienceValue,
      target_user_ids: targetIds,
    }).select().single();

    if (insertError) {
      setError(insertError.message);
      setIsLoading(false);
      return;
    }

    // Send notification if enabled
    if (formData.send_notification && event) {
      const scheduleLine = formData.start_date && formData.start_time
        ? `When: ${formData.start_date} at ${formData.start_time}`
        : "";
      const locationLine = formData.location ? `Where: ${formData.location}` : null;
      const notificationBody = [formData.description || "", scheduleLine, locationLine]
        .filter(Boolean)
        .join("\n\n");

      try {
        await fetch("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgIdToUse,
            title: `New ${singularLabel}: ${formData.title}`,
            body: notificationBody || `${singularLabel} scheduled for ${formData.start_date} at ${formData.start_time}`,
            channel: formData.channel,
            audience: audienceValue,
            targetUserIds: targetIds,
          }),
        });
      } catch (notifError) {
        console.error("Failed to send notification:", notifError);
      }
    }

    // Trigger Google Calendar sync for users with connected calendars (Requirement 2.1)
    if (event) {
      try {
        await fetch("/api/calendar/event-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: event.id,
            organizationId: orgIdToUse,
            operation: "create",
          }),
        });
      } catch (syncError) {
        // Calendar sync errors should not block event creation
        console.error("Failed to trigger calendar sync:", syncError);
      }
    }

    router.push(`/${orgSlug}/events`);
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Create New ${singularLabel}`}
        description={`Add ${singularLabel.toLowerCase().startsWith("a") || singularLabel.toLowerCase().startsWith("e") || singularLabel.toLowerCase().startsWith("i") || singularLabel.toLowerCase().startsWith("o") || singularLabel.toLowerCase().startsWith("u") ? "an" : "a"} ${singularLabel.toLowerCase()} to your organization's calendar`}
        backHref={`/${orgSlug}/events`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label={`${singularLabel} Title`}
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g., Team Meeting, vs Cornell"
            required
          />

          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Add event details..."
            rows={3}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              required
            />
            <Input
              label="Start Time"
              type="time"
              value={formData.start_time}
              onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="End Date (Optional)"
              type="date"
              value={formData.end_date}
              onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
            />
            <Input
              label="End Time (Optional)"
              type="time"
              value={formData.end_time}
              onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
            />
          </div>

          <Input
            label="Location"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            placeholder="e.g., Franklin Field, Team Room"
          />

          <Select
            label="Event Type"
            value={formData.event_type}
            onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
            options={[
              { value: "general", label: "General" },
              { value: "game", label: "Game" },
              { value: "meeting", label: "Meeting" },
              { value: "social", label: "Social" },
              { value: "fundraiser", label: "Fundraiser" },
              { value: "philanthropy", label: "Philanthropy" },
            ]}
          />

          <Select
            label="Audience"
            value={formData.audience}
            onChange={(e) => setFormData({ ...formData, audience: e.target.value as Audience })}
            options={[
              { label: "Members + Alumni", value: "both" },
              { label: "Active Members only", value: "members" },
              { label: "Alumni only", value: "alumni" },
              { label: "Specific individuals", value: "specific" },
            ]}
          />

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

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_philanthropy"
              checked={formData.is_philanthropy}
              onChange={(e) => setFormData({ ...formData, is_philanthropy: e.target.checked })}
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
            />
            <label htmlFor="is_philanthropy" className="text-sm text-foreground">
              Mark as philanthropy event (will show in Philanthropy section)
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
            Send email or text notification to selected audience
          </label>
        </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Create {singularLabel}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
