import { createBrowserClient } from "@supabase/ssr";

// Note: NEXT_PUBLIC_* env vars must be accessed as literal strings for Next.js
// to inline them at build time. Dynamic access via process.env[name] won't work.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables");
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

