import { createClient } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";
import { getSupabaseServiceEnv } from "./config";

export function createServiceClient() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseServiceEnv();
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}


