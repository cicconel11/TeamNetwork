"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Select, Textarea } from "@/components/ui";
import { PageHeader } from "@/components/layout";
import { resolveActionLabel } from "@/lib/navigation/label-resolver";
import { editEventSchema, type EditEventForm } from "@/lib/schemas/content";
import { updateFutureEvents } from "@/lib/events/recurring-operations";
import type { NavConfig } from "@/lib/navigation/nav-items";
import type { Event, EventType } from "@/types/database";

type EditScope = "this_only" | "this_and_future";

export default function EditEventPage() {
  const router = useRouter();
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const eventId = params.eventId as string;

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navConfig, setNavConfig] = useState<NavConfig | null>(null);
  const [isRecurring, setIsRecurring] = useState(false);
  const [showScopeDialog, setShowScopeDialog] = useState(false);
  const [pendingData, setPendingData] = useState<EditEventForm | null>(null);

  // Get the custom label for this page
  const singularLabel = resolveActionLabel("/events", navConfig, "").trim();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<EditEventForm>({
    resolver: zodResolver(editEventSchema),
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
    },
  });

  const eventType = watch("event_type");
  const isPhilanthropy = watch("is_philanthropy");

  useEffect(() => {
    const fetchEvent = async () => {
      const supabase = createClient();

      const { data: org } = await supabase
        .from("organizations")
        .select("id, nav_config")
        .eq("slug", orgSlug)
        .single();

      if (!org) {
        setError("Organization not found");
        setIsFetching(false);
        return;
      }

      // Parse nav_config
      if (org.nav_config && typeof org.nav_config === "object" && !Array.isArray(org.nav_config)) {
        setNavConfig(org.nav_config as NavConfig);
      }

      const { data: event } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .single();

      if (!event) {
        setError("Event not found");
        setIsFetching(false);
        return;
      }

      const e = event as Event;
      setIsRecurring(!!e.recurrence_group_id);

      const startDate = new Date(e.start_date);
      const endDate = e.end_date ? new Date(e.end_date) : null;

      reset({
        title: e.title || "",
        description: e.description || "",
        start_date: startDate.toISOString().split("T")[0],
        start_time: startDate.toTimeString().slice(0, 5),
        end_date: endDate ? endDate.toISOString().split("T")[0] : "",
        end_time: endDate ? endDate.toTimeString().slice(0, 5) : "",
        location: e.location || "",
        event_type: e.event_type || "general",
        is_philanthropy: e.is_philanthropy || false,
      });
      setIsFetching(false);
    };

    fetchEvent();
  }, [orgSlug, eventId, reset]);

  const onSubmit = async (data: EditEventForm) => {
    if (isRecurring) {
      // Show scope dialog for recurring events
      setPendingData(data);
      setShowScopeDialog(true);
      return;
    }

    await applyUpdate(data, "this_only");
  };

  const applyUpdate = async (data: EditEventForm, scope: EditScope) => {
    setIsLoading(true);
    setError(null);
    setShowScopeDialog(false);

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

    // Combine date and time
    const startDateTime = new Date(`${data.start_date}T${data.start_time}`).toISOString();
    const endDateTime = data.end_date && data.end_time
      ? new Date(`${data.end_date}T${data.end_time}`).toISOString()
      : null;

    if (scope === "this_and_future") {
      // Update this event and all future events in the series
      // Note: only title, description, location, event_type, is_philanthropy are propagated
      const { updatedIds, error: updateError } = await updateFutureEvents(supabase, eventId, org.id, {
        title: data.title,
        description: data.description || null,
        location: data.location || null,
        event_type: data.event_type,
        is_philanthropy: data.is_philanthropy || data.event_type === "philanthropy",
      });

      if (updateError) {
        setError(updateError);
        setIsLoading(false);
        return;
      }

      // Also update the current event's date/time specifically
      await supabase
        .from("events")
        .update({
          start_date: startDateTime,
          end_date: endDateTime,
          updated_at: new Date().toISOString(),
        })
        .eq("id", eventId)
        .eq("organization_id", org.id);

      // Sync all affected events to Google Calendar
      try {
        await Promise.allSettled(
          updatedIds.map((id) =>
            fetch("/api/calendar/event-sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                eventId: id,
                organizationId: org.id,
                operation: "update",
              }),
            })
          )
        );
      } catch (syncError) {
        console.error("Failed to trigger calendar sync:", syncError);
      }

      router.push(`/${orgSlug}/events/${eventId}`);
      router.refresh();
      return;
    } else {
      // Update only this event
      const { error: updateError } = await supabase
        .from("events")
        .update({
          title: data.title,
          description: data.description || null,
          start_date: startDateTime,
          end_date: endDateTime,
          location: data.location || null,
          event_type: data.event_type,
          is_philanthropy: data.is_philanthropy || data.event_type === "philanthropy",
          updated_at: new Date().toISOString(),
        })
        .eq("id", eventId)
        .eq("organization_id", org.id);

      if (updateError) {
        setError(updateError.message);
        setIsLoading(false);
        return;
      }
    }

    // Trigger Google Calendar sync
    try {
      await fetch("/api/calendar/event-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: eventId,
          organizationId: org.id,
          operation: "update",
        }),
      });
    } catch (syncError) {
      console.error("Failed to trigger calendar sync:", syncError);
    }

    router.push(`/${orgSlug}/events/${eventId}`);
    router.refresh();
  };

  if (isFetching) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title={`Edit ${singularLabel}`}
          description="Loading..."
          backHref={`/${orgSlug}/events/${eventId}`}
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
        title={`Edit ${singularLabel}`}
        description={`Update ${singularLabel.toLowerCase()} details`}
        backHref={`/${orgSlug}/events/${eventId}`}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {isRecurring && (
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm">
              This event is part of a recurring series. When you save, you can choose to update just this event or all future events.
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
            value={eventType}
            onChange={(e) => setValue("event_type", e.target.value as EventType)}
            error={errors.event_type?.message}
            options={[
              { value: "general", label: "General" },
              { value: "game", label: "Game" },
              { value: "meeting", label: "Meeting" },
              { value: "social", label: "Social" },
              { value: "fundraiser", label: "Fundraiser" },
              { value: "philanthropy", label: "Philanthropy" },
            ]}
          />

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_philanthropy"
              checked={isPhilanthropy}
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
            <Button type="submit" isLoading={isLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>

      {/* Scope Dialog for Recurring Events */}
      {showScopeDialog && pendingData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-2xl p-6 max-w-sm mx-4 shadow-xl border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-2">Edit Recurring Event</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This event is part of a recurring series. How would you like to apply your changes?
            </p>

            <div className="space-y-3">
              <button
                onClick={() => applyUpdate(pendingData, "this_only")}
                disabled={isLoading}
                className="w-full text-left px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors text-sm"
              >
                <span className="font-medium text-foreground">This event only</span>
                <p className="text-muted-foreground mt-0.5">Only update this specific occurrence</p>
              </button>

              <button
                onClick={() => applyUpdate(pendingData, "this_and_future")}
                disabled={isLoading}
                className="w-full text-left px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors text-sm"
              >
                <span className="font-medium text-foreground">This and future events</span>
                <p className="text-muted-foreground mt-0.5">Update title, description, location, and type for all future events</p>
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowScopeDialog(false);
                  setPendingData(null);
                }}
                disabled={isLoading}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
