import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabaseBrowserEnv } from "./config";
import { createClient as createServerClient } from "./server";

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function createAuthenticatedApiClient(req: Request): Promise<{
  supabase: Awaited<ReturnType<typeof createServerClient>>;
  user: User | null;
}> {
  const bearerToken = getBearerToken(req);

  if (bearerToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseBrowserEnv();
    const supabase = createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      },
    }) as Awaited<ReturnType<typeof createServerClient>>;

    const { data: { user } } = await supabase.auth.getUser(bearerToken);
    return { supabase, user };
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}
