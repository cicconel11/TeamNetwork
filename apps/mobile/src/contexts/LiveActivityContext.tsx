import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { Platform } from "react-native";
import * as Application from "expo-application";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveEventsForLiveActivity, type ActiveEventForLiveActivity } from "@/hooks/useActiveEventsForLiveActivity";
import { fetchWithAuth } from "@/lib/web-api";
import { isFeatureEnabled } from "@/lib/featureFlags";
import * as sentry from "@/lib/analytics/sentry";
import {
  LiveActivityNative,
  addPushTokenListener,
  type LiveActivityContentState,
} from "../../modules/live-activity/src";

/**
 * LiveActivityContext orchestrates iOS Live Activities for the events the
 * current user is RSVP'd 'attending' to.
 *
 * Responsibilities:
 *   1. Read the active-events list from `useActiveEventsForLiveActivity`.
 *   2. For each event, call `Activity.request(...)` once via the native
 *      bridge if no LA is already running for it on this device.
 *   3. Capture the APNs push token returned by ActivityKit and POST it to
 *      `/api/live-activity/register` so the dispatcher can target this LA.
 *   4. End any LA whose event is no longer active (RSVP changed, event ended
 *      or cancelled, sign-out).
 *
 * Platform / version guard: bails out for non-iOS, iOS <17, or builds that
 * lack the widget extension. The bridge stub returns `isSupported() = false`
 * in those cases, so the provider becomes a no-op.
 *
 * Caps:
 *   - DB index enforces 1 active LA per (user, event).
 *   - We additionally soft-cap at 3 concurrent activities per device to stay
 *     well under Apple's 8-activity-per-app default.
 */

const SOFT_CONCURRENT_CAP = 3;

interface LiveActivityContextValue {
  enabled: boolean;
  active: ActiveEventForLiveActivity[];
  /** Activity ids registered in this session, keyed by eventId. */
  activityIds: Record<string, string>;
}

const LiveActivityContext = createContext<LiveActivityContextValue | null>(null);

interface LiveActivityProviderProps {
  children: ReactNode;
}

export function LiveActivityProvider({ children }: LiveActivityProviderProps) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const { events: active } = useActiveEventsForLiveActivity(userId);
  const [activityIds, setActivityIds] = useState<Record<string, string>>({});
  const [eligible, setEligible] = useState<boolean>(false);
  const platformOk = useMemo(() => Platform.OS === "ios", []);
  const buildFlagOn = useMemo(() => isFeatureEnabled("liveActivitiesEnabled"), []);

  const knownActivitiesRef = useRef<Map<string, string>>(new Map()); // eventId -> activityId

  // Stable per-install device id so the server can group LAs on sign-out.
  const deviceIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (deviceIdRef.current) return;
    void (async () => {
      try {
        const id =
          (await Application.getIosIdForVendorAsync()) ??
          Application.applicationId ??
          "unknown-device";
        deviceIdRef.current = id;
      } catch {
        deviceIdRef.current = "unknown-device";
      }
    })();
  }, []);

  // Server-side eligibility / kill switch. Disabled by default until the
  // route confirms { enabled: true }. We re-check on session change.
  useEffect(() => {
    if (!userId || !platformOk || !buildFlagOn) {
      setEligible(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const supported = await LiveActivityNative.isSupported();
        if (cancelled) return;
        if (!supported) {
          setEligible(false);
          return;
        }
        const res = await fetchWithAuth("/api/live-activity/eligibility");
        if (!res.ok) {
          setEligible(false);
          return;
        }
        const body = (await res.json()) as { enabled?: boolean };
        if (!cancelled) setEligible(body.enabled === true);
      } catch (err) {
        if (!cancelled) setEligible(false);
        sentry.captureException(err as Error, {
          context: "LiveActivityContext.eligibility",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, platformOk, buildFlagOn]);

  // Hydrate `knownActivitiesRef` with anything ActivityKit already has running
  // (e.g., from a prior session). Without this we'd request a duplicate LA
  // every cold start.
  useEffect(() => {
    if (!eligible) return;
    void (async () => {
      try {
        const records = await LiveActivityNative.listActive();
        const map = new Map<string, string>();
        const next: Record<string, string> = {};
        for (const r of records) {
          map.set(r.eventId, r.activityId);
          next[r.eventId] = r.activityId;
        }
        knownActivitiesRef.current = map;
        setActivityIds(next);
      } catch (err) {
        sentry.captureException(err as Error, {
          context: "LiveActivityContext.listActive",
        });
      }
    })();
  }, [eligible]);

  const registerWithServer = useCallback(
    async (
      activityId: string,
      pushToken: string,
      event: ActiveEventForLiveActivity,
    ) => {
      try {
        const endsAt =
          event.endDate ??
          new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
        await fetchWithAuth("/api/live-activity/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            activityId,
            eventId: event.eventId,
            organizationId: event.organizationId,
            deviceId: deviceIdRef.current ?? "unknown-device",
            pushToken,
            endsAt,
          }),
        });
      } catch (err) {
        sentry.captureException(err as Error, {
          context: "LiveActivityContext.register",
          activityId,
          eventId: event.eventId,
        });
      }
    },
    [],
  );

  // Listen for late push-token deliveries (ActivityKit may emit a token after
  // the initial start() resolves, especially the first time the user enables
  // LAs in Settings).
  useEffect(() => {
    if (!eligible) return;
    const sub = addPushTokenListener(({ activityId, pushToken }) => {
      // Find the event id for this activity from our map.
      let eventId: string | null = null;
      knownActivitiesRef.current.forEach((aid, eid) => {
        if (aid === activityId) eventId = eid;
      });
      if (!eventId) return;
      const event = active.find((e) => e.eventId === eventId);
      if (!event) return;
      void registerWithServer(activityId, pushToken, event);
    });
    return () => sub.remove();
  }, [eligible, active, registerWithServer]);

  // Reconcile: start LAs for any event in `active` that doesn't already have
  // one running, and end LAs for any running activity whose event has dropped
  // out of `active`.
  useEffect(() => {
    if (!eligible) return;

    void (async () => {
      // Start missing.
      const activeIds = new Set(active.map((e) => e.eventId));
      const running = knownActivitiesRef.current;
      let runningCount = running.size;

      for (const event of active) {
        if (running.has(event.eventId)) continue;
        if (runningCount >= SOFT_CONCURRENT_CAP) {
          // Skip silently; the most recent ones win on the next tick when an
          // earlier one ends.
          break;
        }
        const contentState = buildContentState(event);
        try {
          const res = await LiveActivityNative.start({
            eventId: event.eventId,
            orgSlug: event.orgSlug,
            orgName: event.orgName,
            eventTitle: event.eventTitle,
            contentState,
            staleDate: contentState.endsAt,
          });
          if (res?.activityId) {
            running.set(event.eventId, res.activityId);
            runningCount += 1;
            setActivityIds((prev) => ({
              ...prev,
              [event.eventId]: res.activityId,
            }));
            if (res.pushToken) {
              await registerWithServer(res.activityId, res.pushToken, event);
            }
          }
        } catch (err) {
          sentry.captureException(err as Error, {
            context: "LiveActivityContext.start",
            eventId: event.eventId,
          });
        }
      }

      // End stale.
      const stale: string[] = [];
      running.forEach((activityId, eventId) => {
        if (!activeIds.has(eventId)) stale.push(eventId);
      });
      for (const eventId of stale) {
        const activityId = running.get(eventId);
        if (!activityId) continue;
        try {
          await LiveActivityNative.end(activityId, undefined, "default");
        } catch (err) {
          sentry.captureException(err as Error, {
            context: "LiveActivityContext.end",
            eventId,
          });
        }
        running.delete(eventId);
        setActivityIds((prev) => {
          const next = { ...prev };
          delete next[eventId];
          return next;
        });
        try {
          await fetchWithAuth("/api/live-activity/unregister", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activityId }),
          });
        } catch (err) {
          sentry.captureException(err as Error, {
            context: "LiveActivityContext.unregister",
            activityId,
          });
        }
      }
    })();
  }, [eligible, active, registerWithServer]);

  const value = useMemo<LiveActivityContextValue>(
    () => ({
      enabled: eligible,
      active,
      activityIds,
    }),
    [eligible, active, activityIds],
  );

  return (
    <LiveActivityContext.Provider value={value}>
      {children}
    </LiveActivityContext.Provider>
  );
}

export function useLiveActivity(): LiveActivityContextValue {
  const ctx = useContext(LiveActivityContext);
  if (!ctx) {
    return { enabled: false, active: [], activityIds: {} };
  }
  return ctx;
}

function buildContentState(
  event: ActiveEventForLiveActivity,
): LiveActivityContentState {
  return {
    checkedInCount: event.checkedInCount,
    totalAttending: event.totalAttending,
    isCheckedIn: event.isCheckedIn,
    status: deriveStatus(event),
    endsAt: Math.floor(
      new Date(
        event.endDate ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ).getTime() / 1000,
    ),
  };
}

function deriveStatus(event: ActiveEventForLiveActivity): string {
  const now = Date.now();
  const start = new Date(event.startDate).getTime();
  const end = event.endDate ? new Date(event.endDate).getTime() : start + 60 * 60 * 1000;
  if (now < start) return "starting";
  if (now > end) return "ended";
  return "live";
}
