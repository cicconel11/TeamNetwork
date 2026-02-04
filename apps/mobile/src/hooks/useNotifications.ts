import { useEffect, useState, useRef, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { normalizeRole, ViewerContext } from "@teammeet/core";

const STORAGE_KEY_PREFIX = "notification_read_ids_";
const STALE_TIME_MS = 30_000; // 30 seconds
const DEFAULT_PAGE_SIZE = 50;

// Simple typed event emitter for React Native (replaces Node.js EventEmitter)
type ReadEvent = { orgId: string; userId: string; notificationId: string };
type ReadAllEvent = { orgId: string; userId: string };
type UnreadEvent = { orgId: string; userId: string; notificationId: string };

type EventMap = {
  read: ReadEvent;
  readAll: ReadAllEvent;
  unread: UnreadEvent;
};

type EventHandler<T> = (data: T) => void;

const createEventEmitter = <T extends Record<string, unknown>>() => {
  const listeners: { [K in keyof T]?: Set<EventHandler<T[K]>> } = {};
  return {
    emit: <K extends keyof T>(event: K, data: T[K]) => {
      listeners[event]?.forEach((handler) => handler(data));
    },
    on: <K extends keyof T>(event: K, handler: EventHandler<T[K]>) => {
      if (!listeners[event]) listeners[event] = new Set();
      listeners[event]!.add(handler as EventHandler<T[keyof T]>);
    },
    off: <K extends keyof T>(event: K, handler: EventHandler<T[K]>) => {
      listeners[event]?.delete(handler as EventHandler<T[keyof T]>);
    },
  };
};

const readStatusEmitter = createEventEmitter<EventMap>();

/**
 * Notification data from the notifications table
 */
export interface Notification {
  id: string;
  organization_id: string;
  title: string;
  body: string | null;
  audience: string;
  channel: string;
  target_user_ids: string[] | null;
  created_at: string | null;
  sent_at: string | null;
  created_by_user_id: string | null;
  deleted_at: string | null;
  isRead?: boolean;
}

/**
 * Check if a user can view a notification based on audience targeting.
 */
function canViewNotification(
  notification: Pick<Notification, "audience" | "target_user_ids">,
  ctx: ViewerContext
): boolean {
  if (!ctx.role || ctx.status !== "active") return false;
  if (ctx.role === "admin") return true;

  switch (notification.audience) {
    case "all":
      return true;
    case "members":
    case "active_members":
      return ctx.role === "active_member";
    case "alumni":
      return ctx.role === "alumni";
    case "individuals":
      return (
        !!ctx.userId &&
        (notification.target_user_ids || []).includes(ctx.userId)
      );
    default:
      return false;
  }
}

interface UseNotificationsOptions {
  /** Number of records to fetch per page. Default: 50. Set to 0 to fetch all records. */
  limit?: number;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  totalCount: number | null;
  unreadCount: number;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  refetchIfStale: () => void;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  markAsUnread: (notificationId: string) => Promise<void>;
}

/**
 * Hook to fetch and manage notifications for an organization.
 * Tracks read/unread state using AsyncStorage.
 */
export function useNotifications(
  orgId: string | null,
  options?: UseNotificationsOptions
): UseNotificationsReturn {
  const pageSize = options?.limit ?? DEFAULT_PAGE_SIZE;
  const isPaginated = pageSize > 0;

  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  const viewerContextRef = useRef<ViewerContext | null>(null);

  // Storage key for read notification IDs
  const getStorageKey = useCallback(() => {
    if (!userId || !orgId) return null;
    return `${STORAGE_KEY_PREFIX}${userId}_${orgId}`;
  }, [userId, orgId]);

  // Load read IDs from AsyncStorage
  const loadReadIds = useCallback(async () => {
    const storageKey = getStorageKey();
    if (!storageKey) return new Set<string>();

    try {
      const stored = await AsyncStorage.getItem(storageKey);
      if (stored) {
        const ids: string[] = JSON.parse(stored);
        return new Set(ids);
      }
    } catch {
      // Ignore parse errors
    }
    return new Set<string>();
  }, [getStorageKey]);

  // Save read IDs to AsyncStorage
  const saveReadIds = useCallback(
    async (ids: Set<string>) => {
      const storageKey = getStorageKey();
      if (!storageKey) return;

      try {
        await AsyncStorage.setItem(storageKey, JSON.stringify([...ids]));
      } catch {
        // Ignore save errors
      }
    },
    [getStorageKey]
  );

  // Reset state when orgId changes
  useEffect(() => {
    lastFetchTimeRef.current = 0;
    setOffset(0);
    setHasMore(false);
    setTotalCount(null);
    setReadIds(new Set());
    viewerContextRef.current = null;
  }, [orgId]);

  const fetchNotifications = useCallback(
    async (fetchOffset: number = 0, append: boolean = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setNotifications([]);
          setError(null);
          setLoading(false);
          setHasMore(false);
          setTotalCount(null);
        }
        return;
      }

      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }

        // Get current user
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");
        if (isMountedRef.current) {
          setUserId(user.id);
        }

        // Get user's role in this org (only on initial fetch or if not cached)
        if (!viewerContextRef.current || !append) {
          const { data: roleData } = await supabase
            .from("user_organization_roles")
            .select("role, status")
            .eq("organization_id", orgId)
            .eq("user_id", user.id)
            .eq("status", "active")
            .single();

          viewerContextRef.current = {
            role: normalizeRole(roleData?.role),
            status: roleData?.status ?? null,
            userId: user.id,
          };
        }

        // Load read IDs from storage
        const storageKey = `${STORAGE_KEY_PREFIX}${user.id}_${orgId}`;
        let storedReadIds = new Set<string>();
        try {
          const stored = await AsyncStorage.getItem(storageKey);
          if (stored) {
            storedReadIds = new Set(JSON.parse(stored));
          }
        } catch {
          // Ignore
        }
        if (isMountedRef.current) {
          setReadIds(storedReadIds);
        }

        // Build query
        let query = supabase
          .from("notifications")
          .select("*", { count: "exact" })
          .eq("organization_id", orgId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });

        // Apply pagination if enabled
        if (isPaginated) {
          query = query.range(fetchOffset, fetchOffset + pageSize - 1);
        }

        const { data: notificationsData, error: notificationsError, count } = await query;

        if (notificationsError) throw notificationsError;

        // Filter based on audience targeting
        const filtered = (notificationsData || []).filter((notification) =>
          canViewNotification(notification, viewerContextRef.current!)
        );

        // Annotate with read status
        const annotated: Notification[] = filtered.map((n) => ({
          ...n,
          isRead: storedReadIds.has(n.id),
        }));

        if (isMountedRef.current) {
          if (append) {
            setNotifications((prev) => [...prev, ...annotated]);
          } else {
            setNotifications(annotated);
          }

          setError(null);
          lastFetchTimeRef.current = Date.now();

          if (count !== null) {
            setTotalCount(count);
            if (isPaginated) {
              setHasMore(fetchOffset + (notificationsData?.length || 0) < count);
            }
          } else if (isPaginated) {
            setHasMore((notificationsData?.length || 0) === pageSize);
          }

          setOffset(fetchOffset + (notificationsData?.length || 0));
        }
      } catch (e) {
        if (isMountedRef.current) {
          setError((e as Error).message);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [orgId, pageSize, isPaginated]
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    await fetchNotifications(offset, true);
  }, [hasMore, loadingMore, loading, offset, fetchNotifications]);

  const refetch = useCallback(async () => {
    setOffset(0);
    viewerContextRef.current = null;
    await fetchNotifications(0, false);
  }, [fetchNotifications]);

  const refetchIfStale = useCallback(() => {
    const now = Date.now();
    if (now - lastFetchTimeRef.current > STALE_TIME_MS) {
      setOffset(0);
      viewerContextRef.current = null;
      fetchNotifications(0, false);
    }
  }, [fetchNotifications]);

  // Mark a notification as read
  const markAsRead = useCallback(
    async (notificationId: string) => {
      const newReadIds = new Set(readIds);
      newReadIds.add(notificationId);
      setReadIds(newReadIds);
      await saveReadIds(newReadIds);

      // Update local notifications state (immutable)
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: true } : n
        )
      );

      // Emit event for other hook instances
      readStatusEmitter.emit("read", { orgId, userId, notificationId });
    },
    [orgId, userId, readIds, saveReadIds]
  );

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    const allIds = notifications.map((n) => n.id);
    const newReadIds = new Set([...readIds, ...allIds]);
    setReadIds(newReadIds);
    await saveReadIds(newReadIds);

    // Update local notifications state (immutable)
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));

    // Emit event for other hook instances
    readStatusEmitter.emit("readAll", { orgId, userId });
  }, [orgId, userId, notifications, readIds, saveReadIds]);

  // Mark a notification as unread
  const markAsUnread = useCallback(
    async (notificationId: string) => {
      const newReadIds = new Set(readIds);
      newReadIds.delete(notificationId);
      setReadIds(newReadIds);
      await saveReadIds(newReadIds);

      // Update local notifications state (immutable)
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: false } : n
        )
      );

      // Emit event for other hook instances
      readStatusEmitter.emit("unread", { orgId, userId, notificationId });
    },
    [orgId, userId, readIds, saveReadIds]
  );

  // Compute unread count
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;
    fetchNotifications(0, false);

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchNotifications]);

  // Listen for read status changes from other hook instances
  useEffect(() => {
    const handleRead = (data: {
      orgId: string;
      userId: string;
      notificationId: string;
    }) => {
      if (data.orgId === orgId && data.userId === userId && isMountedRef.current) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === data.notificationId ? { ...n, isRead: true } : n
          )
        );
        setReadIds((prev) => {
          const newSet = new Set(prev);
          newSet.add(data.notificationId);
          return newSet;
        });
      }
    };

    const handleReadAll = (data: { orgId: string; userId: string }) => {
      if (data.orgId === orgId && data.userId === userId && isMountedRef.current) {
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      }
    };

    const handleUnread = (data: {
      orgId: string;
      userId: string;
      notificationId: string;
    }) => {
      if (data.orgId === orgId && data.userId === userId && isMountedRef.current) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === data.notificationId ? { ...n, isRead: false } : n
          )
        );
        setReadIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(data.notificationId);
          return newSet;
        });
      }
    };

    readStatusEmitter.on("read", handleRead);
    readStatusEmitter.on("readAll", handleReadAll);
    readStatusEmitter.on("unread", handleUnread);

    return () => {
      readStatusEmitter.off("read", handleRead);
      readStatusEmitter.off("readAll", handleReadAll);
      readStatusEmitter.off("unread", handleUnread);
    };
  }, [orgId, userId]);

  // Real-time subscription for notification changes
  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`notifications:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          // Refetch from beginning on any change
          setOffset(0);
          viewerContextRef.current = null;
          fetchNotifications(0, false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, fetchNotifications]);

  // Re-fetch if user's role changes
  useEffect(() => {
    if (!orgId || !userId) return;

    const channel = supabase
      .channel(`notification-roles:${orgId}:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_organization_roles",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const nextOrgId = (payload.new as { organization_id?: string } | null)
            ?.organization_id;
          const previousOrgId = (
            payload.old as { organization_id?: string } | null
          )?.organization_id;
          if (nextOrgId === orgId || previousOrgId === orgId) {
            setOffset(0);
            viewerContextRef.current = null;
            fetchNotifications(0, false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, userId, fetchNotifications]);

  return {
    notifications,
    loading,
    loadingMore,
    error,
    hasMore,
    totalCount,
    unreadCount,
    loadMore,
    refetch,
    refetchIfStale,
    markAsRead,
    markAllAsRead,
    markAsUnread,
  };
}
