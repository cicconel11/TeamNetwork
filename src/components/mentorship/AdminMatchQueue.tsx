"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Select, Textarea } from "@/components/ui";
import { labelMatchSignal, pickSignalCode } from "@/lib/mentorship/signals";

interface QueueRow {
  id: string;
  status: string;
  mentor_user_id: string;
  mentee_user_id: string;
  proposed_at: string | null;
  match_score: number | null;
  match_signals: unknown;
  mentor_user: { id: string; name: string | null; email: string | null } | null;
  mentee_user: { id: string; name: string | null; email: string | null } | null;
  mentor: {
    topics: string[] | null;
    expertise_areas: string[] | null;
    bio: string | null;
    max_mentees: number | null;
    current_mentee_count: number | null;
    accepting_new: boolean | null;
  } | null;
  mentee_preferences: {
    goals: string | null;
    preferred_topics: string[] | null;
    preferred_industries: string[] | null;
    preferred_role_families: string[] | null;
    preferred_sports: string[] | null;
    preferred_positions: string[] | null;
    required_attributes: string[] | null;
    nice_to_have_attributes: string[] | null;
    time_availability: string | null;
    communication_prefs: string[] | null;
    geographic_pref: string | null;
  } | null;
}

interface AdminMatchQueueProps {
  orgId: string;
  orgSlug: string;
}

type Sort = "score" | "proposed_at" | "mentee_name";

export function AdminMatchQueue({ orgId, orgSlug }: AdminMatchQueueProps) {
  const tMentorship = useTranslations("mentorship");
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [sort, setSort] = useState<Sort>("score");
  const [runningRound, setRunningRound] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [remindingMentorId, setRemindingMentorId] = useState<string | null>(null);
  const [bulkReminding, setBulkReminding] = useState(false);
  const [recentlyRemindedMentors, setRecentlyRemindedMentors] = useState<Set<string>>(new Set());

  const safeT = (key: string, fallback: string) => {
    try {
      const v = tMentorship(key);
      return v || fallback;
    } catch {
      return fallback;
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/admin/queue?sort=${sort}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        setRows([]);
        return;
      }
      const json = (await res.json()) as { queue: QueueRow[] };
      setRows(json.queue);
    } catch {
      setRows([]);
    }
  }, [orgId, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const runMatchRound = async () => {
    setRunningRound(true);
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/admin/queue`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        created?: number;
        skipped_existing?: number;
        skipped_no_match?: number;
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error || safeT("actionFailed", "Action failed"));
        return;
      }
      toast.success(
        `${safeT("runMatchRound", "Run match round")}: ${json.created ?? 0} ${safeT("createdShort", "created")}, ${json.skipped_existing ?? 0} ${safeT("skippedExistingShort", "already paired")}, ${json.skipped_no_match ?? 0} ${safeT("skippedNoMatchShort", "no structured match")}`
      );
      await load();
      router.refresh();
    } finally {
      setRunningRound(false);
    }
  };

  type RemindResponse = {
    sent: Array<{ mentor_user_id: string; pending_count: number }>;
    skipped: Array<{ mentor_user_id: string; reason: string }>;
    error?: string;
  };

  const callRemind = async (payload: Record<string, unknown>): Promise<RemindResponse | null> => {
    const res = await fetch(
      `/api/organizations/${orgId}/mentorship/admin/remind`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = (await res.json().catch(() => ({}))) as RemindResponse;
    if (!res.ok) {
      toast.error(json.error || safeT("actionFailed", "Action failed"));
      return null;
    }
    return json;
  };

  const remindMentor = async (mentorUserId: string) => {
    setRemindingMentorId(mentorUserId);
    try {
      const json = await callRemind({ mentor_user_id: mentorUserId });
      if (!json) return;
      if (json.sent.length > 0) {
        setRecentlyRemindedMentors((prev) => new Set(prev).add(mentorUserId));
        toast.success(safeT("reminderSent", "Reminder sent"));
      } else if (json.skipped.some((s) => s.reason === "rate_limited")) {
        setRecentlyRemindedMentors((prev) => new Set(prev).add(mentorUserId));
        toast.info(safeT("reminderRateLimited", "Already reminded in last 24h"));
      } else {
        toast.info(safeT("reminderSkipped", "No reminder sent"));
      }
    } finally {
      setRemindingMentorId(null);
    }
  };

  const remindAll = async () => {
    setBulkReminding(true);
    try {
      const json = await callRemind({ min_pending: 1 });
      if (!json) return;
      const sentCount = json.sent.length;
      const rateCount = json.skipped.filter((s) => s.reason === "rate_limited").length;
      if (sentCount > 0) {
        setRecentlyRemindedMentors((prev) => {
          const next = new Set(prev);
          json.sent.forEach((s) => next.add(s.mentor_user_id));
          json.skipped.forEach((s) => {
            if (s.reason === "rate_limited") next.add(s.mentor_user_id);
          });
          return next;
        });
      }
      toast.success(
        `${safeT("remindersSent", "Reminders sent")}: ${sentCount}` +
          (rateCount > 0
            ? ` · ${rateCount} ${safeT("skippedRateLimited", "skipped (24h)")}`
            : "")
      );
    } finally {
      setBulkReminding(false);
    }
  };

  const act = async (
    pairId: string,
    action: "accept" | "decline" | "override_approve",
    reason?: string
  ) => {
    setBusyId(pairId);
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/mentorship/pairs/${pairId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || safeT("actionFailed", "Action failed"));
        return;
      }
      toast.success(
        action === "decline"
          ? safeT("proposalDeclined", "Proposal declined")
          : safeT("proposalAccepted", "Proposal accepted")
      );
      setDeclineFor(null);
      setDeclineReason("");
      await load();
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        {safeT("loadingQueue", "Loading queue…")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {safeT("queueCount", "Pending proposals")}: {rows.length}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={remindAll}
            isLoading={bulkReminding}
            disabled={rows.length === 0}
            data-testid="admin-remind-all-mentors"
          >
            {safeT("remindAllMentors", "Remind all mentors")}
          </Button>
          <Button
            size="sm"
            onClick={runMatchRound}
            isLoading={runningRound}
          >
            {safeT("runMatchRound", "Run match round")}
          </Button>
          <div className="w-48">
            <Select
              label={safeT("sortBy", "Sort by")}
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              options={[
                { value: "score", label: safeT("sortScore", "Match score") },
                { value: "proposed_at", label: safeT("sortProposedAt", "Newest") },
                { value: "mentee_name", label: safeT("sortMenteeName", "Mentee name") },
              ]}
            />
          </div>
        </div>
      </div>

      {rows.length === 0 && (
        <EmptyState
          title={safeT("noPendingProposals", "No pending proposals")}
          description={safeT(
            "noPendingProposalsDesc",
            "Mentee requests awaiting mentor response will appear here."
          )}
        />
      )}

      {rows.length > 0 && <ul className="space-y-3">
        {rows.map((row) => {
          const signals = Array.isArray(row.match_signals)
            ? (row.match_signals as Array<{ code: string; weight: number; value?: string | number }>)
            : [];
          const prefs = row.mentee_preferences;
          const prefsRows: Array<[string, string]> = prefs
            ? ([
                ["goals", prefs.goals ?? ""],
                ["preferred_topics", (prefs.preferred_topics ?? []).join(", ")],
                ["preferred_industries", (prefs.preferred_industries ?? []).join(", ")],
                ["preferred_role_families", (prefs.preferred_role_families ?? []).join(", ")],
                ["preferred_sports", (prefs.preferred_sports ?? []).join(", ")],
                ["preferred_positions", (prefs.preferred_positions ?? []).join(", ")],
                ["required_attributes", (prefs.required_attributes ?? []).join(", ")],
                ["nice_to_have_attributes", (prefs.nice_to_have_attributes ?? []).join(", ")],
                ["time_availability", prefs.time_availability ?? ""],
                ["communication_prefs", (prefs.communication_prefs ?? []).join(", ")],
                ["geographic_pref", prefs.geographic_pref ?? ""],
              ] as Array<[string, string]>).filter(([, v]) => v.length > 0)
            : [];
          return (
            <li
              key={row.id}
              className="border border-[var(--border)] rounded-md p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {row.mentee_user?.name ?? row.mentee_user?.email ?? safeT("unknownUser", "Unknown")}
                    <span className="text-[var(--muted-foreground)] font-normal"> → </span>
                    {row.mentor_user?.name ?? row.mentor_user?.email ?? safeT("unknownUser", "Unknown")}
                  </p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {row.proposed_at
                      ? new Date(row.proposed_at).toLocaleString()
                      : ""}
                    {row.match_score !== null && (
                      <>
                        {" · "}
                        {safeT("matchScoreLabel", "Score")}: {row.match_score}
                      </>
                    )}
                  </p>
                </div>
                <Badge variant="muted">{safeT("status_proposed", "Proposed")}</Badge>
              </div>

              {signals.length > 0 && (
                <ul className="text-xs space-y-0.5">
                  {signals.slice(0, 5).map((s, idx) => {
                    const code = pickSignalCode(s);
                    const label = labelMatchSignal(code, tMentorship);
                    return (
                      <li key={`${code ?? "signal"}-${idx}`} className="flex justify-between">
                        <span className="text-[var(--foreground)]/80">
                          {label}
                          {s.value !== undefined && (
                            <span className="text-[var(--muted-foreground)]"> · {String(s.value)}</span>
                          )}
                        </span>
                        {typeof s.weight === "number" && (
                          <span className="text-[var(--muted-foreground)]">+{s.weight}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {prefsRows.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-[var(--muted-foreground)]">
                    {safeT("viewMenteePreferences", "View mentee preferences")}
                  </summary>
                  <dl className="mt-2 p-2 bg-[var(--muted)]/30 rounded text-[11px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    {prefsRows.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-[var(--muted-foreground)]">{k}</dt>
                        <dd className="text-[var(--foreground)]/90 break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}

              {row.mentor && (
                <div className="text-xs text-[var(--muted-foreground)]">
                  {safeT("mentorCapacity", "Mentor capacity")}:{" "}
                  {row.mentor.current_mentee_count ?? 0} / {row.mentor.max_mentees ?? 0}
                  {!row.mentor.accepting_new && (
                    <span className="ml-2 text-[var(--foreground)]">
                      · {safeT("notAcceptingShort", "Not accepting")}
                    </span>
                  )}
                </div>
              )}

              {declineFor === row.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder={safeT("declineReasonPlaceholder", "Optional reason")}
                    rows={2}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeclineFor(null);
                        setDeclineReason("");
                      }}
                    >
                      {safeT("cancel", "Cancel")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => act(row.id, "decline", declineReason.trim() || undefined)}
                      isLoading={busyId === row.id}
                    >
                      {safeT("confirmDecline", "Decline")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  {row.status === "proposed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => remindMentor(row.mentor_user_id)}
                      isLoading={remindingMentorId === row.mentor_user_id}
                      disabled={recentlyRemindedMentors.has(row.mentor_user_id)}
                      data-testid={`admin-remind-mentor-${row.mentor_user_id}`}
                      title={
                        recentlyRemindedMentors.has(row.mentor_user_id)
                          ? safeT("reminderRateLimited", "Already reminded in last 24h")
                          : undefined
                      }
                    >
                      {safeT("remindMentor", "Remind mentor")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeclineFor(row.id)}
                    disabled={busyId === row.id}
                  >
                    {safeT("decline", "Decline")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => act(row.id, "override_approve")}
                    isLoading={busyId === row.id}
                    variant="primary"
                  >
                    {safeT("overrideApprove", "Approve (override)")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>}

      <p className="text-xs text-[var(--muted-foreground)] pt-2">
        <a href={`/${orgSlug}/mentorship`} className="hover:underline">
          ← {safeT("backToMentorship", "Back to mentorship")}
        </a>
      </p>
    </div>
  );
}
