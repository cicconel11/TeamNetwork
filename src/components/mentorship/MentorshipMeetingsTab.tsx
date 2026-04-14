"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { Badge } from "@/components/ui/Badge";
import { showFeedback } from "@/lib/feedback/show-feedback";
import { MentorshipPairPicker } from "./MentorshipPairPicker";
import { MentorshipScheduleMeetingForm } from "./MentorshipScheduleMeetingForm";

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

interface MentorshipMeetingsTabProps {
  initialUpcoming: MentorshipMeeting[];
  initialPast: MentorshipMeeting[];
  pairs: Array<{ id: string; mentorName: string; menteeName: string }>;
  initialPairId: string;
  isMentor: boolean;
  isAdmin: boolean;
  orgId: string;
  orgSlug: string;
  currentUserId: string;
}

function formatDateTime(dateTimeStr: string, orgTimezone?: string): string {
  const date = new Date(dateTimeStr);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (orgTimezone) opts.timeZone = orgTimezone;
  return date.toLocaleDateString("en-US", opts);
}

export function MentorshipMeetingsTab({
  initialUpcoming,
  initialPast,
  pairs,
  initialPairId,
  isMentor,
  isAdmin,
  orgId,
  orgSlug,
}: MentorshipMeetingsTabProps) {
  const [upcoming, setUpcoming] = useState<MentorshipMeeting[]>(initialUpcoming);
  const [past, setPast] = useState<MentorshipMeeting[]>(initialPast);
  const [selectedPairId, setSelectedPairId] = useState(initialPairId);
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch meetings when pair changes
  useEffect(() => {
    if (!selectedPairId) {
      setUpcoming([]);
      setPast([]);
      return;
    }

    // Cancel previous request if still in flight
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const fetchMeetings = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/meetings?pairId=${selectedPairId}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          throw new Error("Failed to fetch meetings");
        }

        const { upcoming: upcomingData, past: pastData } = await res.json();
        setUpcoming(upcomingData || []);
        setPast(pastData || []);
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          showFeedback("Failed to load meetings", "error");
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchMeetings();

    // Cleanup abort controller on unmount
    return () => {
      controller.abort();
    };
  }, [selectedPairId, orgId]);

  const handlePairChange = (pairId: string) => {
    setSelectedPairId(pairId);
  };

  const handleMeetingCreated = (meeting: MentorshipMeeting) => {
    setShowForm(false);
    // Add to upcoming optimistically
    setUpcoming((prev) => [meeting, ...prev]);
    // Update URL
    const params = new URLSearchParams();
    params.set("tab", "meetings");
    if (pairs.length > 1) {
      params.set("pair", selectedPairId);
    }
    window.history.replaceState(null, "", `/${orgSlug}/mentorship?${params.toString()}`);
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/meetings/${meetingId}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        throw new Error("Failed to delete meeting");
      }

      // Remove from state
      setUpcoming((prev) => prev.filter((m) => m.id !== meetingId));
      setPast((prev) => prev.filter((m) => m.id !== meetingId));
      showFeedback("Meeting deleted", "success");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete meeting";
      showFeedback(errorMessage, "error");
    }
  };

  if (!selectedPairId && pairs.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">No mentorship pairs found.</p>
      </div>
    );
  }

  const selectedPair = pairs.find((p) => p.id === selectedPairId);

  return (
    <div className="space-y-6">
      {pairs.length > 1 && (
        <MentorshipPairPicker
          pairs={pairs}
          selectedPairId={selectedPairId}
          onPairChange={handlePairChange}
        />
      )}

      {showForm && isMentor ? (
        <MentorshipScheduleMeetingForm
          pairId={selectedPairId}
          orgId={orgId}
          orgTimezone="UTC"
          onMeetingCreated={handleMeetingCreated}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      {isMentor && !showForm && (
        <Button onClick={() => setShowForm(true)}>Schedule Meeting</Button>
      )}

      {isLoading ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Loading meetings...</p>
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">
            {selectedPair
              ? "No meetings scheduled yet."
              : "Select a pair to view meetings."}
          </p>
        </div>
      ) : (
        <>
          {/* Upcoming Meetings */}
          {upcoming.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">Upcoming Meetings</h3>
              <div className="grid gap-4">
                {upcoming.map((meeting) => (
                  <Card key={meeting.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-foreground truncate">
                          {meeting.title}
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatDateTime(meeting.scheduled_at)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Duration: {meeting.duration_minutes} minutes
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge
                            variant={
                              meeting.platform === "google_meet"
                                ? "primary"
                                : "muted"
                            }
                          >
                            {meeting.platform === "google_meet"
                              ? "Google Meet"
                              : "Zoom"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        {meeting.meeting_link ? (
                          <Link href={meeting.meeting_link} target="_blank">
                            <Button size="sm" variant="primary">
                              Join Meeting
                            </Button>
                          </Link>
                        ) : meeting.calendar_sync_status === "failed" ? (
                          <Badge variant="error">
                            Link unavailable — calendar invite failed
                          </Badge>
                        ) : meeting.calendar_sync_status === "none" ? (
                          <Badge variant="muted">
                            No calendar connected
                          </Badge>
                        ) : null}

                        {(isMentor || isAdmin) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleDeleteMeeting(meeting.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          {upcoming.length > 0 && past.length > 0 && (
            <div className="border-t border-border"></div>
          )}

          {/* Past Meetings */}
          {past.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">Past Meetings</h3>
              <div className="space-y-2">
                {past.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/30"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {meeting.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(meeting.scheduled_at)}
                      </p>
                    </div>
                    {(isMentor || isAdmin) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDeleteMeeting(meeting.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
