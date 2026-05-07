import { useEffect } from "react";
import { AppState } from "react-native";
import { supabase } from "@/lib/supabase";

/**
 * Reconnects Supabase realtime and refreshes auth tokens when app
 * returns from background. Call once from the root layout.
 */
export function useSupabaseAppState(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void supabase.auth.startAutoRefresh();
        supabase.realtime.connect();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);
}
