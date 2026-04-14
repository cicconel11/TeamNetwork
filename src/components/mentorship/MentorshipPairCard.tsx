"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { MentorshipLogForm } from "./MentorshipLogForm";
import { getMentorshipStatusTranslationKey } from "@/lib/mentorship/presentation";

interface MentorshipLog {
  id: string;
  entry_date: string;
  notes: string | null;
  progress_metric: number | null;
  created_by: string;
}

interface MentorshipPairCardProps {
  pair: {
    id: string;
    mentor_user_id: string;
    mentee_user_id: string;
    status: string;
  };
  mentorLabel: string;
  menteeLabel: string;
  logs: MentorshipLog[];
  isAdmin: boolean;
  canLogActivity: boolean;
  orgId: string;
  userLabel: (id: string) => string;
  onDelete?: (pairId: string) => void;
  highlight?: boolean;
}

export function MentorshipPairCard({
  pair,
  mentorLabel,
  menteeLabel,
  logs,
  isAdmin,
  canLogActivity,
  orgId,
  userLabel,
  onDelete,
  highlight = false,
}: MentorshipPairCardProps) {
  const router = useRouter();
  const tMentorship = useTranslations("mentorship");
  const tCommon = useTranslations("common");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);

  const handleDeleteClick = () => {
    setShowMenu(false);
    setShowConfirm(true);
    setError(null);
  };

  const handleCancelDelete = () => {
    setShowConfirm(false);
    setError(null);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setError(null);

    const supabase = createClient();
    if (!supabase) {
      setError("Unable to connect to database. Please try again.");
      setIsDeleting(false);
      return;
    }

    // Soft-delete associated mentorship_logs first
    const { error: logsError } = await supabase
      .from("mentorship_logs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("pair_id", pair.id)
      .is("deleted_at", null);

    if (logsError) {
      setError("Unable to delete mentorship pair. Please try again.");
      setIsDeleting(false);
      return;
    }

    // Soft-delete the mentorship_pair record
    const { error: pairError } = await supabase
      .from("mentorship_pairs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", pair.id)
      .is("deleted_at", null);

    if (pairError) {
      setError("Unable to delete mentorship pair. Please try again.");
      setIsDeleting(false);
      return;
    }

    // Update UI state after successful deletion
    setIsDeleted(true);
    setShowConfirm(false);
    setIsDeleting(false);
    onDelete?.(pair.id);
  };

  // Don't render if deleted
  if (isDeleted) {
    return null;
  }

  const visibleLogs = showAllLogs ? logs : logs.slice(0, 5);
  const hasMoreLogs = logs.length > 5;
  const lastLogDate =
    logs.length > 0 ? new Date(logs[0].entry_date).toLocaleDateString() : null;

  const statusLabel = tMentorship(getMentorshipStatusTranslationKey(pair.status));

  return (
    <div className={`py-4 space-y-3${highlight ? " bg-[var(--muted)]/10" : ""}`}>
      {/* Row 1: mentor → mentee header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h3 className="font-semibold text-foreground truncate">
            {mentorLabel}
          </h3>
          <span aria-hidden="true" className="text-muted-foreground">
            →
          </span>
          <h3 className="font-semibold text-foreground truncate">
            {menteeLabel}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-medium text-[var(--muted-foreground)]">{statusLabel}</span>
          {isAdmin && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMenu((v) => !v)}
                onBlur={() => setTimeout(() => setShowMenu(false), 150)}
                disabled={isDeleting || showConfirm}
                aria-label={tMentorship("openPairMenu")}
                aria-haspopup="menu"
                aria-expanded={showMenu}
                className="h-8 w-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6v.01M12 12v.01M12 18v.01"
                  />
                </svg>
              </button>
              {showMenu && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 min-w-[10rem] rounded-md border border-[var(--border)]/20 bg-[var(--background)] shadow-sm z-10 py-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => {
                      // onMouseDown fires before the parent button's onBlur,
                      // so we avoid the blur race swallowing the click.
                      e.preventDefault();
                      handleDeleteClick();
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    {tMentorship("archivePair")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: last activity + log count */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          {lastLogDate
            ? `${tMentorship("lastSession")}: ${lastLogDate}`
            : tMentorship("noSessionsYet")}
        </span>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-border" />
        <span className="text-xs text-[var(--muted-foreground)]">
          {logs.length}{" "}
          {logs.length === 1
            ? tMentorship("sessionSingular")
            : tMentorship("sessionPlural")}
        </span>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="py-3 space-y-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            {tMentorship("archivePairConfirm")}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmDelete}
              isLoading={isDeleting}
            >
              {tMentorship("archivePair")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelDelete}
              disabled={isDeleting}
            >
              {tCommon("cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Activity logs */}
      {logs.length > 0 && (
        <div>
          {visibleLogs.map((log) => (
            <div key={log.id} className="py-2 space-y-1">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{new Date(log.entry_date).toLocaleDateString()}</span>
                <span>
                  {tMentorship("loggedBy", { name: userLabel(log.created_by) })}
                </span>
              </div>
              {log.notes && <p className="text-foreground">{log.notes}</p>}
              {log.progress_metric !== null && (
                <p className="text-xs text-muted-foreground">
                  {tMentorship("progressMetric", { value: log.progress_metric })}
                </p>
              )}
            </div>
          ))}
          {hasMoreLogs && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllLogs((v) => !v)}
            >
              {showAllLogs
                ? tMentorship("hideLogs")
                : tMentorship("showAllLogs", { count: logs.length })}
            </Button>
          )}
        </div>
      )}

      {/* Collapsible log form */}
      {canLogActivity && (
        <div className="pt-3 mt-1">
          {showLogForm ? (
            <div className="space-y-2">
              <MentorshipLogForm orgId={orgId} pairId={pair.id} onLogCreated={() => router.refresh()} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowLogForm(false)}
              >
                {tCommon("cancel")}
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setShowLogForm(true)}
              className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              + {tMentorship("logSession")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
