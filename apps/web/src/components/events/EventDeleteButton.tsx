"use client";

import { SoftDeleteButton } from "@/components/ui";

interface EventDeleteButtonProps {
  eventId: string;
  organizationId: string;
  redirectTo: string;
}

/**
 * Event-specific delete button that triggers calendar sync after deletion.
 * Wraps SoftDeleteButton with calendar sync callback.
 * 
 * Requirements: 4.1 - Event deletion synchronization
 */
export function EventDeleteButton({
  eventId,
  organizationId,
  redirectTo,
}: EventDeleteButtonProps) {
  const handleAfterDelete = async () => {
    // Trigger Google Calendar sync for users with connected calendars (Requirement 4.1)
    try {
      await fetch("/api/calendar/event-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          organizationId,
          operation: "delete",
        }),
      });
    } catch (syncError) {
      // Calendar sync errors should not block event deletion
      console.error("Failed to trigger calendar sync:", syncError);
    }
  };

  return (
    <SoftDeleteButton
      table="events"
      id={eventId}
      organizationField="organization_id"
      organizationId={organizationId}
      redirectTo={redirectTo}
      onAfterDelete={handleAfterDelete}
    />
  );
}
