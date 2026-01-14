import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";

// #region agent log
const DEBUG_ENDPOINT = "http://127.0.0.1:7242/ingest/0eaba42a-4b1e-479c-bf2c-aacdd15d55fa";
const debugLog = (location: string, message: string, data: Record<string, unknown>, hypothesisId: string) => {
  fetch(DEBUG_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location, message, data, hypothesisId, timestamp: Date.now(), sessionId: "debug-session" }) }).catch(() => {});
};
// #endregion

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase credentials. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
}

// #region agent log
debugLog("supabase.ts:init", "Supabase client initialized", {
  url: supabaseUrl,
  urlProjectRef: supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? "unknown",
  anonKeyPrefix: supabaseAnonKey.slice(0, 20),
}, "E");
// #endregion

if (__DEV__) {
  console.log("DEBUG: Supabase env:", {
    url: supabaseUrl,
    anonKeyPrefix: `${supabaseAnonKey.slice(0, 12)}…`,
  });
}

// Debug: Check what's in AsyncStorage for Supabase auth
export async function debugAsyncStorage() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const supabaseKeys = keys.filter(k => k.includes("supabase") || k.includes("auth"));
    console.log("DEBUG: AsyncStorage supabase keys:", supabaseKeys);
    
    for (const key of supabaseKeys) {
      const value = await AsyncStorage.getItem(key);
      console.log(`DEBUG: AsyncStorage[${key}]:`, value ? `${value.slice(0, 100)}...` : "null");
    }
  } catch (e) {
    console.error("DEBUG: AsyncStorage error:", e);
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Sign out error:", error);
  }
}

export async function getSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
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
    return null;
  }

  return data;
}
