import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import * as sentry from "@/lib/analytics/sentry";

export interface MemberStreak {
  currentWeeks: number;
  longestWeeks: number;
}

/**
 * Reads the calling user's per-org streak from `member_streaks`. Updated by
 * the daily streaks-recompute cron, so this hook just reads — no realtime
 * needed.
 */
export function useMemberStreak(
  userId: string | null,
  organizationId: string | null,
): { streak: MemberStreak | null; loading: boolean } {
  const [streak, setStreak] = useState<MemberStreak | null>(null);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId || !organizationId) {
      setStreak(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        // Cast: member_streaks isn't in the generated Database types yet.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from("member_streaks")
          .select("current_weeks, longest_weeks")
          .eq("user_id", userId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (error) throw error;
        if (!isMountedRef.current) return;
        setStreak(
          data
            ? {
                currentWeeks: data.current_weeks,
                longestWeeks: data.longest_weeks,
              }
            : { currentWeeks: 0, longestWeeks: 0 },
        );
      } catch (err) {
        sentry.captureException(err as Error, { context: "useMemberStreak" });
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    })();
  }, [userId, organizationId]);

  return { streak, loading };
}
