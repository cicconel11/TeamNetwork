import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabaseServiceEnv } from "./config";

export function createServiceClient() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseServiceEnv();
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}


