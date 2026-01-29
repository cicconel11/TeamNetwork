"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveActionLabel } from "@/lib/navigation/label-resolver";
import { newEventSchema, type NewEventForm } from "@/lib/schemas/content";
import type { NavConfig } from "@/lib/navigation/nav-items";

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
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);

  // Get the custom label for this page
  const singularLabel = resolveActionLabel("/events", navConfig, "").trim();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NewEventForm>({
    resolver: zodResolver(newEventSchema),
    defaultValues: {
      title: "",
      description: "",
      start_date: "",
      start_time: "",
      end_date: "",
      end_time: "",
      location: "",
      event_type: "general",
      is_philanthropy: false,
      audience: "both",
      send_notification: true,
      channel: "email",
    },
  });

  const audience = watch("audience");

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

  const onSubmit = async (data: NewEventForm) => {
    setIsLoading(true);
    setError(null);

    if (data.audience === "specific" && targetUserIds.length === 0) {
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
    const startDateTime = new Date(`${data.start_date}T${data.start_time}`).toISOString();
    const endDateTime = data.end_date && data.end_time
      ? new Date(`${data.end_date}T${data.end_time}`).toISOString()
      : null;

    const audienceValue = data.audience === "specific" ? "both" : data.audience;
    const targetIds = data.audience === "specific" ? targetUserIds : null;

    const { error: insertError, data: event } = await supabase.from("events").insert({
      organization_id: orgIdToUse,
      title: data.title,
      description: data.description || null,
      start_date: startDateTime,
      end_date: endDateTime,
      location: data.location || null,
      event_type: data.event_type,
      is_philanthropy: data.is_philanthropy || data.event_type === "philanthropy",
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
    if (data.send_notification && event) {
      const scheduleLine = data.start_date && data.start_time
        ? `When: ${data.start_date} at ${data.start_time}`
        : "";
      const locationLine = data.location ? `Where: ${data.location}` : null;
      const notificationBody = [data.description || "", scheduleLine, locationLine]
        .filter(Boolean)
        .join("\n\n");

      try {
        await fetch("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgIdToUse,
            title: `New ${singularLabel}: ${data.title}`,
            body: notificationBody || `${singularLabel} scheduled for ${data.start_date} at ${data.start_time}`,
            channel: data.channel,
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
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <Input
            label={`${singularLabel} Title`}
            placeholder="e.g., Team Meeting, vs Cornell"
            error={errors.title?.message}
            {...register("title")}
          />

          <Textarea
            label="Description"
            placeholder="Add event details..."
            rows={3}
            error={errors.description?.message}
            {...register("description")}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              error={errors.start_date?.message}
              {...register("start_date")}
            />
            <Input
              label="Start Time"
              type="time"
              error={errors.start_time?.message}
              {...register("start_time")}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="End Date (Optional)"
              type="date"
              error={errors.end_date?.message}
              {...register("end_date")}
            />
            <Input
              label="End Time (Optional)"
              type="time"
              error={errors.end_time?.message}
              {...register("end_time")}
            />
          </div>

          <Input
            label="Location"
            placeholder="e.g., Franklin Field, Team Room"
            error={errors.location?.message}
            {...register("location")}
          />

          <Select
            label="Event Type"
            error={errors.event_type?.message}
            options={[
              { value: "general", label: "General" },
              { value: "game", label: "Game" },
              { value: "meeting", label: "Meeting" },
              { value: "social", label: "Social" },
              { value: "fundraiser", label: "Fundraiser" },
              { value: "philanthropy", label: "Philanthropy" },
            ]}
            {...register("event_type")}
          />

          <Select
            label="Audience"
            error={errors.audience?.message}
            options={[
              { label: "Members + Alumni", value: "both" },
              { label: "Active Members only", value: "members" },
              { label: "Alumni only", value: "alumni" },
              { label: "Specific individuals", value: "specific" },
            ]}
            {...register("audience")}
          />

          <Select
            label="Notification Channel"
            error={errors.channel?.message}
            options={[
              { label: "Email", value: "email" },
              { label: "SMS", value: "sms" },
              { label: "Email + SMS", value: "both" },
            ]}
            {...register("channel")}
          />

          {audience === "specific" && (
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
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
              {...register("is_philanthropy")}
            />
            <label htmlFor="is_philanthropy" className="text-sm text-foreground">
              Mark as philanthropy event (will show in Philanthropy section)
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="send_notification"
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
              {...register("send_notification")}
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
