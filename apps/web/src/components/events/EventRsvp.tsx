"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { RsvpStatus } from "@/types/database";
import { trackBehavioralEvent } from "@/lib/analytics/events";

interface EventRsvpProps {
  eventId: string;
  organizationId: string;
  userId: string;
  initialStatus?: RsvpStatus | null;
}

const statusConfig: Record<RsvpStatus, { label: string; icon: string; activeClass: string }> = {
  attending: {
    label: "Attending",
    icon: "check",
    activeClass: "bg-green-600 text-white border-green-600",
  },
  maybe: {
    label: "Maybe",
    icon: "question",
    activeClass: "bg-yellow-500 text-white border-yellow-500",
  },
  not_attending: {
    label: "Not Attending",
    icon: "x",
    activeClass: "bg-gray-500 text-white border-gray-500",
  },
};

export function EventRsvp({ eventId, organizationId, userId, initialStatus }: EventRsvpProps) {
  const [status, setStatus] = useState<RsvpStatus | null>(initialStatus ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const handleRsvp = async (newStatus: RsvpStatus) => {
    if (saving) return;

    const previousStatus = status;
    setStatus(newStatus);
    setSaving(true);
    setError(null);

    const { error: upsertError } = await supabase
      .from("event_rsvps")
      .upsert({
        event_id: eventId,
        user_id: userId,
        organization_id: organizationId,
        status: newStatus,
      }, {
        onConflict: "event_id,user_id",
      });

    if (upsertError) {
      setStatus(previousStatus);
      setError("Failed to save RSVP");
      console.error("RSVP error:", upsertError);
      trackBehavioralEvent("rsvp_update", {
        event_id: eventId,
        rsvp_status: newStatus === "attending" ? "going" : newStatus === "maybe" ? "maybe" : "not_going",
      }, organizationId);
    } else {
      trackBehavioralEvent("rsvp_update", {
        event_id: eventId,
        rsvp_status: newStatus === "attending" ? "going" : newStatus === "maybe" ? "maybe" : "not_going",
      }, organizationId);
      router.refresh();
    }

    setSaving(false);
  };

  const statuses: RsvpStatus[] = ["attending", "maybe", "not_attending"];

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Your RSVP</p>
      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => {
          const config = statusConfig[s];
          const isActive = status === s;

          return (
            <button
              key={s}
              onClick={() => handleRsvp(s)}
              disabled={saving}
              className={`
                px-4 py-2 text-sm font-medium rounded-xl border-2 transition-all duration-200
                ${isActive
                  ? config.activeClass
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                }
                ${saving ? "opacity-50 cursor-not-allowed" : ""}
              `}
            >
              <span className="flex items-center gap-2">
                {config.icon === "check" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {config.icon === "question" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {config.icon === "x" && (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {config.label}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
