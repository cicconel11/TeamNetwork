"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface UseEventRealtimeOptions {
  organizationId: string;
  /**
   * Optional override. Defaults to `router.refresh()` so server-rendered
   * event lists pick up upstream changes (start_date moves, RSVP-driven
   * "happening now" transitions) without a hard reload.
   */
  onChange?: () => void;
}

/**
 * Subscribe a web view to changes on `events` and `event_rsvps` for an org.
 * Mirrors the chat realtime pattern but is concerned only with cache
 * invalidation, not with reconciling local optimistic state.
 */
export function useEventRealtime({
  organizationId,
  onChange,
}: UseEventRealtimeOptions): void {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const handler = onChange ?? (() => router.refresh());

    const channel = supabase
      .channel(`events:${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "events",
          filter: `organization_id=eq.${organizationId}`,
        },
        handler,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_rsvps",
          filter: `organization_id=eq.${organizationId}`,
        },
        handler,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, onChange, router]);
}
