import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";

/**
 * Org-scoped Realtime presence. One channel per active org keyed
 * `org-presence:<orgId>`; each foregrounded device tracks `{userId}` so the
 * org's online roster is the union of presenceState across all subscribers.
 *
 * This is intentionally a separate context (not folded into OrgContext) so
 * `useOrg()` consumers don't re-render on every roster change.
 */

interface PresenceContextValue {
  /** Set of user ids currently considered online in the active org. */
  onlineUserIds: Set<string>;
  /** Convenience helper for components rendering many avatars. */
  isOnline: (userId: string | null | undefined) => boolean;
}

const PresenceContext = createContext<PresenceContextValue>({
  onlineUserIds: new Set(),
  isOnline: () => false,
});

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!orgId || !user?.id) {
      setOnlineUserIds(new Set());
      return;
    }

    // Guard against stale channels left over from HMR / unclean teardown:
    // supabase.channel(name) returns the cached instance if one already
    // exists, and calling .on() on an already-subscribed channel throws.
    const existing = supabase
      .getChannels()
      .find((c) => c.topic === `realtime:org-presence:${orgId}`);
    if (existing) {
      void supabase.removeChannel(existing);
    }

    const channel = supabase.channel(`org-presence:${orgId}`, {
      config: { presence: { key: user.id } },
    });
    channelRef.current = channel;

    const updateRoster = () => {
      // presenceState() returns Record<key, Array<{ userId }>>. Each connected
      // device for the same user shares the same key, so a user with two
      // devices appears once.
      const state = channel.presenceState();
      const ids = new Set<string>();
      for (const key of Object.keys(state)) {
        ids.add(key);
      }
      setOnlineUserIds(ids);
    };

    channel
      .on("presence", { event: "sync" }, updateRoster)
      .on("presence", { event: "join" }, updateRoster)
      .on("presence", { event: "leave" }, updateRoster)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ userId: user.id, at: Date.now() });
        }
      });

    // Untrack on background so we don't show stale-online dots while users
    // have the app suspended; re-track on foreground.
    const onAppState = (state: AppStateStatus) => {
      if (state === "active") {
        void channel.track({ userId: user.id, at: Date.now() });
      } else {
        void channel.untrack();
      }
    };
    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [orgId, user?.id]);

  const value = useMemo<PresenceContextValue>(
    () => ({
      onlineUserIds,
      isOnline: (userId: string | null | undefined) =>
        userId ? onlineUserIds.has(userId) : false,
    }),
    [onlineUserIds],
  );

  return (
    <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
  );
}

export function usePresence(): PresenceContextValue {
  return useContext(PresenceContext);
}
