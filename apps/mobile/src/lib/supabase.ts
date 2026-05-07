import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";
import { captureException, reset as resetAnalytics } from "@/lib/analytics";
import { getSupabaseStorage } from "@/lib/auth-storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase credentials. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
}

const storage = getSupabaseStorage();

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web", // Enable for web to handle OAuth redirects
    flowType: "pkce",
  },
});

export async function signOut() {
  // Reset analytics identity regardless of session state
  resetAnalytics();

  const { error } = await supabase.auth.signOut();
  if (error) {
    // AuthSessionMissingError is expected if session expired or doesn't exist
    // We still want to proceed with sign out flow in this case
    if (error.name === "AuthSessionMissingError") {
      // No active session — proceed silently
      return;
    }
    console.error("Sign out error:", error);
    captureException(new Error(error.message), { context: "signOut" });
  }
}

export async function getSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Create a Supabase Realtime channel for postgres_changes with a unique
 * topic suffix per call.
 *
 * supabase-js caches channels by topic; on rapid unmount/remount, the async
 * removeChannel may not finish before the next synchronous re-subscribe. The
 * library returns the still-subscribed cached channel, and `.on()` then throws
 * "cannot add `postgres_changes` callbacks ... after `subscribe()`". A unique
 * suffix bypasses the cache.
 */
let __pgChannelCounter = 0;
export function createPostgresChangesChannel(baseTopic: string) {
  __pgChannelCounter += 1;
  const unique = `${Date.now().toString(36)}-${__pgChannelCounter}`;
  return supabase.channel(`${baseTopic}:${unique}`);
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session?.user) {
    return null;
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", session.user.id)
    .single();

  if (error) {
    console.error("Error fetching user:", error);
    captureException(new Error(error.message), { context: "getCurrentUser" });
    return null;
  }

  return data;
}
