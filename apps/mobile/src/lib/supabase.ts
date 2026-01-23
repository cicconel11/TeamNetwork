import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";
import { captureException, reset as resetAnalytics } from "@/lib/analytics";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase credentials. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
}

// Use AsyncStorage for native, undefined (defaults to localStorage) for web
const storage = Platform.OS === "web" ? undefined : AsyncStorage;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web", // Enable for web to handle OAuth redirects
    flowType: "implicit",
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
      console.log("No active session to sign out from");
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
