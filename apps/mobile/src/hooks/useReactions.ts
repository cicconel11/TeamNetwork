import { useEffect, useState, useCallback, useRef } from "react";
import { supabase, createPostgresChangesChannel } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import * as sentry from "@/lib/analytics/sentry";

export type ReactionTargetKind =
  | "chat_message"
  | "discussion_reply"
  | "announcement";

export interface ReactionAggregate {
  emoji: string;
  count: number;
  userReacted: boolean;
}

interface ReactionRow {
  emoji: string;
  user_id: string;
}

/**
 * Reads + mutates emoji reactions for a single target. Subscribes to realtime
 * INSERT/DELETE on `reactions` filtered by (target_kind, target_id) so the
 * counts stay live across devices in the same channel.
 */
export function useReactions(
  targetKind: ReactionTargetKind,
  targetId: string | null,
  currentUserId: string | null,
): {
  reactions: ReactionAggregate[];
  toggle: (emoji: string) => Promise<void>;
  loading: boolean;
} {
  const [rows, setRows] = useState<ReactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    if (!targetId) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("reactions")
        .select("emoji, user_id")
        .eq("target_kind", targetKind)
        .eq("target_id", targetId);
      if (error) throw error;
      if (isMountedRef.current) {
        setRows((data ?? []) as ReactionRow[]);
      }
    } catch (err) {
      sentry.captureException(err as Error, { context: "useReactions.fetch" });
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [targetKind, targetId]);

  useEffect(() => {
    setLoading(true);
    void refetch();
  }, [refetch]);

  // Realtime: any reaction mutation on this target triggers a refetch. The
  // payload doesn't carry the row's emoji/user reliably across all event
  // types, so we just refetch on any change. Fan-out is small (one query
  // per local thread).
  useEffect(() => {
    if (!targetId) return;
    const channel = createPostgresChangesChannel(`reactions:${targetKind}:${targetId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reactions",
          filter: `target_id=eq.${targetId}`,
        },
        () => {
          void refetch();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [targetKind, targetId, refetch]);

  const aggregates: ReactionAggregate[] = (() => {
    const map = new Map<string, ReactionAggregate>();
    for (const r of rows) {
      const existing = map.get(r.emoji) ?? {
        emoji: r.emoji,
        count: 0,
        userReacted: false,
      };
      existing.count += 1;
      if (r.user_id === currentUserId) existing.userReacted = true;
      map.set(r.emoji, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  })();

  const toggle = useCallback(
    async (emoji: string): Promise<void> => {
      if (!targetId || !currentUserId) return;
      const existing = aggregates.find((a) => a.emoji === emoji);
      const isAdding = !existing?.userReacted;

      // Optimistic update.
      if (isAdding) {
        setRows((prev) => [...prev, { emoji, user_id: currentUserId }]);
      } else {
        setRows((prev) =>
          prev.filter(
            (r) => !(r.user_id === currentUserId && r.emoji === emoji),
          ),
        );
      }

      try {
        const res = await fetchWithAuth("/api/reactions", {
          method: isAdding ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_kind: targetKind,
            target_id: targetId,
            emoji,
          }),
        });
        if (!res.ok) throw new Error(`reactions ${res.status}`);
      } catch (err) {
        // Revert on failure.
        sentry.captureException(err as Error, {
          context: "useReactions.toggle",
        });
        await refetch();
      }
    },
    [aggregates, currentUserId, refetch, targetId, targetKind],
  );

  return { reactions: aggregates, toggle, loading };
}
