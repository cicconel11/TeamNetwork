"use client";

import { useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";
import { localToUtcIso, resolveOrgTimezone } from "@/lib/utils/timezone";

type SubmitState = "idle" | "creating_zoom" | "creating_calendar" | "saving" | "done" | "error";

interface MentorshipScheduleMeetingFormProps {
  pairId: string;
  orgId: string;
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
  meeting: MentorshipMeeting;
  calendarInviteSent: boolean;
}

export function MentorshipScheduleMeetingForm({
  pairId,
  orgId,
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

  const isSubmitting = submitState !== "idle" && submitState !== "done" && submitState !== "error";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Validate required fields
    if (!title.trim() || !date || !time) {
      showFeedback("Please fill in all required fields", "error");
      return;
    }

    try {
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

      const json = (await res.json()) as CreateMeetingResponse & { error?: string };

      if (!res.ok) {
        setSubmitState("error");
        showFeedback(json.error || "Failed to create meeting", "error");
        return;
      }

      setSubmitState("done");

      // Handle success vs partial success
      if (json.calendarInviteSent) {
        showFeedback("Meeting scheduled — calendar invites sent", "success");
      } else {
        showFeedback(
          "Meeting saved — calendar invite could not be sent. Share the link manually.",
          "warning"
        );
      }

      onMeetingCreated(json.meeting);
    } catch (error) {
      setSubmitState("error");
      const errorMessage = error instanceof Error ? error.message : "Failed to create meeting";
      showFeedback(errorMessage, "error");
    }
  };

  return (
    <Card className="max-w-2xl">
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium mb-2">
            Title <span className="text-red-500">*</span>
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
            <label htmlFor="date" className="block text-sm font-medium mb-2">
              Date <span className="text-red-500">*</span>
            </label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div>
            <label htmlFor="time" className="block text-sm font-medium mb-2">
              Time <span className="text-red-500">*</span>
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
          <label htmlFor="duration" className="block text-sm font-medium mb-2">
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
          <label className="block text-sm font-medium mb-3">Platform</label>
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

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
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
            disabled={isSubmitting}
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
    </Card>
  );
}
