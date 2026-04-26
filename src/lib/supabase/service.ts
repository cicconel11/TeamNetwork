import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabaseServiceEnv } from "./config";
import type { ServiceSupabase } from "./types";

export function createServiceClient(): ServiceSupabase {
  const { supabaseUrl, serviceRoleKey } = getSupabaseServiceEnv();
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as ServiceSupabase;
}


