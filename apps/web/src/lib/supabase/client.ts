import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserEnv } from "./config";

// Singleton pattern to ensure consistent auth state across the app
// The browser client uses cookies for storage, but having a single instance
// ensures the in-memory auth state listener is consistent
let browserClient: SupabaseClient | null = null;

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseBrowserEnv();
  
  // Return existing client if already created (singleton pattern)
  if (browserClient) {
    return browserClient;
  }
  
  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      domain: undefined,
    },
  });
  
  // Log auth state changes for debugging
  browserClient.auth.onAuthStateChange((event, session) => {
    console.log("[supabase/client] Auth state changed:", event, session?.user?.id?.slice(0, 8) || "no-user");
  });
  
  return browserClient;
}
