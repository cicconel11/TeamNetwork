"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { deleteEventsInSeries, type DeleteEventScope } from "@/lib/events/recurring-operations";

interface RecurringEventDeleteButtonProps {
  eventId: string;
  organizationId: string;
  redirectTo: string;
}

export function RecurringEventDeleteButton({
  eventId,
  organizationId,
  redirectTo,
}: RecurringEventDeleteButtonProps) {
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (scope: DeleteEventScope) => {
    setIsDeleting(true);

    const supabase = createClient();
    const { deletedIds, error } = await deleteEventsInSeries(supabase, eventId, organizationId, scope);

    if (error) {
      console.error("Failed to delete events:", error);
      setIsDeleting(false);
      setShowDialog(false);
      return;
    }

    // Trigger calendar sync for all deleted events
    try {
      await Promise.allSettled(
        deletedIds.map((id) =>
          fetch("/api/calendar/event-sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId: id,
              organizationId,
              operation: "delete",
            }),
          })
        )
      );
    } catch (syncError) {
      console.error("Failed to trigger calendar sync:", syncError);
    }

    router.push(redirectTo);
    router.refresh();
  };

  return (
    <>
      <Button
        variant="danger"
        onClick={() => setShowDialog(true)}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete
      </Button>

      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-2xl p-6 max-w-sm mx-4 shadow-xl border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Recurring Event</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This event is part of a recurring series. How would you like to delete it?
            </p>

            <div className="space-y-3">
              <button
                onClick={() => handleDelete("this_only")}
                disabled={isDeleting}
                className="w-full text-left px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors text-sm"
              >
                <span className="font-medium text-foreground">Delete this event only</span>
                <p className="text-muted-foreground mt-0.5">Other events in the series will not be affected</p>
              </button>

              <button
                onClick={() => handleDelete("this_and_future")}
                disabled={isDeleting}
                className="w-full text-left px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors text-sm"
              >
                <span className="font-medium text-foreground">Delete this and future events</span>
                <p className="text-muted-foreground mt-0.5">Past events in the series will be preserved</p>
              </button>

              <button
                onClick={() => handleDelete("all_in_series")}
                disabled={isDeleting}
                className="w-full text-left px-4 py-3 rounded-xl border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm"
              >
                <span className="font-medium text-red-600 dark:text-red-400">Delete all events in series</span>
                <p className="text-muted-foreground mt-0.5">All events in this series will be deleted</p>
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="secondary"
                onClick={() => setShowDialog(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
