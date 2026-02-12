"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveActionLabel } from "@/lib/navigation/label-resolver";
import { newEventSchema, type NewEventForm } from "@/lib/schemas/content";
import { expandRecurrence, type RecurrenceRule } from "@/lib/events/recurrence";
import { createRecurringEvents } from "@/lib/events/recurring-operations";
import type { NavConfig } from "@/lib/navigation/nav-items";

type TargetUser = {
  id: string;
  label: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  // Recurrence UI state
  const [repeatType, setRepeatType] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [dayOfMonth, setDayOfMonth] = useState<string>("");
  const [repeatEndDate, setRepeatEndDate] = useState<string>("");

  // Get the custom label for this page
  const singularLabel = resolveActionLabel("/events", navConfig, "").trim();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
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
      is_recurring: false,
    },
  });

  const audience = watch("audience");
  const startDate = watch("start_date");
  const startTime = watch("start_time");
  const endDate = watch("end_date");
  const endTime = watch("end_time");

  // Auto-select day of week from start_date
  useEffect(() => {
    if (startDate && repeatType === "weekly" && selectedDays.length === 0) {
      const d = new Date(startDate + "T00:00:00Z");
      setSelectedDays([String(d.getUTCDay())]);
    }
    if (startDate && repeatType === "monthly" && !dayOfMonth) {
      const d = new Date(startDate + "T00:00:00Z");
      setDayOfMonth(String(d.getUTCDate()));
    }
  }, [startDate, repeatType, selectedDays.length, dayOfMonth]);

  // Sync recurrence state to form values
  useEffect(() => {
    const isRecurring = repeatType !== "none";
    setValue("is_recurring", isRecurring);

    if (!isRecurring) {
      setValue("recurrence", undefined);
      return;
    }

    if (repeatType === "daily") {
      setValue("recurrence", {
        occurrence_type: "daily",
        recurrence_end_date: repeatEndDate || undefined,
      });
    } else if (repeatType === "weekly" && selectedDays.length > 0) {
      setValue("recurrence", {
        occurrence_type: "weekly",
        day_of_week: selectedDays,
        recurrence_end_date: repeatEndDate || undefined,
      });
    } else if (repeatType === "monthly" && dayOfMonth) {
      setValue("recurrence", {
        occurrence_type: "monthly",
        day_of_month: dayOfMonth,
        recurrence_end_date: repeatEndDate || undefined,
      });
    }
  }, [repeatType, selectedDays, dayOfMonth, repeatEndDate, setValue]);

  // Instance count preview
  const instanceCount = useMemo(() => {
    if (repeatType === "none" || !startDate || !startTime) return 0;

    const rule: RecurrenceRule = {
      occurrence_type: repeatType,
      day_of_week: repeatType === "weekly" ? selectedDays.map(Number) : undefined,
      day_of_month: repeatType === "monthly" && dayOfMonth ? Number(dayOfMonth) : undefined,
      recurrence_end_date: repeatEndDate || undefined,
    };

    const startISO = new Date(`${startDate}T${startTime}`).toISOString();
    const endISO = endDate && endTime ? new Date(`${endDate}T${endTime}`).toISOString() : null;

    try {
      return expandRecurrence(startISO, endISO, rule).length;
    } catch {
      return 0;
    }
  }, [repeatType, startDate, startTime, endDate, endTime, selectedDays, dayOfMonth, repeatEndDate]);

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

  const toggleDay = (day: string) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
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

    let createdEventIds: string[] = [];

    if (data.is_recurring && data.recurrence) {
      // Recurring: build the RecurrenceRule and create all instances
      const rule: RecurrenceRule = {
        occurrence_type: data.recurrence.occurrence_type,
        day_of_week: "day_of_week" in data.recurrence ? data.recurrence.day_of_week.map(Number) : undefined,
        day_of_month: "day_of_month" in data.recurrence ? Number(data.recurrence.day_of_month) : undefined,
        recurrence_end_date: data.recurrence.recurrence_end_date || undefined,
      };

      const result = await createRecurringEvents(supabase, {
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
      }, rule);

      if (result.error) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      createdEventIds = result.eventIds;
    } else {
      // Single event
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

      if (event) createdEventIds = [event.id];
    }

    // Send one notification for the series (or single event)
    if (data.send_notification && createdEventIds.length > 0) {
      const scheduleLine = data.start_date && data.start_time
        ? `When: ${data.start_date} at ${data.start_time}`
        : "";
      const locationLine = data.location ? `Where: ${data.location}` : null;
      const recurringLine = data.is_recurring && instanceCount > 1
        ? `This is a recurring ${data.recurrence?.occurrence_type} event (${instanceCount} occurrences)`
        : null;
      const notificationBody = [data.description || "", scheduleLine, locationLine, recurringLine]
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

    // Trigger Google Calendar sync for all created events
    if (createdEventIds.length > 0) {
      const syncPromises = createdEventIds.map((eventId) =>
        fetch("/api/calendar/event-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            organizationId: orgIdToUse,
            operation: "create",
          }),
        }).catch((err) => console.error("Calendar sync error:", err))
      );

      await Promise.allSettled(syncPromises);
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

          {/* Recurrence Section */}
          <div className="space-y-4">
            <Select
              label="Repeat"
              value={repeatType}
              onChange={(e) => {
                const val = e.target.value as typeof repeatType;
                setRepeatType(val);
                if (val !== "weekly") setSelectedDays([]);
                if (val !== "monthly") setDayOfMonth("");
              }}
              options={[
                { value: "none", label: "Does not repeat" },
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />

            {repeatType === "weekly" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Repeat on</label>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => toggleDay(String(index))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        selectedDays.includes(String(index))
                          ? "bg-org-primary text-white"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {selectedDays.length === 0 && (
                  <p className="text-sm text-red-500">Select at least one day</p>
                )}
              </div>
            )}

            {repeatType === "monthly" && (
              <Input
                label="Day of month"
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                placeholder="e.g., 15"
              />
            )}

            {repeatType !== "none" && (
              <>
                <Input
                  label="Repeat until (optional)"
                  type="date"
                  value={repeatEndDate}
                  onChange={(e) => setRepeatEndDate(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  {!repeatEndDate && "Default: 6 months from start date"}
                </p>

                {instanceCount > 0 && (
                  <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm">
                    This will create <strong>{instanceCount}</strong> {instanceCount === 1 ? "event" : "events"}
                  </div>
                )}
              </>
            )}
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
              {repeatType !== "none" && instanceCount > 1
                ? `Create ${instanceCount} ${singularLabel}s`
                : `Create ${singularLabel}`
              }
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
