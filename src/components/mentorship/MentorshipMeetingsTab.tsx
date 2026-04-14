"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui";
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
  orgTimezone: string;
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
  orgTimezone,
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
        <div className="pb-2">
          <MentorshipPairPicker
            pairs={pairs}
            selectedPairId={selectedPairId}
            onPairChange={handlePairChange}
          />
        </div>
      )}

      {/* Schedule Meeting Form */}
      {isMentor && (
        <div>
          {showForm ? (
            <div className="animate-fade-in">
              <MentorshipScheduleMeetingForm
                pairId={selectedPairId}
                orgId={orgId}
                orgSlug={orgSlug}
                orgTimezone={orgTimezone}
                onMeetingCreated={handleMeetingCreated}
                onCancel={() => setShowForm(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              + Schedule
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading meetings...</p>
        </div>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">
            {selectedPair
              ? "No meetings scheduled yet"
              : "Select a pair to view meetings"}
          </p>
        </div>
      ) : (
        <>
          {/* Upcoming Meetings */}
          {upcoming.length > 0 && (
            <div className="animate-fade-in">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-2">Upcoming</h3>
              <div>
                {upcoming.map((meeting) => (
                  <div key={meeting.id} className="group flex items-center gap-3 py-2.5 border-b border-[var(--border)]/20 last:border-b-0 hover:bg-[var(--muted)]/40 transition-colors duration-150">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate block">
                        {meeting.title}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <Calendar className="h-3 w-3" />
                        {formatDateTime(meeting.scheduled_at, orgTimezone)}
                        <span className="opacity-60">·</span>
                        <Clock className="h-3 w-3" />
                        {meeting.duration_minutes}m
                        <span className="opacity-60">·</span>
                        <span className="text-[var(--muted-foreground)]">
                          {meeting.platform === "google_meet" ? "Meet" : "Zoom"}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {meeting.meeting_link ? (
                        <Link href={meeting.meeting_link} target="_blank">
                          <Button size="sm" variant="secondary">
                            Join
                          </Button>
                        </Link>
                      ) : meeting.calendar_sync_status === "failed" ? (
                        <span className="text-xs text-[var(--muted-foreground)]">Link unavailable</span>
                      ) : null}
                      {(isMentor || isAdmin) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteMeeting(meeting.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Past Meetings */}
          {past.length > 0 && (
            <div className="animate-fade-in mt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-2">History</h3>
              <div>
                {past.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="group flex items-center gap-3 py-2 border-b border-[var(--border)]/20 last:border-b-0 hover:bg-[var(--muted)]/30 transition-colors duration-150"
                  >
                    <span className="flex-1 text-sm text-foreground/80 truncate">{meeting.title}</span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(meeting.scheduled_at, orgTimezone)}
                    </span>
                    {(isMentor || isAdmin) && (
                      <Button
                        size="sm"
                        variant="ghost"
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
