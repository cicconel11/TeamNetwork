import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseBrowserEnv } from "./config";

export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = getSupabaseBrowserEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      domain: undefined,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Add domain for production to ensure cookies work across www and non-www
            const cookieOptions = {
              ...options,
              path: options.path ?? "/",
              domain: undefined,
            };
            cookieStore.set(name, value, cookieOptions);

            // Legacy cleanup: Ensure we clear cookies on the root domain if they exist
            if (process.env.NODE_ENV === "production" && value === "") {
               try {
                 cookieStore.set(name, "", {
                   ...cookieOptions,
                   domain: ".myteamnetwork.com",
                   maxAge: 0,
                 });
               } catch {
                 // Ignore errors if we can't set multiple cookies
               }
            }
          });
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing sessions.
        }
      },
    },
  });
}
