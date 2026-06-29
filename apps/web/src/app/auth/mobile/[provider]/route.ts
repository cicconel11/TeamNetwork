import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { MICROSOFT_SSO_PROVIDER } from "@/lib/microsoft/sso-config";
import {
  buildMobileAuthCallbackUrl,
  buildMobileErrorDeepLink,
  isMobileAuthMode,
  mapMobileOAuthProvider,
} from "@/lib/auth/mobile-oauth";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

/**
 * Mobile OAuth initiation.
 *
 * The native app opens `{web}/auth/mobile/{provider}?mode=...` in an in-app
 * browser. We server-initiate the Supabase OAuth flow with `redirectTo` pointed
 * at `/auth/callback?mobile=1`, persisting the PKCE verifier cookie onto the
 * redirect so the callback can exchange the code. The callback then mints a
 * one-time handoff code and deep-links back to `teammeet://callback`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const supabaseProvider = mapMobileOAuthProvider(provider);
  if (!supabaseProvider) {
    return NextResponse.redirect(
      buildMobileErrorDeepLink("unsupported_provider", `Unsupported provider: ${provider}`)
    );
  }

  const requestUrl = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
  const modeParam = requestUrl.searchParams.get("mode");
  const mode = isMobileAuthMode(modeParam) ? modeParam : "login";

  const callbackUrl = buildMobileAuthCallbackUrl(siteUrl, {
    mode,
    redirect: sanitizeRedirectPath(requestUrl.searchParams.get("redirect")),
    ageBracket: requestUrl.searchParams.get("age_bracket"),
    isMinor: requestUrl.searchParams.get("is_minor"),
    ageToken: requestUrl.searchParams.get("age_token"),
  });

  // Collect cookies Supabase sets during signInWithOAuth (the PKCE verifier) so
  // we can attach them to the redirect that sends the browser to the provider.
  const pendingCookies: { name: string; value: string; options?: Record<string, unknown> }[] = [];
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: supabaseProvider,
    options: {
      redirectTo: callbackUrl,
      skipBrowserRedirect: true,
      ...(supabaseProvider === MICROSOFT_SSO_PROVIDER && { scopes: "openid profile email" }),
    },
  });

  if (error || !data?.url) {
    console.error("[auth/mobile] signInWithOAuth failed:", error?.message);
    return NextResponse.redirect(
      buildMobileErrorDeepLink("oauth_init_failed", error?.message ?? "Could not start sign-in.")
    );
  }

  const response = NextResponse.redirect(data.url);
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, {
      ...options,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      domain: undefined,
    });
  }
  return response;
}
