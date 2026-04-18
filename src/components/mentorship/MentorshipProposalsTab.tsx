"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Textarea } from "@/components/ui";

export interface ProposalRow {
  id: string;
  status: string;
  mentor_user_id: string;
  mentee_user_id: string;
  proposed_at: string | null;
  declined_reason: string | null;
  match_score: number | null;
}

interface MentorshipProposalsTabProps {
  orgId: string;
  currentUserId: string;
  isAdmin: boolean;
  proposals: ProposalRow[];
  userMap: Record<string, string>;
}

export function MentorshipProposalsTab({
  orgId,
  currentUserId,
  isAdmin,
  proposals,
  userMap,
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

  const badgeForStatus = (status: string) => {
    const variant: "success" | "warning" | "muted" =
      status === "accepted"
        ? "success"
        : status === "declined" || status === "expired"
        ? "warning"
        : "muted";
    return <Badge variant={variant}>{statusLabel(status)}</Badge>;
  };

  if (proposals.length === 0) {
    return (
      <EmptyState
        title={t("noProposals")}
        description={t("noProposalsDesc")}
      />
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
                <div>
                  <p className="text-sm font-medium">
                    {userMap[p.mentor_user_id] ?? t("unknownUser")}
                  </p>
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

      {isAdmin && proposals.length > 0 && outgoing.length === 0 && incoming.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">{t("adminSeeAdminQueue")}</p>
      )}
    </div>
  );
}
