import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "@/lib/supabase";

function syncSupabaseForAppState(state: AppStateStatus): void {
  if (state === "active") {
    void supabase.auth.startAutoRefresh();
    supabase.realtime.connect();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
}

/**
 * Reconnects Supabase realtime and refreshes auth tokens when app
 * returns from background. Call once from the root layout.
 *
 * Also syncs on mount when the process already starts in the `active` state,
 * so cold launches do not skip `startAutoRefresh` (only transition listeners
 * would otherwise run).
 */
export function useSupabaseAppState(): void {
  useEffect(() => {
    syncSupabaseForAppState(AppState.currentState);

    const subscription = AppState.addEventListener("change", syncSupabaseForAppState);
    return () => {
      subscription.remove();
    };
  }, []);
}
