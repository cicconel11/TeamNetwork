"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import {
  reportContent,
  toggleBlock,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/moderation";

const REASONS: ReadonlyArray<{
  id: ReportReason;
  label: string;
  description: string;
}> = [
  { id: "spam", label: "Spam", description: "Unwanted commercial or repetitive content" },
  { id: "harassment", label: "Harassment or bullying", description: "Targeted attacks or insults" },
  { id: "hate", label: "Hate speech", description: "Attacks based on identity" },
  { id: "sexual", label: "Sexual content", description: "Explicit or inappropriate sexual material" },
  { id: "violence", label: "Violence or threats", description: "Threats of harm" },
  { id: "self_harm", label: "Self-harm", description: "Encourages or depicts self-injury" },
  { id: "illegal", label: "Illegal activity", description: "Promotes unlawful behavior" },
  { id: "impersonation", label: "Impersonation", description: "Pretending to be someone else" },
  { id: "other", label: "Other", description: "Something else not listed" },
];

const MAX_DETAILS = 1000;

export interface ReportBlockMenuProps {
  orgId: string;
  targetType: ReportTargetType;
  targetId: string;
  /** Author of the content; required to enable the block action. */
  reportedUserId: string | null;
  /** Hide the block action (e.g. when blocking is not meaningful here). */
  hideBlock?: boolean;
  /** Called after a successful block toggle so the parent can refresh. */
  onBlocked?: () => void;
  /** Optional extra classes for the trigger button. */
  className?: string;
}

/**
 * Kebab menu giving members a way to report content and block its author —
 * the web counterpart of the mobile ReportBlockSheet. Satisfies Apple
 * Guideline 1.2 (report + block affordances on user-generated content).
 */
export function ReportBlockMenu({
  orgId,
  targetType,
  targetId,
  reportedUserId,
  hideBlock = false,
  onBlocked,
  className = "",
}: ReportBlockMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const canBlock = !hideBlock && !!reportedUserId;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Report or block"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`rounded-lg p-1.5 text-muted-foreground/40 transition-all hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50"
          >
            Report
          </button>
          {canBlock && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setBlockOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-error hover:bg-error/10"
            >
              Block user
            </button>
          )}
        </div>
      )}

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        orgId={orgId}
        targetType={targetType}
        targetId={targetId}
        reportedUserId={reportedUserId}
      />

      {canBlock && (
        <BlockConfirm
          open={blockOpen}
          onOpenChange={setBlockOpen}
          blockedUserId={reportedUserId}
          onBlocked={onBlocked}
        />
      )}
    </div>
  );
}

function ReportDialog({
  open,
  onOpenChange,
  orgId,
  targetType,
  targetId,
  reportedUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  targetType: ReportTargetType;
  targetId: string;
  reportedUserId: string | null;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setReason(null);
    setDetails("");
    setSubmitting(false);
  }

  async function submit() {
    if (!reason) return;
    setSubmitting(true);
    try {
      await reportContent({
        orgId,
        targetType,
        targetId,
        reportedUserId,
        reason,
        details: details.trim() || null,
      });
      toast.success("Reported. Thanks for letting us know.");
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not file report");
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl focus:outline-none">
          <Dialog.Title className="text-lg font-semibold">Why are you reporting this?</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Pick the reason that fits best. Reports are reviewed within 24 hours.
          </Dialog.Description>

          <div className="mt-4 flex-1 space-y-1 overflow-y-auto">
            {REASONS.map((r) => (
              <label
                key={r.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  reason === r.id
                    ? "border-org-secondary bg-muted/60"
                    : "border-transparent hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="report-reason"
                  className="mt-1"
                  checked={reason === r.id}
                  onChange={() => setReason(r.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.description}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3">
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, MAX_DETAILS))}
              placeholder="Add details (optional)"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {MAX_DETAILS - details.length} characters left
            </p>
          </div>

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary" disabled={submitting}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant="primary"
              isLoading={submitting}
              disabled={!reason}
              onClick={submit}
            >
              Submit report
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BlockConfirm({
  open,
  onOpenChange,
  blockedUserId,
  onBlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockedUserId: string;
  onBlocked?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setSubmitting(true);
    try {
      await toggleBlock(blockedUserId);
      toast.success("Blocked. You won't see each other's content.");
      onOpenChange(false);
      onBlocked?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not block user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={(next) => !submitting && onOpenChange(next)}
      onConfirm={confirm}
      isPending={submitting}
      title="Block this user?"
      description="You won't see their messages, posts, or comments, and they won't see yours either. You can unblock them anytime from Settings."
      confirmLabel="Block"
      cancelLabel="Cancel"
      destructive
    />
  );
}
