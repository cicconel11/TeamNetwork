"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { useLocale, useTranslations } from "next-intl";
import { newEventSchema, type NewEventForm } from "@/lib/schemas/content";
import { expandRecurrence, type RecurrenceRule } from "@/lib/events/recurrence";
import { createRecurringEvents } from "@/lib/events/recurring-operations";
import { resolveEventActionLabel } from "@/lib/events/labels";
import { EVENT_TYPE_OPTIONS } from "@/lib/events/event-type-options";
import { calendarEventsPath } from "@/lib/calendar/routes";
import { localToUtcIso, resolveOrgTimezone, getLocalWeekday, getLocalDayOfMonth } from "@/lib/utils/timezone";
import type { NavConfig } from "@/lib/navigation/nav-items";

type TargetUser = {
  id: string;
  label: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function NewCalendarEventPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgTimezone, setOrgTimezone] = useState<string>("America/New_York");
  const [navConfig, setNavConfig] = useState<NavConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userOptions, setUserOptions] = useState<TargetUser[]>([]);
  const [targetUserIds, setTargetUserIds] = useState<string[]>([]);
  const tNav = useTranslations("nav.items");
  const tEvents = useTranslations("events");
  const locale = useLocale();
  const t = (key: string) => tNav(key);
  const singularLabel = resolveEventActionLabel(navConfig, "", t, locale).trim();

  const [repeatType, setRepeatType] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [dayOfMonth, setDayOfMonth] = useState<string>("");
  const [repeatEndDate, setRepeatEndDate] = useState<string>("");

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

  useEffect(() => {
    try {
      if (startDate && repeatType === "weekly" && selectedDays.length === 0) {
        const utcIso = localToUtcIso(startDate, startTime || "12:00", orgTimezone);
        setSelectedDays([String(getLocalWeekday(utcIso, orgTimezone))]);
      }
      if (startDate && repeatType === "monthly" && !dayOfMonth) {
        const utcIso = localToUtcIso(startDate, startTime || "12:00", orgTimezone);
        setDayOfMonth(String(getLocalDayOfMonth(utcIso, orgTimezone)));
      }
    } catch {
      // Submit validation will surface invalid local times.
    }
  }, [startDate, startTime, repeatType, selectedDays.length, dayOfMonth, orgTimezone]);

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

  const instanceCount = useMemo(() => {
    if (repeatType === "none" || !startDate || !startTime) return 0;

    const rule: RecurrenceRule = {
      occurrence_type: repeatType,
      day_of_week: repeatType === "weekly" ? selectedDays.map(Number) : undefined,
      day_of_month: repeatType === "monthly" && dayOfMonth ? Number(dayOfMonth) : undefined,
      recurrence_end_date: repeatEndDate || undefined,
    };

    try {
      const startISO = localToUtcIso(startDate, startTime, orgTimezone);
      const endISO = endDate && endTime ? localToUtcIso(endDate, endTime, orgTimezone) : null;
      return expandRecurrence(startISO, endISO, rule).length;
    } catch {
      return 0;
    }
  }, [repeatType, startDate, startTime, endDate, endTime, selectedDays, dayOfMonth, repeatEndDate, orgTimezone]);

  useEffect(() => {
    const supabase = createClient();
    const load = async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id, nav_config, timezone")
        .eq("slug", orgSlug)
        .maybeSingle();

      if (!org) return;
      setOrgId(org.id);
      setOrgTimezone(resolveOrgTimezone(org.timezone));

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

    let startDateTime: string;
    let endDateTime: string | null;
    try {
      startDateTime = localToUtcIso(data.start_date, data.start_time, orgTimezone);
      endDateTime = data.end_date && data.end_time
        ? localToUtcIso(data.end_date, data.end_time, orgTimezone)
        : null;
    } catch (err) {
      setError(`Invalid date/time: ${err instanceof Error ? err.message : "unknown error"}`);
      setIsLoading(false);
      return;
    }

    const audienceValue = data.audience === "specific" ? "both" : data.audience;
    const targetIds = data.audience === "specific" ? targetUserIds : null;

    let createdEventIds: string[] = [];

    if (data.is_recurring && data.recurrence) {
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
            category: "event",
          }),
        });
      } catch (notifError) {
        console.error("Failed to send notification:", notifError);
      }
    }

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

    router.push(calendarEventsPath(orgSlug));
    router.refresh();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Create New ${singularLabel}`}
        description={`Add ${singularLabel.toLowerCase().startsWith("a") || singularLabel.toLowerCase().startsWith("e") || singularLabel.toLowerCase().startsWith("i") || singularLabel.toLowerCase().startsWith("o") || singularLabel.toLowerCase().startsWith("u") ? "an" : "a"} ${singularLabel.toLowerCase()} to your organization's calendar`}
        backHref={calendarEventsPath(orgSlug)}
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
            data-testid="event-title"
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
              data-testid="event-start-date"
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
                          ? "bg-org-primary text-org-primary-foreground"
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
            data-testid="event-location"
            error={errors.location?.message}
            {...register("location")}
          />

          <Select
            label="Event Type"
            error={errors.event_type?.message}
            options={EVENT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: tEvents(o.value) }))}
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

          {audience === "specific" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Select recipients</label>
              <div className="max-h-56 overflow-auto border border-border rounded-xl divide-y divide-border">
                {userOptions.map((user) => (
                  <label key={user.id} className="flex items-center gap-3 px-3 py-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={targetUserIds.includes(user.id)}
                      onChange={() => toggleTarget(user.id)}
                      className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
                    />
                    <span>{user.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="send_notification"
                checked={watch("send_notification")}
                onChange={(e) => setValue("send_notification", e.target.checked)}
                className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
              />
              <label htmlFor="send_notification" className="text-sm text-foreground">
                Send notification about this event
              </label>
            </div>

            {watch("send_notification") && (
              <Select
                label="Notification channel"
                error={errors.channel?.message}
                options={[
                  { label: "Email", value: "email" },
                  { label: "In-app", value: "in_app" },
                  { label: "Both", value: "both" },
                ]}
                {...register("channel")}
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_philanthropy"
              checked={watch("is_philanthropy")}
              onChange={(e) => setValue("is_philanthropy", e.target.checked)}
              className="h-4 w-4 rounded border-border text-org-primary focus:ring-org-primary"
            />
            <label htmlFor="is_philanthropy" className="text-sm text-foreground">
              Mark as philanthropy event (will show in Philanthropy section)
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" data-testid="event-submit" isLoading={isLoading}>
              Create {singularLabel}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
