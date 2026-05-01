import { useEffect, useState, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { useRealtimeChannelInstanceSuffix } from "@/lib/realtime-instance-id";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import { canViewAnnouncement, type AnnouncementAudienceTarget, type ViewerContext, normalizeRole } from "@teammeet/core";

const STORAGE_KEY_PREFIX = "announcement_last_viewed_";

// Simple event emitter for React Native (replaces Node.js EventEmitter)
type MarkAsReadHandler = (data: { orgId: string; userId: string }) => void;
const markAsReadListeners = new Set<MarkAsReadHandler>();
const markAsReadEmitter = {
  emit: (data: { orgId: string; userId: string }) => {
    markAsReadListeners.forEach((handler) => handler(data));
  },
  on: (handler: MarkAsReadHandler) => {
    markAsReadListeners.add(handler);
  },
  off: (handler: MarkAsReadHandler) => {
    markAsReadListeners.delete(handler);
  },
};
const STALE_TIME_MS = 30_000; // 30 seconds

type MinimalAnnouncement = AnnouncementAudienceTarget & {
  id: string;
};

interface UseUnreadAnnouncementCountReturn {
  unreadCount: number;
  loading: boolean;
  markAsRead: () => Promise<void>;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
}

/**
 * Hook to track unread announcement count for an organization.
 * Uses AsyncStorage to persist the last viewed timestamp per org.
 * Counts announcements created after that timestamp as "unread".
 */
export function useUnreadAnnouncementCount(
  orgId: string | null
): UseUnreadAnnouncementCountReturn {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const realtimeInstanceSuffix = useRealtimeChannelInstanceSuffix();
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);

  // Storage key includes both user ID and org ID to isolate per-user read state
  const getStorageKey = useCallback(() => {
    if (!userId || !orgId) return null;
    return `${STORAGE_KEY_PREFIX}${userId}_${orgId}`;
  }, [userId, orgId]);

  const fetchUnreadCount = useCallback(async () => {
    const requestId = beginRequest();

    if (!orgId || !userId) {
      if (isMountedRef.current) {
        setUnreadCount(0);
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);

      // Get last viewed timestamp from AsyncStorage (key includes user ID)
      const storageKey = `${STORAGE_KEY_PREFIX}${userId}_${orgId}`;
      const lastViewedStr = await AsyncStorage.getItem(storageKey);
      const lastViewed = lastViewedStr ? new Date(lastViewedStr) : null;

      // Get user's role in this org
      const { data: roleData } = await supabase
        .from("user_organization_roles")
        .select("role, status")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .eq("status", "active")
        .single();

      // Build query for count - only fetch what we need
      let query = supabase
        .from("announcements")
        .select("id, audience, audience_user_ids, created_at", { count: "exact" })
        .eq("organization_id", orgId)
        .is("deleted_at", null);

      // If we have a last viewed timestamp, only count newer announcements
      if (lastViewed) {
        query = query.gt("created_at", lastViewed.toISOString());
      }

      const { data: announcementsData, error: announcementsError } = await query;

      if (announcementsError) {
        throw announcementsError;
      }

      // Filter based on audience targeting (same as useAnnouncements)
      const ctx: ViewerContext = {
        role: normalizeRole(roleData?.role),
        status: roleData?.status ?? null,
        userId,
      };

      // Filter announcements for audience targeting
      const visibleAnnouncements = (announcementsData || []).filter(
        (announcement) => canViewAnnouncement(announcement, ctx)
      );

      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setUnreadCount(visibleAnnouncements.length);
        lastFetchTimeRef.current = Date.now();
      }
    } catch {
      // On error, just show 0 to avoid confusion
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setUnreadCount(0);
      }
    } finally {
      if (isMountedRef.current && isCurrentRequest(requestId)) {
        setLoading(false);
      }
    }
  }, [orgId, userId, getStorageKey, beginRequest, isCurrentRequest]);

  // Mark announcements as read by updating the last viewed timestamp
  const markAsRead = useCallback(async () => {
    const storageKey = getStorageKey();
    if (!storageKey) return;

    const now = new Date().toISOString();
    await AsyncStorage.setItem(storageKey, now);

    if (isMountedRef.current) {
      setUnreadCount(0);
    }

    // Emit event so other hook instances can sync their state
    markAsReadEmitter.emit({ orgId: orgId!, userId: userId! });
  }, [orgId, userId, getStorageKey]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      fetchUnreadCount();
    }
  }, [fetchUnreadCount]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    invalidateRequests();
    fetchUnreadCount();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchUnreadCount, invalidateRequests]);

  // Listen for mark-as-read events from other hook instances to sync state
  useEffect(() => {
    const handleMarked = (data: { orgId: string; userId: string }) => {
      // Only sync if this event is for the same org and user
      if (data.orgId === orgId && data.userId === userId && isMountedRef.current) {
        setUnreadCount(0);
      }
    };

    markAsReadEmitter.on(handleMarked);
    return () => {
      markAsReadEmitter.off(handleMarked);
    };
  }, [orgId, userId]);

  // Real-time subscription for announcement changes
  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`unread-announcements:${orgId}:${realtimeInstanceSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcements",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          fetchUnreadCount();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: userId ? `user_id=eq.${userId}` : undefined,
        },
        (payload) => {
          const nextOrgId = (payload.new as { organization_id?: string } | null)?.organization_id;
          const previousOrgId = (payload.old as { organization_id?: string } | null)?.organization_id;
          if (nextOrgId === orgId || previousOrgId === orgId) {
            fetchUnreadCount();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, fetchUnreadCount, realtimeInstanceSuffix]);

  return {
    unreadCount,
    loading,
    markAsRead,
    refetch: fetchUnreadCount,
    refetchIfStale,
  };
}
