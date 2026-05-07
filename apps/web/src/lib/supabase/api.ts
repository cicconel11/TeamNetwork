import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";
import { getSupabaseBrowserEnv } from "./config";
import type { ServerSupabase } from "./types";

/**
 * Build a request-scoped Supabase client honoring either Bearer token (mobile)
 * or cookies (web). Returns `user: null` on missing/invalid auth — callers
 * should respond 401 in that case.
 */
export async function createAuthenticatedApiClient(
  req: Request,
): Promise<{ supabase: ServerSupabase; user: User | null }> {
  const auth = req.headers.get("authorization");
  const match = auth?.match(/^Bearer (.+)$/);

  if (match) {
    const token = match[1];
    const { supabaseUrl, supabaseAnonKey } = getSupabaseBrowserEnv();
    const client = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });
    const { data, error } = await client.auth.getUser(token);
    return {
      supabase: client as unknown as ServerSupabase,
      user: error ? null : data.user,
    };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}
