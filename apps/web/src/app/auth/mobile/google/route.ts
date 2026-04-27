import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";
import {
  buildMobileAuthCallbackUrl,
  buildMobileErrorDeepLink,
  isMobileAuthMode,
} from "@/lib/auth/mobile-oauth";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
  const modeParam = requestUrl.searchParams.get("mode");

  if (!isMobileAuthMode(modeParam)) {
    return NextResponse.redirect(buildMobileErrorDeepLink("invalid_request", "Invalid mobile auth mode."));
  }

  const cookieResponse = NextResponse.next();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieResponse.cookies.set(name, value, {
            ...options,
            path: "/",
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            domain: undefined,
          });
        });
      },
    },
  });

  const redirectTo = buildMobileAuthCallbackUrl(siteUrl, {
    mode: modeParam,
    redirect: requestUrl.searchParams.get("redirect"),
    ageBracket: requestUrl.searchParams.get("age_bracket"),
    isMinor: requestUrl.searchParams.get("is_minor"),
    ageToken: requestUrl.searchParams.get("age_token"),
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      buildMobileErrorDeepLink("oauth_start_failed", error?.message || "Could not start Google sign in.")
    );
  }

  const response = NextResponse.redirect(data.url);
  cookieResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });
  return response;
}
