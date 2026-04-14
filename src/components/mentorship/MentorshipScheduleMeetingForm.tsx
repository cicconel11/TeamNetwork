"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, InlineBanner, Input, Select } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";
import {
  getDateInputValue,
  localToUtcIso,
  resolveOrgTimezone,
} from "@/lib/utils/timezone";
import { useGoogleCalendarSync } from "@/hooks/useGoogleCalendarSync";

type SubmitState = "idle" | "creating_zoom" | "creating_calendar" | "saving" | "done" | "error";
type MeetingErrorCode =
  | "google_calendar_required"
  | "google_calendar_reconnect_required"
  | "google_meet_creation_failed";

interface MentorshipScheduleMeetingFormProps {
  pairId: string;
  orgId: string;
  orgSlug: string;
  orgTimezone: string;
  onMeetingCreated: (meeting: MentorshipMeeting) => void;
  onCancel: () => void;
}

interface MentorshipMeeting {
  id: string;
  pair_id: string;
  organization_id: string;
  title: string;
  scheduled_at: string;
  scheduled_end_at: string;
  duration_minutes: number;
  platform: string;
  meeting_link: string | null;
  calendar_event_id: string | null;
  calendar_sync_status: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface CreateMeetingResponse {
  meeting?: MentorshipMeeting;
  calendarInviteSent?: boolean;
  error?: string;
  errorCode?: MeetingErrorCode;
}

export function MentorshipScheduleMeetingForm({
  pairId,
  orgId,
  orgSlug,
  orgTimezone,
  onMeetingCreated,
  onCancel,
}: MentorshipScheduleMeetingFormProps) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [platform, setPlatform] = useState<"google_meet" | "zoom">("google_meet");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [formError, setFormError] = useState<{
    message: string;
    action: "connect" | "reconnect" | null;
  } | null>(null);

  const redirectPath = useMemo(
    () => `/${orgSlug}/mentorship?tab=meetings${pairId ? `&pair=${pairId}` : ""}`,
    [orgSlug, pairId]
  );
  const googleCalendar = useGoogleCalendarSync({
    orgId,
    orgSlug,
    redirectPath,
  });

  const isSubmitting = submitState !== "idle" && submitState !== "done" && submitState !== "error";
  const isCheckingGoogleCalendar =
    googleCalendar.connectionLoading ||
    (googleCalendar.isConnected && googleCalendar.calendarsLoading);
  const googleMeetReady =
    !isCheckingGoogleCalendar &&
    googleCalendar.isConnected &&
    !googleCalendar.reconnectRequired;

  useEffect(() => {
    setFormError(null);
  }, [platform]);

  useEffect(() => {
    if (platform !== "google_meet") return;

    if (isCheckingGoogleCalendar) {
      setFormError({
        message: "Checking Google Calendar connection…",
        action: null,
      });
      return;
    }

    if (googleMeetReady) {
      setFormError(null);
      return;
    }

    if (googleCalendar.reconnectRequired) {
      setFormError({
        message: "Reconnect Google Calendar before scheduling a Google Meet meeting.",
        action: "reconnect",
      });
      return;
    }

    if (googleCalendar.connection?.status === "disconnected" || googleCalendar.connection?.status === "error") {
      setFormError({
        message: "Reconnect Google Calendar before scheduling a Google Meet meeting.",
        action: "reconnect",
      });
      return;
    }

    setFormError({
      message: "Connect Google Calendar before scheduling a Google Meet meeting.",
      action: "connect",
    });
  }, [
    googleCalendar.connection?.status,
    googleCalendar.isConnected,
    googleCalendar.reconnectRequired,
    googleMeetReady,
    isCheckingGoogleCalendar,
    platform,
  ]);

  const triggerGoogleCalendarAuth = () => {
    if (formError?.action === "reconnect") {
      googleCalendar.reconnect();
      return;
    }
    googleCalendar.connect();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Validate required fields
    if (!title.trim() || !date || !time) {
      showFeedback("Please fill in all required fields", "error");
      return;
    }

    if (platform === "google_meet" && !googleMeetReady) {
      setSubmitState("error");
      return;
    }

    try {
      setFormError(null);
      setSubmitState(platform === "zoom" ? "creating_zoom" : "idle");

      // Convert local date/time to UTC ISO string using org timezone
      const tz = resolveOrgTimezone(orgTimezone);
      const scheduledAtUtc = localToUtcIso(date, time, tz);

      // Calculate end time
      const durationMs = parseInt(duration, 10) * 60 * 1000;
      const endDate = new Date(new Date(scheduledAtUtc).getTime() + durationMs);
      const scheduledEndAtUtc = endDate.toISOString();

      // Show calendar step
      setSubmitState("creating_calendar");

      // POST to API
      const res = await fetch(`/api/organizations/${orgId}/mentorship/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair_id: pairId,
          title: title.trim(),
          scheduled_at: scheduledAtUtc,
          scheduled_end_at: scheduledEndAtUtc,
          duration_minutes: parseInt(duration, 10),
          platform,
        }),
      });

      setSubmitState("saving");

      const json = (await res.json()) as CreateMeetingResponse;

      if (!res.ok) {
        setSubmitState("error");
        if (
          json.errorCode === "google_calendar_required" ||
          json.errorCode === "google_calendar_reconnect_required" ||
          json.errorCode === "google_meet_creation_failed"
        ) {
          setFormError({
            message: json.error || "Failed to create Google Meet invite",
            action:
              json.errorCode === "google_calendar_required"
                ? "connect"
                : "reconnect",
          });
          return;
        }

        showFeedback(json.error || "Failed to create meeting", "error");
        return;
      }

      if (!json.meeting) {
        setSubmitState("error");
        showFeedback("Failed to create meeting", "error");
        return;
      }

      setSubmitState("done");

      // Handle success vs partial success
      if (json.calendarInviteSent) {
        showFeedback("Meeting scheduled — calendar invites sent", "success");
      } else if (platform === "zoom") {
        showFeedback(
          "Meeting saved — calendar invite could not be sent. Share the link manually.",
          "warning"
        );
      } else {
        setSubmitState("error");
        setFormError({
          message: "Google Meet link could not be created. Reconnect Google Calendar and try again.",
          action: "reconnect",
        });
        return;
      }

      onMeetingCreated(json.meeting);
    } catch (error) {
      setSubmitState("error");
      const errorMessage = error instanceof Error ? error.message : "Failed to create meeting";
      showFeedback(errorMessage, "error");
    }
  };

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit} className="px-4 py-3 space-y-3">
        <div>
          <label htmlFor="title" className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
            Title
          </label>
          <Input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Weekly Check-in"
            disabled={isSubmitting}
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="date" className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
              Date
            </label>
            <Input
              id="date"
              type="date"
              value={date}
              min={getDateInputValue(new Date(), orgTimezone)}
              onChange={(e) => setDate(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div>
            <label htmlFor="time" className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
              Time
            </label>
            <Input
              id="time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="duration" className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
            Duration
          </label>
          <Select
            id="duration"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            disabled={isSubmitting}
            options={[
              { value: "30", label: "30 minutes" },
              { value: "45", label: "45 minutes" },
              { value: "60", label: "60 minutes" },
              { value: "90", label: "90 minutes" },
            ]}
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">Platform</label>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="platform"
                value="google_meet"
                checked={platform === "google_meet"}
                onChange={(e) => setPlatform(e.target.value as "google_meet" | "zoom")}
                disabled={isSubmitting}
                className="accent-blue-600"
              />
              <span className="text-sm">Google Meet</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="platform"
                value="zoom"
                checked={platform === "zoom"}
                onChange={(e) => setPlatform(e.target.value as "google_meet" | "zoom")}
                disabled={isSubmitting}
                className="accent-blue-600"
              />
              <span className="text-sm">Zoom</span>
            </label>
          </div>
        </div>

        {platform === "google_meet" && formError && (
          <InlineBanner
            variant={formError.action ? "warning" : "info"}
            className="flex items-center justify-between gap-3"
          >
            <span>{formError.message}</span>
            {formError.action && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={triggerGoogleCalendarAuth}
              >
                {formError.action === "reconnect"
                  ? "Reconnect Google Calendar"
                  : "Connect Google Calendar"}
              </Button>
            )}
          </InlineBanner>
        )}

        <div className="flex justify-end gap-3 pt-3">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || (platform === "google_meet" && !googleMeetReady)}
            isLoading={isSubmitting}
          >
            {submitState === "idle" && "Schedule Meeting"}
            {submitState === "creating_zoom" && "Creating Zoom Meeting…"}
            {submitState === "creating_calendar" && "Creating Calendar Invite…"}
            {submitState === "saving" && "Saving…"}
            {submitState === "done" && "Done"}
            {submitState === "error" && "Try Again"}
          </Button>
        </div>
      </form>
    </div>
  );
}
