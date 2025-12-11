import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirect = searchParams.get("redirect") || "/app";
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  console.log("[auth/callback] Starting with code:", code ? "present" : "missing", "redirect:", redirect);

  // Handle OAuth errors (e.g., user denied access)
  if (errorParam) {
    console.error("[auth/callback] OAuth error:", errorParam, errorDescription);
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(errorDescription || errorParam)}`);
  }

  if (code) {
    const cookieStore = await cookies();
    
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignore errors in route handlers
          }
        },
      },
    });
    
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error && data.session) {
      console.log("[auth/callback] Session created for user:", data.session.user.id, data.session.user.email);
      return NextResponse.redirect(`${origin}${redirect}`);
    }
    
    console.error("[auth/callback] Error:", error?.message || "No session returned");
  }

  console.log("[auth/callback] Redirecting to error page");
  return NextResponse.redirect(`${origin}/auth/error`);
}
