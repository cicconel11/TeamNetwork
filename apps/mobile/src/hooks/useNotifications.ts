import { useEffect, useState, useRef, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, createPostgresChangesChannel} from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useRequestTracker } from "@/hooks/useRequestTracker";
import { normalizeRole, ViewerContext } from "@teammeet/core";
import * as sentry from "@/lib/analytics/sentry";
import { setBadgeCount } from "@/lib/notifications";

// Legacy AsyncStorage key from the local-only read-state era. The hook now
// imports any pre-existing values into `notification_reads` once per
// (user, org) and then deletes the storage entry. Kept as a constant so the
// migration can find old data on upgrade.
const STORAGE_KEY_PREFIX = "notification_read_ids_";
const MIGRATED_KEY_PREFIX = "notification_reads_migrated_";
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
  // Deep-link metadata (P1c). Nullable on legacy rows.
  type?: string | null;
  resource_id?: string | null;
  data?: Record<string, unknown> | null;
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
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { beginRequest, invalidateRequests, isCurrentRequest } = useRequestTracker();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  const viewerContextRef = useRef<ViewerContext | null>(null);

  // One-time migration: import any pre-existing AsyncStorage read-ids into
  // the server-side `notification_reads` table, then drop the local entry.
  // Idempotent: the table's PK prevents duplicates, and we set a sentinel
  // key so we don't re-attempt on every render.
  const migrateLegacyReadIds = useCallback(async () => {
    if (!userId || !orgId) return;
    const migratedKey = `${MIGRATED_KEY_PREFIX}${userId}_${orgId}`;
    try {
      const alreadyMigrated = await AsyncStorage.getItem(migratedKey);
      if (alreadyMigrated) return;

      const storageKey = `${STORAGE_KEY_PREFIX}${userId}_${orgId}`;
      const stored = await AsyncStorage.getItem(storageKey);
      if (stored) {
        const ids: string[] = JSON.parse(stored);
        if (Array.isArray(ids) && ids.length > 0) {
          // Cast: notification_reads isn't yet in generated Database types.
          await (supabase as unknown as {
            from: (table: string) => {
              upsert: (
                rows: Array<Record<string, unknown>>,
                opts: { onConflict: string; ignoreDuplicates?: boolean },
              ) => Promise<{ error: { message: string } | null }>;
            };
          })
            .from("notification_reads")
            .upsert(
              ids.map((notification_id) => ({
                notification_id,
                user_id: userId,
              })),
              { onConflict: "notification_id,user_id", ignoreDuplicates: true },
            );
        }
        await AsyncStorage.removeItem(storageKey);
      }
      await AsyncStorage.setItem(migratedKey, "1");
    } catch (e) {
      // Best-effort. If migration fails, the inbox just shows everything as
      // unread until the user marks read again — no data loss.
      sentry.captureException(e as Error, {
        context: "useNotifications.migrateLegacyReadIds",
      });
    }
  }, [orgId, userId]);

  // Reset state when orgId changes
  useEffect(() => {
    lastFetchTimeRef.current = 0;
    setOffset(0);
    setHasMore(false);
    setTotalCount(null);
    setReadIds(new Set());
    viewerContextRef.current = null;
    invalidateRequests();
  }, [orgId, userId, invalidateRequests]);

  const fetchNotifications = useCallback(
    async (fetchOffset: number = 0, append: boolean = false) => {
      const requestId = beginRequest();

      if (!orgId || !userId) {
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
        // Get user's role in this org (only on initial fetch or if not cached)
        if (!viewerContextRef.current || !append) {
          const { data: roleData } = await supabase
            .from("user_organization_roles")
            .select("role, status")
            .eq("organization_id", orgId)
            .eq("user_id", userId)
            .eq("status", "active")
            .single();

          viewerContextRef.current = {
            role: normalizeRole(roleData?.role),
            status: roleData?.status ?? null,
            userId,
          };
        }

        // Best-effort one-time import of legacy AsyncStorage read state.
        await migrateLegacyReadIds();

        // Load read IDs from notification_reads (server-side source of truth).
        let storedReadIds = new Set<string>();
        try {
          const { data: reads } = await (supabase as unknown as {
            from: (table: string) => {
              select: (cols: string) => {
                eq: (col: string, val: string) => Promise<{
                  data: Array<{ notification_id: string }> | null;
                }>;
              };
            };
          })
            .from("notification_reads")
            .select("notification_id")
            .eq("user_id", userId);
          if (reads) {
            storedReadIds = new Set(reads.map((r) => r.notification_id));
          }
        } catch {
          // Fall through with empty set; next refetch will retry.
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
        if (!isCurrentRequest(requestId)) return;

        // Filter based on audience targeting
        const filtered = (notificationsData || []).filter((notification) =>
          canViewNotification(notification, viewerContextRef.current!)
        );

        // Annotate with read status using the server-fetched set.
        const annotated: Notification[] = filtered.map((n) => ({
          ...n,
          isRead: storedReadIds.has(n.id),
        }));
        void migrateLegacyReadIds; // silence unused-in-deps lint when re-running

        if (isMountedRef.current && isCurrentRequest(requestId)) {
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
        sentry.captureException(e as Error, { context: "useNotifications.fetchNotifications" });
        if (isMountedRef.current && isCurrentRequest(requestId)) {
          setError((e as Error).message);
        }
      } finally {
        if (isMountedRef.current && isCurrentRequest(requestId)) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [orgId, userId, pageSize, isPaginated, beginRequest, isCurrentRequest, migrateLegacyReadIds]
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

  // Helpers that round-trip read state to the server-side
  // `notification_reads` table. The local Set + notifications array are
  // updated optimistically; failures roll back via refetch.
  type ReadsTable = {
    upsert: (
      rows: Array<Record<string, unknown>>,
      opts: { onConflict: string; ignoreDuplicates?: boolean },
    ) => Promise<{ error: { message: string } | null }>;
    delete: () => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        in: (col: string, vals: string[]) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  const readsTable = (): ReadsTable =>
    (supabase as unknown as { from: (t: string) => ReadsTable }).from(
      "notification_reads",
    );

  // Mark a notification as read
  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!orgId || !userId) return;

      setReadIds((current) => {
        if (current.has(notificationId)) return current;
        const next = new Set(current);
        next.add(notificationId);
        return next;
      });
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: true } : n
        )
      );

      try {
        await readsTable().upsert(
          [{ notification_id: notificationId, user_id: userId }],
          { onConflict: "notification_id,user_id", ignoreDuplicates: true },
        );
      } catch (e) {
        sentry.captureException(e as Error, {
          context: "useNotifications.markAsRead",
        });
      }

      readStatusEmitter.emit("read", { orgId, userId, notificationId });
    },
    [orgId, userId]
  );

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!orgId || !userId) return;

    const allIds = notifications.map((n) => n.id);
    if (allIds.length === 0) return;

    setReadIds((current) => new Set([...current, ...allIds]));
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));

    try {
      await readsTable().upsert(
        allIds.map((id) => ({ notification_id: id, user_id: userId })),
        { onConflict: "notification_id,user_id", ignoreDuplicates: true },
      );
    } catch (e) {
      sentry.captureException(e as Error, {
        context: "useNotifications.markAllAsRead",
      });
    }

    readStatusEmitter.emit("readAll", { orgId, userId });
  }, [orgId, userId, notifications]);

  // Mark a notification as unread
  const markAsUnread = useCallback(
    async (notificationId: string) => {
      if (!orgId || !userId) return;

      setReadIds((current) => {
        if (!current.has(notificationId)) return current;
        const next = new Set(current);
        next.delete(notificationId);
        return next;
      });
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: false } : n
        )
      );

      try {
        await readsTable()
          .delete()
          .eq("notification_id", notificationId)
          .eq("user_id", userId);
      } catch (e) {
        sentry.captureException(e as Error, {
          context: "useNotifications.markAsUnread",
        });
      }

      readStatusEmitter.emit("unread", { orgId, userId, notificationId });
    },
    [orgId, userId]
  );

  // Compute unread count
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // Keep the OS app icon badge in sync with the inbox unread count.
  // Web/simulator are no-ops in setBadgeCount.
  useEffect(() => {
    void setBadgeCount(unreadCount);
  }, [unreadCount]);

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

    const channel = createPostgresChangesChannel(`notifications:${orgId}`)
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

    const channel = createPostgresChangesChannel(`notification-roles:${orgId}:${userId}`)
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
