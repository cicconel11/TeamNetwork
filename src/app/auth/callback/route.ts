import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { isValidAgeBracket, verifyAgeValidationToken } from "@/lib/auth/age-validation";
import { debugLog, maskPII } from "@/lib/debug";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const redirect = sanitizeRedirectPath(requestUrl.searchParams.get("redirect"));
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
  const errorParam = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  debugLog("auth-callback", "Starting", {
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
          debugLog("auth-callback", "setAll called with", cookiesToSet.length, "cookies:", cookiesToSet.map(c => c.name));
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

    debugLog("auth-callback", "Exchanging code for session...");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[auth/callback] Exchange error:", error.message);
      return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent(error.message)}`);
    }

    if (data.session) {
      debugLog("auth-callback", "Success! User:", maskPII(data.session.user.id));

      // Validate age data for signups only, not logins
      // Detection logic:
      // - If age_bracket in user_metadata → existing validated user → allow through
      // - If age_bracket/age_token query params present → new signup flow → validate
      // - If neither → login flow for pre-age-gate user → allow through
      const userMeta = data.session.user.user_metadata;
      const ageBracket = userMeta?.age_bracket;

      // Check if this is a signup flow with age data in query params
      const oauthAgeBracket = requestUrl.searchParams.get("age_bracket");
      const oauthAgeToken = requestUrl.searchParams.get("age_token");
      const hasAgeQueryParams = oauthAgeBracket || oauthAgeToken;

      if (ageBracket) {
        // User has age_bracket in metadata (existing validated user or email signup confirmation)
        // Trust the stored age_bracket; token verification is only for signup flows.
        if (!isValidAgeBracket(ageBracket)) {
          console.error("[auth/callback] Invalid age bracket in metadata");
          return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`);
        }

        // Block under_13 confirmations
        if (ageBracket === "under_13") {
          debugLog("auth-callback", "Under-13 email confirmation - redirecting to parental consent");
          return NextResponse.redirect(`${siteUrl}/auth/parental-consent`);
        }

        debugLog("auth-callback", "Age validation passed (from metadata)");
      } else if (hasAgeQueryParams) {
        // New signup flow with age data in query params - validate it
        debugLog("auth-callback", "Signup flow detected - validating age params");

        if (!oauthAgeBracket) {
          console.error("[auth/callback] Signup without age validation - missing age_bracket");
          return NextResponse.redirect(
            `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`
          );
        }

        // Validate age bracket value from query params
        if (!isValidAgeBracket(oauthAgeBracket)) {
          console.error("[auth/callback] Invalid age bracket value");
          return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`);
        }

        // Always send under_13 to parental consent for a consistent flow
        if (oauthAgeBracket === "under_13") {
          debugLog("auth-callback", "Under-13 OAuth attempt - redirecting to parental consent");
          return NextResponse.redirect(`${siteUrl}/auth/parental-consent`);
        }

        if (!oauthAgeToken) {
          console.error("[auth/callback] OAuth signup missing age token");
          return NextResponse.redirect(
            `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`
          );
        }

        const tokenResult = verifyAgeValidationToken(oauthAgeToken);
        if (!tokenResult.valid) {
          console.error("[auth/callback] Invalid age token:", tokenResult.error);
          return NextResponse.redirect(
            `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification expired. Please try again.")}`
          );
        }

        if (tokenResult.ageBracket !== oauthAgeBracket) {
          console.error("[auth/callback] Age bracket mismatch between token and query param");
          return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`);
        }

        debugLog("auth-callback", "Age validation passed (from query params)");
      } else {
        // No age data present - could be login or bypassed signup
        // Check if this is a brand new user (created within last 60 seconds)
        // to prevent age gate bypass via direct OAuth
        const createdAt = data.session.user.created_at;
        const isNewUser = createdAt && (Date.now() - new Date(createdAt).getTime()) < 60000;

        if (isNewUser) {
          console.error("[auth/callback] New user signup attempted without age validation - blocking");
          return NextResponse.redirect(
            `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`
          );
        }

        // Pre-age-gate user login - allow through
        debugLog("auth-callback", "Login flow for pre-age-gate user - skipping age validation");
      }
      debugLog("auth-callback", "Cookies set:", response.cookies.getAll().map((c) => ({
        name: c.name,
        domain: (c as { domain?: string }).domain || "default",
        path: c.path || "/",
        secure: c.secure,
      })));
      debugLog("auth-callback", "Redirecting to:", redirectUrl.toString());
      return response;
    }

    console.error("[auth/callback] No session returned");
  }

  return NextResponse.redirect(`${siteUrl}/auth/error`);
}
