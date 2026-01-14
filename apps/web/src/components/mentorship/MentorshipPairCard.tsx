"use client";

import { useState } from "react";
import { Card, Badge, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { MentorshipLogForm } from "./MentorshipLogForm";

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
}: MentorshipPairCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleted, setIsDeleted] = useState(false);

  const handleDeleteClick = () => {
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

    // Delete associated mentorship_logs first (cascade)
    const { error: logsError } = await supabase
      .from("mentorship_logs")
      .delete()
      .eq("pair_id", pair.id);

    if (logsError) {
      setError("Unable to delete mentorship pair. Please try again.");
      setIsDeleting(false);
      return;
    }

    // Delete the mentorship_pair record
    const { error: pairError } = await supabase
      .from("mentorship_pairs")
      .delete()
      .eq("id", pair.id);

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

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">{mentorLabel}</h3>
          <p className="text-sm text-muted-foreground">Mentor</p>
        </div>
        <div className="text-center flex items-center gap-2">
          <Badge variant="primary">{pair.status}</Badge>
          {isAdmin && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteClick}
              disabled={isDeleting || showConfirm}
              aria-label="Delete mentorship pair"
            >
              Delete
            </Button>
          )}
        </div>
        <div className="text-right">
          <h3 className="font-semibold text-foreground">{menteeLabel}</h3>
          <p className="text-sm text-muted-foreground">Mentee</p>
        </div>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 space-y-3">
          <p className="text-sm text-red-700 dark:text-red-300">
            Are you sure you want to delete this mentorship pair? This will also remove all associated activity logs. This action cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmDelete}
              isLoading={isDeleting}
            >
              Yes, Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelDelete}
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {logs.length > 0 ? (
        <div className="space-y-3">
          {logs.slice(0, 5).map((log) => (
            <div key={log.id} className="p-3 rounded-xl bg-muted/50 space-y-1">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{new Date(log.entry_date).toLocaleDateString()}</span>
                <span>by {userLabel(log.created_by)}</span>
              </div>
              {log.notes && <p className="text-foreground">{log.notes}</p>}
              {log.progress_metric !== null && (
                <p className="text-xs text-muted-foreground">Progress: {log.progress_metric}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No activity logged yet.</p>
      )}

      {canLogActivity && (
        <div className="pt-2 border-t border-border">
          <MentorshipLogForm orgId={orgId} pairId={pair.id} />
        </div>
      )}
    </Card>
  );
}
