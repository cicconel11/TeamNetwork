"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Textarea } from "@/components/ui";
import { labelMatchSignal, pickSignalCode } from "@/lib/mentorship/signals";

export interface ProposalSignal {
  code: string;
  weight: number;
  value?: string | number;
}

export interface ProposalRow {
  id: string;
  status: string;
  mentor_user_id: string;
  mentee_user_id: string;
  proposed_at: string | null;
  declined_reason: string | null;
  match_score: number | null;
  match_signals: ProposalSignal[];
}

interface MentorshipProposalsTabProps {
  orgId: string;
  orgSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  proposals: ProposalRow[];
  userMap: Record<string, string>;
  adminPendingCount?: number;
}

export function MentorshipProposalsTab({
  orgId,
  orgSlug,
  currentUserId,
  isAdmin,
  proposals,
  userMap,
  adminPendingCount = 0,
}: MentorshipProposalsTabProps) {
  const t = useTranslations("mentorship");
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");

  const outgoing = proposals.filter((p) => p.mentee_user_id === currentUserId);
  const incoming = proposals.filter((p) => p.mentor_user_id === currentUserId);

  const act = async (pairId: string, action: "accept" | "decline", reason?: string) => {
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
        toast.error(err.error || t("actionFailed"));
        return;
      }
      toast.success(action === "accept" ? t("proposalAccepted") : t("proposalDeclined"));
      setReasonFor(null);
      setReasonText("");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const statusLabel = (status: string): string => {
    try {
      return t(`status_${status}`);
    } catch {
      return status;
    }
  };

  const signalLabel = (code: string | null): string => labelMatchSignal(code, t);

  const renderSignalChips = (signals: ProposalSignal[], testid: string) => {
    if (signals.length === 0) return null;
    return (
      <ul
        data-testid={testid}
        className="flex flex-wrap gap-1 mt-1.5"
      >
        {signals.slice(0, 5).map((s, idx) => {
          const code = pickSignalCode(s);
          return (
            <li
              key={`${code ?? "signal"}-${idx}`}
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-[var(--muted)]/40 text-[var(--muted-foreground)]"
            >
              {signalLabel(code)}
              {s.value !== undefined && (
                <span className="ml-1">· {String(s.value)}</span>
              )}
              {typeof s.weight === "number" && (
                <span className="ml-1 text-[var(--muted-foreground)]/70">
                  +{s.weight}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const badgeForStatus = (status: string) => {
    const variant: "success" | "warning" | "muted" =
      status === "accepted"
        ? "success"
        : status === "declined" || status === "expired"
        ? "warning"
        : "muted";
    return <Badge variant={variant}>{statusLabel(status)}</Badge>;
  };

  const adminQueueLink = (
    <Link
      href={`/${orgSlug}/mentorship/admin/matches`}
      className="inline-flex items-center text-sm font-medium underline-offset-2 hover:underline"
      data-testid="admin-match-queue-link"
    >
      {t("openMatchQueueLink", { count: adminPendingCount })}
    </Link>
  );

  if (proposals.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title={t("noProposals")}
          description={t("noProposalsDesc")}
        />
        {isAdmin && adminPendingCount > 0 && (
          <div className="text-center">{adminQueueLink}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {incoming.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
            {t("incomingProposals")}
          </h3>
          <ul className="space-y-3">
            {incoming.map((p) => (
              <li
                key={p.id}
                data-testid={`incoming-proposal-${p.id}`}
                data-pair-status={p.status}
                className="border border-[var(--border)] rounded-md p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {userMap[p.mentee_user_id] ?? t("unknownUser")}
                    </p>
                    {p.match_score !== null && (
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {t("matchScore", { score: p.match_score })}
                      </p>
                    )}
                  </div>
                  {badgeForStatus(p.status)}
                </div>
                {renderSignalChips(p.match_signals, `incoming-signals-${p.id}`)}
                {p.status === "proposed" && (
                  <div className="mt-3 space-y-2">
                    {reasonFor === p.id ? (
                      <>
                        <Textarea
                          value={reasonText}
                          onChange={(e) => setReasonText(e.target.value)}
                          placeholder={t("declineReasonPlaceholder")}
                          rows={2}
                          data-testid={`proposal-decline-reason-${p.id}`}
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReasonFor(null);
                              setReasonText("");
                            }}
                          >
                            {t("cancel")}
                          </Button>
                          <Button
                            size="sm"
                            data-testid={`proposal-confirm-decline-${p.id}`}
                            onClick={() => act(p.id, "decline", reasonText.trim() || undefined)}
                            isLoading={busyId === p.id}
                          >
                            {t("confirmDecline")}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`proposal-decline-${p.id}`}
                          onClick={() => setReasonFor(p.id)}
                          disabled={busyId === p.id}
                        >
                          {t("decline")}
                        </Button>
                        <Button
                          size="sm"
                          data-testid={`proposal-accept-${p.id}`}
                          onClick={() => act(p.id, "accept")}
                          isLoading={busyId === p.id}
                        >
                          {t("accept")}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
            {t("outgoingProposals")}
          </h3>
          <ul className="space-y-3">
            {outgoing.map((p) => (
              <li
                key={p.id}
                data-testid={`outgoing-proposal-${p.id}`}
                data-pair-status={p.status}
                className="border border-[var(--border)] rounded-md p-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {userMap[p.mentor_user_id] ?? t("unknownUser")}
                  </p>
                  {p.match_score !== null && (
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {t("matchScore", { score: p.match_score })}
                    </p>
                  )}
                  {renderSignalChips(p.match_signals, `outgoing-signals-${p.id}`)}
                  {p.status === "declined" && p.declined_reason && (
                    <p className="text-xs text-[var(--muted-foreground)] mt-1">
                      {p.declined_reason}
                    </p>
                  )}
                </div>
                {badgeForStatus(p.status)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && adminPendingCount > 0 && (
        <div className="pt-2">{adminQueueLink}</div>
      )}
    </div>
  );
}
