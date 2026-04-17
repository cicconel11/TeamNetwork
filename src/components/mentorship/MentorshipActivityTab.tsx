"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock, ExternalLink, MessageSquare, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui";
import { showFeedback } from "@/lib/feedback/show-feedback";
import { createClient } from "@/lib/supabase/client";
import { MentorshipPairPicker } from "./MentorshipPairPicker";
import { MentorshipTasksTab } from "./MentorshipTasksTab";
import { MentorshipScheduleMeetingForm } from "./MentorshipScheduleMeetingForm";

/* ─── Types ─── */

interface MentorshipTask {
  id: string;
  pair_id: string;
  title: string;
  description?: string | null;
  status: "todo" | "in_progress" | "done";
  due_date?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
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

interface MentorshipLog {
  id: string;
  pair_id: string;
  entry_date: string;
  notes: string | null;
  progress_metric: number | null;
  created_by: string;
}

interface MentorshipActivityTabProps {
  initialTasks: MentorshipTask[];
  initialUpcoming: MentorshipMeeting[];
  initialPast: MentorshipMeeting[];
  initialLogs: MentorshipLog[];
  pairs: Array<{ id: string; mentorUserId: string; mentorName: string; menteeName: string }>;
  initialPairId: string;
  isAdmin: boolean;
  canLogActivity: boolean;
  orgId: string;
  orgSlug: string;
  currentUserId: string;
  orgTimezone: string;
  userMap: Record<string, string>;
}

/* ─── Helpers ─── */

function formatDateTime(dateTimeStr: string, orgTimezone?: string): string {
  const date = new Date(dateTimeStr);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (orgTimezone) opts.timeZone = orgTimezone;
  return date.toLocaleDateString("en-US", opts);
}

function formatLogDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* Timeline item: unified type for past meetings + logs */
type TimelineItem =
  | { kind: "meeting"; date: Date; meeting: MentorshipMeeting }
  | { kind: "log"; date: Date; log: MentorshipLog };

function buildTimeline(pastMeetings: MentorshipMeeting[], logs: MentorshipLog[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...pastMeetings.map((m) => ({ kind: "meeting" as const, date: new Date(m.scheduled_at), meeting: m })),
    ...logs.map((l) => ({ kind: "log" as const, date: new Date(l.entry_date), log: l })),
  ];
  items.sort((a, b) => b.date.getTime() - a.date.getTime());
  return items;
}

/* ─── Component ─── */

export function MentorshipActivityTab({
  initialTasks,
  initialUpcoming,
  initialPast,
  initialLogs,
  pairs,
  initialPairId,
  isAdmin,
  canLogActivity,
  orgId,
  orgSlug,
  currentUserId,
  orgTimezone,
  userMap,
}: MentorshipActivityTabProps) {
  const tMentorship = useTranslations("mentorship");

  const [selectedPairId, setSelectedPairId] = useState(initialPairId);
  const [upcoming, setUpcoming] = useState<MentorshipMeeting[]>(initialUpcoming);
  const [past, setPast] = useState<MentorshipMeeting[]>(initialPast);
  const [logs, setLogs] = useState<MentorshipLog[]>(initialLogs);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logNotes, setLogNotes] = useState("");
  const [isSavingLog, setIsSavingLog] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  // Derive isMentor from the currently selected pair, not a global org check
  const isMentor = pairs.find((p) => p.id === selectedPairId)?.mentorUserId === currentUserId;

  // Filter data by selected pair
  const pairUpcoming = upcoming.filter((m) => m.pair_id === selectedPairId);
  const pairPast = past.filter((m) => m.pair_id === selectedPairId);
  const pairLogs = logs.filter((l) => l.pair_id === selectedPairId);

  // Build unified timeline of past meetings + logs
  const timeline = buildTimeline(pairPast, pairLogs);
  const visibleTimeline = showAllHistory ? timeline : timeline.slice(0, 8);

  // Fetch meetings when pair changes
  useEffect(() => {
    if (!selectedPairId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const fetchMeetings = async () => {
      setMeetingsLoading(true);
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/meetings?pairId=${selectedPairId}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if (res.ok) {
          const { upcoming: upData, past: pastData } = await res.json();
          if (controller.signal.aborted) return;
          setUpcoming(upData || []);
          setPast(pastData || []);
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          showFeedback("Failed to load meetings", "error");
        }
      } finally {
        if (!controller.signal.aborted) {
          setMeetingsLoading(false);
        }
      }
    };

    // Skip initial mount (server data already loaded), fetch on every subsequent pair change
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    fetchMeetings();

    return () => controller.abort();
  }, [selectedPairId, orgId]);

  function handlePairChange(newPairId: string) {
    setSelectedPairId(newPairId);
    setShowScheduleForm(false);
    setShowLogForm(false);
    setShowAllHistory(false);
  }

  function handleMeetingCreated(meeting: MentorshipMeeting) {
    setShowScheduleForm(false);
    setUpcoming((prev) => [meeting, ...prev]);
  }

  async function handleDeleteMeeting(meetingId: string) {
    if (!confirm("Delete this meeting?")) return;
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/meetings/${meetingId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error();
      setUpcoming((prev) => prev.filter((m) => m.id !== meetingId));
      setPast((prev) => prev.filter((m) => m.id !== meetingId));
      showFeedback("Meeting deleted", "success");
    } catch {
      showFeedback("Failed to delete meeting", "error");
    }
  }

  async function handleSaveLog(e: React.FormEvent) {
    e.preventDefault();
    if (!canLogActivity) {
      showFeedback("You do not have permission to log sessions", "error");
      setShowLogForm(false);
      return;
    }
    if (!logNotes.trim()) return;

    setIsSavingLog(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      showFeedback("You must be signed in", "error");
      setIsSavingLog(false);
      return;
    }

    const entryDate = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from("mentorship_logs").insert({
      organization_id: orgId,
      pair_id: selectedPairId,
      created_by: user.id,
      entry_date: entryDate,
      notes: logNotes.trim(),
      progress_metric: null,
    }).select("id, pair_id, entry_date, notes, progress_metric, created_by").single();

    if (error) {
      showFeedback("Failed to save log", "error");
      setIsSavingLog(false);
      return;
    }

    setLogs((prev) => [data, ...prev]);
    setLogNotes("");
    setShowLogForm(false);
    setIsSavingLog(false);
    showFeedback("Session logged", "success");
  }

  if (!selectedPairId && pairs.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--muted-foreground)]">
        <p>{tMentorship("noActivePair")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pair Picker */}
      {pairs.length > 1 && (
        <MentorshipPairPicker
          pairs={pairs}
          selectedPairId={selectedPairId}
          onPairChange={handlePairChange}
        />
      )}

      {/* ─── Tasks Section ─── */}
      <MentorshipTasksTab
        initialTasks={initialTasks}
        pairs={[{ id: selectedPairId, mentorName: "", menteeName: "" }]}
        initialPairId={selectedPairId}
        isMentor={isMentor}
        isAdmin={isAdmin}
        orgId={orgId}
        orgSlug={orgSlug}
        currentUserId={currentUserId}
      />

      {/* ─── Meetings & Sessions (unified) ─── */}
      <div className="overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pt-1 pb-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Meetings & Sessions</h3>
          <div className="flex items-center gap-3">
            {canLogActivity && !showLogForm && (
              <button
                onClick={() => setShowLogForm(true)}
                className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                + Log Session
              </button>
            )}
            {isMentor && !showScheduleForm && (
              <button
                onClick={() => setShowScheduleForm(true)}
                className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                + Schedule
              </button>
            )}
          </div>
        </div>

        {/* Schedule Meeting Form */}
        {showScheduleForm && (
          <div className="animate-fade-in">
            <MentorshipScheduleMeetingForm
              pairId={selectedPairId}
              orgId={orgId}
              orgSlug={orgSlug}
              orgTimezone={orgTimezone}
              onMeetingCreated={handleMeetingCreated}
              onCancel={() => setShowScheduleForm(false)}
            />
          </div>
        )}

        {/* Inline log form */}
        {canLogActivity && showLogForm && (
          <form
            onSubmit={handleSaveLog}
            className="flex items-center gap-3 px-4 py-2.5 bg-[var(--muted)]/5 rounded-md animate-fade-in"
          >
            <MessageSquare className="flex-shrink-0 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={logNotes}
              onChange={(e) => setLogNotes(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setShowLogForm(false)}
              placeholder="What did you work on?"
              autoFocus
              aria-label="Session notes"
              className="flex-1 min-w-0 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/60"
            />
            <Button type="submit" size="sm" disabled={isSavingLog} isLoading={isSavingLog}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setShowLogForm(false); setLogNotes(""); }}>
              Cancel
            </Button>
          </form>
        )}

        {meetingsLoading ? (
          <div className="flex items-center justify-center py-8 text-[var(--muted-foreground)]">
            <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full mr-2" />
            <span className="text-xs">Loading…</span>
          </div>
        ) : (
          <>
            {/* ── Upcoming meetings ── */}
            {pairUpcoming.length > 0 && (
              <div>
                <div className="px-4 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    Upcoming
                  </span>
                </div>
                <div className="stagger-children">
                  {pairUpcoming.map((meeting) => (
                    <div
                      key={meeting.id}
                      className="group flex items-center gap-3 px-4 py-2 rounded-md hover:bg-[var(--muted)]/40 transition-colors duration-150"
                    >
                      <span className="flex-shrink-0 text-[var(--muted-foreground)]">
                        <Video className="h-4 w-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-[var(--foreground)] truncate block">
                          {meeting.title}
                        </span>
                        <span className="text-xs text-[var(--muted-foreground)] flex items-center gap-1.5 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(meeting.scheduled_at, orgTimezone)}
                          <span className="opacity-60">·</span>
                          {meeting.duration_minutes}m
                          <span className="opacity-60">·</span>
                          {meeting.platform === "google_meet" ? "Meet" : "Zoom"}
                        </span>
                      </div>
                      {meeting.meeting_link && (
                        <Link
                          href={meeting.meeting_link}
                          target="_blank"
                          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)]/60 transition-colors"
                        >
                          Join <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                      {(isMentor || isAdmin) && (
                        <button
                          onClick={() => handleDeleteMeeting(meeting.id)}
                          aria-label="Delete meeting"
                          className="flex-shrink-0 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Past timeline (meetings + logs interleaved) ── */}
            {timeline.length > 0 && (
              <div>
                <div className="px-4 py-1.5 mt-4">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    History
                  </span>
                </div>
                <div className="stagger-children">
                  {visibleTimeline.map((item) => {
                    if (item.kind === "meeting") {
                      const m = item.meeting;
                      return (
                        <div
                          key={`m-${m.id}`}
                          className="group flex items-center gap-3 px-4 py-2 rounded-md hover:bg-[var(--muted)]/30 transition-colors duration-150"
                        >
                          <Video className="flex-shrink-0 h-3.5 w-3.5 text-[var(--muted-foreground)]/60" />
                          <span className="flex-1 text-sm text-[var(--foreground)]/80 truncate">{m.title}</span>
                          <span className="flex-shrink-0 text-xs text-[var(--muted-foreground)]">
                            {formatDateTime(m.scheduled_at, orgTimezone)}
                          </span>
                          {(isMentor || isAdmin) && (
                            <button
                              onClick={() => handleDeleteMeeting(m.id)}
                              aria-label="Delete meeting"
                              className="flex-shrink-0 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-[var(--muted-foreground)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      );
                    }

                    const l = item.log;
                    return (
                      <div
                        key={`l-${l.id}`}
                        className="flex items-start gap-3 px-4 py-2 rounded-md"
                      >
                        <MessageSquare className="flex-shrink-0 mt-0.5 h-3.5 w-3.5 text-[var(--muted-foreground)]/60" />
                        <div className="flex-1 min-w-0">
                          {l.notes && (
                            <p className="text-sm text-[var(--foreground)]/80 line-clamp-2">{l.notes}</p>
                          )}
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {formatLogDate(l.entry_date)}
                            {l.created_by && <> · {userMap[l.created_by] || "Unknown"}</>}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {timeline.length > 8 && (
                    <button
                      onClick={() => setShowAllHistory((v) => !v)}
                      className="w-full px-4 py-2 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/40 transition-colors"
                    >
                      {showAllHistory ? "Show less" : `Show all ${timeline.length} entries`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Empty state */}
            {pairUpcoming.length === 0 && timeline.length === 0 && !showScheduleForm && !showLogForm && (
              <div className="py-8 text-center">
                <p className="text-xs text-[var(--muted-foreground)]">No meetings or sessions yet</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
