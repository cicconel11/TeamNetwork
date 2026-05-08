import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "@/lib/supabase";

/**
 * Bumps `users.last_active_at` for the signed-in user via the
 * `record_user_activity` RPC. Server-side debounced to 60s so we can call it
 * liberally — once on mount (sign-in) and once on every app-foreground.
 *
 * Powers DAU + the re-engagement-sweep cron's "inactive ≥7d" gate.
 */
async function fireHeartbeat(): Promise<void> {
  try {
    // Cast: `record_user_activity` is a new RPC not yet in the generated
    // Database types. Regenerate via `bun run gen:types` after the migration
    // is applied to remove the cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc("record_user_activity");
  } catch {
    // Silent — heartbeat failure shouldn't break the app.
  }
}

export function useActivityHeartbeat(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;

    void fireHeartbeat();

    const handler = (state: AppStateStatus) => {
      if (state !== "active") return;
      void fireHeartbeat();
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, [userId]);
}
