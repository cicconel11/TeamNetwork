import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase, createPostgresChangesChannel } from "@/lib/supabase";
import { useAuthOptional } from "@/contexts/AuthContext";
import { getBlockedUsers, toggleBlock as apiToggleBlock } from "@/lib/moderation";

interface BlockedUsersContextValue {
  blockedUserIds: Set<string>;
  isBlocked: (userId: string | null | undefined) => boolean;
  toggleBlock: (userId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

const BlockedUsersContext = createContext<BlockedUsersContextValue | null>(null);

interface UserBlockRow {
  blocker_id: string;
  blocked_id: string;
  deleted_at: string | null;
}

export function BlockedUsersProvider({ children }: { children: ReactNode }) {
  const auth = useAuthOptional();
  const userId = auth?.user?.id ?? null;
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchAll = useCallback(async () => {
    if (!userId) {
      if (isMountedRef.current) setBlockedUserIds(new Set());
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("user_blocks")
        .select("blocker_id, blocked_id")
        .is("deleted_at", null)
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`) as {
          data: Pick<UserBlockRow, "blocker_id" | "blocked_id">[] | null;
          error: { message: string } | null;
        };

      if (error) throw error;

      const next = new Set<string>();
      for (const row of data ?? []) {
        if (row.blocker_id === userId) next.add(row.blocked_id);
        if (row.blocked_id === userId) next.add(row.blocker_id);
      }
      if (isMountedRef.current) setBlockedUserIds(next);
    } catch (err) {
      console.warn("[BlockedUsers] direct fetch failed, falling back to web API", err);
      try {
        const ids = await getBlockedUsers();
        if (isMountedRef.current) setBlockedUserIds(new Set(ids));
      } catch (fallbackErr) {
        console.error("[BlockedUsers] fallback fetch failed", fallbackErr);
      }
    }
  }, [userId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!userId) return;

    const channel = createPostgresChangesChannel(`user_blocks:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_blocks",
          filter: `blocker_id=eq.${userId}`,
        },
        () => {
          void fetchAll();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_blocks",
          filter: `blocked_id=eq.${userId}`,
        },
        () => {
          void fetchAll();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, fetchAll]);

  const toggleBlock = useCallback(
    async (otherUserId: string): Promise<boolean> => {
      const { blocked } = await apiToggleBlock(otherUserId);
      if (isMountedRef.current) {
        setBlockedUserIds((prev) => {
          const next = new Set(prev);
          if (blocked) next.add(otherUserId);
          else next.delete(otherUserId);
          return next;
        });
      }
      return blocked;
    },
    [],
  );

  const isBlocked = useCallback(
    (otherUserId: string | null | undefined) =>
      !!otherUserId && blockedUserIds.has(otherUserId),
    [blockedUserIds],
  );

  const value = useMemo<BlockedUsersContextValue>(
    () => ({
      blockedUserIds,
      isBlocked,
      toggleBlock,
      refresh: fetchAll,
    }),
    [blockedUserIds, isBlocked, toggleBlock, fetchAll],
  );

  return (
    <BlockedUsersContext.Provider value={value}>
      {children}
    </BlockedUsersContext.Provider>
  );
}

export function useBlockedUsers(): BlockedUsersContextValue {
  const ctx = useContext(BlockedUsersContext);
  if (!ctx) {
    // Soft fallback so components rendered above the provider don't crash.
    return {
      blockedUserIds: EMPTY_SET as Set<string>,
      isBlocked: () => false,
      toggleBlock: async () => false,
      refresh: async () => {},
    };
  }
  return ctx;
}

export function useBlockedUserIds(): Set<string> {
  return useBlockedUsers().blockedUserIds;
}

export function useIsBlocked(userId: string | null | undefined): boolean {
  return useBlockedUsers().isBlocked(userId);
}
