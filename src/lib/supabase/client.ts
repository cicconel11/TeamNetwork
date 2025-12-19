import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserEnv } from "./config";

// Singleton pattern to ensure consistent auth state across the app
// The browser client uses cookies for storage, but having a single instance
// ensures the in-memory auth state listener is consistent
let browserClient: SupabaseClient | null = null;

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseBrowserEnv();
  
  // Return existing client if already created (singleton pattern)
  if (browserClient) {
    return browserClient;
  }
  
  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      domain: process.env.NODE_ENV === "production" ? ".myteamnetwork.com" : undefined,
    },
  });
  
  // Log auth state changes for debugging
  browserClient.auth.onAuthStateChange((event, session) => {
    console.log("[supabase/client] Auth state changed:", event, session?.user?.id?.slice(0, 8) || "no-user");
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f6fe50b5-6abd-4a79-8685-54d1dabba251',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'supabase/client.ts:onAuthStateChange',message:'Browser auth state changed',data:{event,hasSession:!!session,userId:session?.user?.id,provider:session?.user?.app_metadata?.provider,expiresAt:session?.expires_at},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
  });
  
  return browserClient;
}
