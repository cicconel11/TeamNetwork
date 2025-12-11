import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Note: NEXT_PUBLIC_* env vars must be accessed as literal strings for Next.js
// to inline them at build time. Dynamic access via process.env[name] won't work.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton pattern to ensure consistent auth state across the app
// The browser client uses cookies for storage, but having a single instance
// ensures the in-memory auth state listener is consistent
let browserClient: SupabaseClient | null = null;

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables");
  }
  
  // Return existing client if already created (singleton pattern)
  if (browserClient) {
    return browserClient;
  }
  
  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  
  // Log auth state changes for debugging
  browserClient.auth.onAuthStateChange((event, session) => {
    console.log("[supabase/client] Auth state changed:", event, session?.user?.id?.slice(0, 8) || "no-user");
  });
  
  return browserClient;
}

