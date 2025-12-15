import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseBrowserEnv } from "./config";

export async function createClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = getSupabaseBrowserEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f6fe50b5-6abd-4a79-8685-54d1dabba251',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/server.ts:setAll-success',message:'Server cookies set successfully',data:{cookieNames:cookiesToSet.map(c=>c.name),count:cookiesToSet.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
        } catch (err) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/f6fe50b5-6abd-4a79-8685-54d1dabba251',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/server.ts:setAll-error',message:'Server cookie set FAILED (silently caught)',data:{cookieNames:cookiesToSet.map(c=>c.name),error:String(err)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing sessions.
        }
      },
    },
  });
}
