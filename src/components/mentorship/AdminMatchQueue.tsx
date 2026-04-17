"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Select, Textarea } from "@/components/ui";

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
  mentee_intake: Record<string, unknown> | null;
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
          const intake = row.mentee_intake as Record<string, unknown> | null;
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
                    let label = s.code;
                    try {
                      label = tMentorship(`signal.${s.code}`);
                    } catch { /* fall back */ }
                    return (
                      <li key={`${s.code}-${idx}`} className="flex justify-between">
                        <span className="text-[var(--foreground)]/80">
                          {label}
                          {s.value !== undefined && (
                            <span className="text-[var(--muted-foreground)]"> · {String(s.value)}</span>
                          )}
                        </span>
                        <span className="text-[var(--muted-foreground)]">+{s.weight}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {intake && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-[var(--muted-foreground)]">
                    {safeT("viewMenteeIntake", "View mentee intake")}
                  </summary>
                  <pre className="mt-2 p-2 bg-[var(--muted)]/30 rounded overflow-x-auto text-[11px]">
                    {JSON.stringify(intake, null, 2)}
                  </pre>
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
