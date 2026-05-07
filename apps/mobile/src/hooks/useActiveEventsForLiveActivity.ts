import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import * as sentry from "@/lib/analytics/sentry";

const STALE_TIME_MS = 30_000;
/**
 * Window after `end_date` during which we keep the LA running. Mirrors the LA
 * "stale" grace period — the lock-screen card should hang around for a few
 * minutes after the event nominally ends so attendees can still see the
 * checked-in tally as they're walking out.
 */
const POST_EVENT_GRACE_MINUTES = 30;

export interface ActiveEventForLiveActivity {
  eventId: string;
  organizationId: string;
  orgSlug: string;
  orgName: string;
  eventTitle: string;
  startDate: string;
  endDate: string | null;
  /** True if *this* user is already checked in for this event. */
  isCheckedIn: boolean;
  /** Latest counts as of last fetch. */
  checkedInCount: number;
  totalAttending: number;
}

interface UseActiveEventsForLiveActivityReturn {
  events: ActiveEventForLiveActivity[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Returns the set of events the current user should have a Live Activity
 * running for: events where the user RSVP'd `attending` AND the event is
 * currently within `[start_date, end_date + 30m]`.
 *
 * Uses the same `useRequestTracker` + `isMountedRef` pattern as `useEvents`
 * so a delayed network response from a stale render can't overwrite fresher
 * state from a subsequent fetch.
 */
export function useActiveEventsForLiveActivity(
  userId: string | null,
): UseActiveEventsForLiveActivityReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const { beginRequest, isCurrentRequest } = useRequestTracker();

  const [events, setEvents] = useState<ActiveEventForLiveActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActive = useCallback(async () => {
    const requestId = beginRequest();
    if (!userId) {
      if (isMountedRef.current) {
        setEvents([]);
        setLoading(false);
        setError(null);
      }
      return;
    }

    try {
      setLoading(true);

      const now = new Date();
      const lower = new Date(
        now.getTime() - POST_EVENT_GRACE_MINUTES * 60 * 1000,
      ).toISOString();
      const upper = now.toISOString();

      // 1. Find every event_rsvps row for this user where status='attending'
      // and the event window overlaps `now`. We do the join in JS so we can
      // reuse the events table types we already have; the alternative is a
      // SECURITY DEFINER RPC, which is overkill for a 1-page query.
      const { data: rsvpRows, error: rsvpError } = await supabase
        .from("event_rsvps")
        .select(
          "event_id, status, checked_in_at, events:events!inner(id, organization_id, title, start_date, end_date, organizations:organizations!inner(slug, name))",
        )
        .eq("user_id", userId)
        .eq("status", "attending")
        .lte("events.start_date", upper)
        .gte("events.end_date", lower);

      if (rsvpError) throw rsvpError;
      if (!isCurrentRequest(requestId)) return;

      type Row = {
        event_id: string;
        checked_in_at: string | null;
        events: {
          id: string;
          organization_id: string;
          title: string;
          start_date: string;
          end_date: string | null;
          organizations: { slug: string; name: string } | null;
        } | null;
      };

      const rows = (rsvpRows ?? []) as unknown as Row[];

      // 2. For each event, ask the DB for the live aggregate counts. We do a
      // batched count rather than maintaining a denormalized counter so the
      // DB is the source of truth.
      const eventIds = rows.map((r) => r.event_id);
      const counts = new Map<string, { attending: number; checkedIn: number }>();

      if (eventIds.length > 0) {
        const { data: countRows, error: countError } = await supabase
          .from("event_rsvps")
          .select("event_id, status, checked_in_at")
          .in("event_id", eventIds)
          .eq("status", "attending");
        if (countError) throw countError;
        type CountRow = {
          event_id: string;
          status: string;
          checked_in_at: string | null;
        };
        for (const cr of (countRows ?? []) as unknown as CountRow[]) {
          const existing = counts.get(cr.event_id) ?? {
            attending: 0,
            checkedIn: 0,
          };
          existing.attending += 1;
          if (cr.checked_in_at) existing.checkedIn += 1;
          counts.set(cr.event_id, existing);
        }
      }

      const next: ActiveEventForLiveActivity[] = rows
        .filter((r) => r.events !== null && r.events.organizations !== null)
        .map((r) => {
          const event = r.events as NonNullable<typeof r.events>;
          const org = event.organizations as NonNullable<
            typeof event.organizations
          >;
          const aggregate = counts.get(r.event_id) ?? {
            attending: 0,
            checkedIn: 0,
          };
          return {
            eventId: r.event_id,
            organizationId: event.organization_id,
            orgSlug: org.slug,
            orgName: org.name,
            eventTitle: event.title,
            startDate: event.start_date,
            endDate: event.end_date,
            isCheckedIn: r.checked_in_at !== null,
            checkedInCount: aggregate.checkedIn,
            totalAttending: aggregate.attending,
          };
        });

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setEvents(next);
        setError(null);
        lastFetchTimeRef.current = Date.now();
      }
    } catch (e) {
      const err = e as { message?: string; code?: string };
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setError(err.message ?? "Failed to load active events");
      }
      sentry.captureException(e as Error, {
        context: "useActiveEventsForLiveActivity",
        userId,
      });
    } finally {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setLoading(false);
      }
    }
  }, [userId, beginRequest, isCurrentRequest]);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchActive();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchActive]);

  // Poll every 30s as a backstop in case realtime drops. The LA itself
  // refreshes via APNs pushes for counts; this poll mainly catches start /
  // end transitions.
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - lastFetchTimeRef.current;
      if (elapsed > STALE_TIME_MS) void fetchActive();
    }, STALE_TIME_MS);
    return () => clearInterval(interval);
  }, [userId, fetchActive]);

  // Realtime: any RSVP mutation for this user re-evaluates which events are
  // active. Cheap enough to subscribe globally for the user; the dispatch
  // path filters server-side anyway.
  useEffect(() => {
    if (!userId) return;
    const channel = createPostgresChangesChannel(`active_events_la:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_rsvps",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void fetchActive();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, fetchActive]);

  return {
    events,
    loading,
    error,
    refetch: fetchActive,
  };
}
