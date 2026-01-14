import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const redirect = requestUrl.searchParams.get("redirect") || "/app";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
  const errorParam = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  console.log("[auth/callback] Starting", {
    hasCode: !!code,
    redirect,
    origin: requestUrl.origin,
    siteUrl,
    host: request.headers.get("host"),
    incomingCookies: request.cookies.getAll().map((c) => c.name),
  });

  // Handle OAuth errors
  if (errorParam) {
    console.error("[auth/callback] OAuth error:", errorParam, errorDescription);
    return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent(errorDescription || errorParam)}`);
  }

  if (code) {
    // Create a redirect response first - we'll add cookies to it
    const redirectUrl = new URL(redirect, siteUrl);
    const response = NextResponse.redirect(redirectUrl);

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          console.log("[auth/callback] setAll called with", cookiesToSet.length, "cookies:", cookiesToSet.map(c => c.name));
          cookiesToSet.forEach(({ name, value, options }) => {
            // Ensure cookies are set with correct options for cross-route access
            // Domain is set to .myteamnetwork.com to work across www and non-www
            response.cookies.set(name, value, {
              ...options,
              path: "/",  // Always use root path for auth cookies
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
              // Let browser use default domain to avoid iOS Safari ITP issues
              domain: undefined,
            });
          });
        },
      },
    });

    console.log("[auth/callback] Exchanging code for session...");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[auth/callback] Exchange error:", error.message);
      return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent(error.message)}`);
    }

    if (data.session) {
      console.log("[auth/callback] Success! User:", data.session.user.id);
      console.log("[auth/callback] Cookies set:", response.cookies.getAll().map((c) => ({
        name: c.name,
        domain: (c as { domain?: string }).domain || "default",
        path: c.path || "/",
        secure: c.secure,
      })));
      console.log("[auth/callback] Redirecting to:", redirectUrl.toString());
      return response;
    }

    console.error("[auth/callback] No session returned");
  }

  return NextResponse.redirect(`${siteUrl}/auth/error`);
}
