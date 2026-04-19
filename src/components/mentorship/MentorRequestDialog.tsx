"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { labelMatchSignal, pickSignalCode } from "@/lib/mentorship/signals";
import type { MentorDetailData } from "./MentorDetailModal";

interface MatchSignal {
  code: string;
  weight: number;
  value?: string | number;
}

interface MentorRequestDialogProps {
  mentor: MentorDetailData | null;
  orgId: string;
  currentUserId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (mentorUserId?: string) => void;
}

export function MentorRequestDialog({
  mentor,
  orgId,
  currentUserId,
  isOpen,
  onClose,
  onSuccess,
}: MentorRequestDialogProps) {
  const t = useTranslations("mentorship");
  const [signals, setSignals] = useState<MatchSignal[] | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !mentor) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/organizations/${orgId}/mentorship/suggestions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mentee_user_id: currentUserId, limit: 50 }),
          }
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          matches: Array<{ mentorUserId: string; score: number; signals: MatchSignal[] }>;
        };
        if (cancelled) return;
        const match = json.matches.find((m) => m.mentorUserId === mentor.user_id);
        setSignals(match?.signals ?? []);
        setScore(match?.score ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, mentor, orgId, currentUserId]);

  if (!isOpen || !mentor) return null;

  const submit = async () => {
    if (!loading && score === null) {
      toast.error(t("noSignalsAvailable"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}/mentorship/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentor_user_id: mentor.user_id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t("requestFailed"));
        return;
      }
      toast.success(t("requestSent"));
      onSuccess(mentor.user_id);
      onClose();
    } catch {
      toast.error(t("requestFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="mentor-request-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--background)] rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold">
            {t("requestIntroTitle", { name: mentor.name })}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {t("whyThisMatch")}
          </p>
        </div>

        <div className="rounded-md border border-[var(--border)] p-3 text-sm">
          {loading ? (
            <p className="text-[var(--muted-foreground)]">{t("loadingSignals")}</p>
          ) : signals && signals.length > 0 ? (
            <ul className="space-y-1">
              {signals.map((s, idx) => {
                const code = pickSignalCode(s);
                const signalLabel = labelMatchSignal(code, t);
                return (
                <li key={`${code ?? "signal"}-${idx}`} className="flex justify-between">
                  <span className="text-[var(--foreground)]">
                    {signalLabel}
                    {s.value !== undefined && (
                      <span className="text-[var(--muted-foreground)]">
                        {" "}
                        · {String(s.value)}
                      </span>
                    )}
                  </span>
                  {typeof s.weight === "number" && (
                    <span className="text-[var(--muted-foreground)]">+{s.weight}</span>
                  )}
                </li>
                );
              })}
              {score !== null && (
                <li className="flex justify-between font-medium pt-1 border-t border-[var(--border)]">
                  <span>{t("totalScore")}</span>
                  <span>{score}</span>
                </li>
              )}
            </ul>
          ) : (
            <p className="text-[var(--muted-foreground)]">{t("noSignalsAvailable")}</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            data-testid="mentor-request-dialog-cancel"
            onClick={onClose}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            data-testid="mentor-request-dialog-send"
            onClick={submit}
            isLoading={submitting}
            disabled={submitting || (!loading && score === null)}
          >
            {t("sendRequest")}
          </Button>
        </div>
      </div>
    </div>
  );
}
