import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireEnv } from "@/lib/env";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { isValidAgeBracket, verifyAgeValidationToken } from "@/lib/auth/age-validation";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const redirect = sanitizeRedirectPath(requestUrl.searchParams.get("redirect"));
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

      // Validate age data for both OAuth signups and email confirmations
      const userMeta = data.session.user.user_metadata;
      const ageBracket = userMeta?.age_bracket;
      const ageToken = userMeta?.age_validation_token;

      // Check if age_bracket exists
      if (!ageBracket) {
        // Check query params for OAuth flow (age data passed via queryParams)
        const oauthAgeBracket = requestUrl.searchParams.get("age_bracket");
        const oauthAgeToken = requestUrl.searchParams.get("age_token");

        if (!oauthAgeToken) {
          console.error("[auth/callback] OAuth signup missing age token");
          return NextResponse.redirect(
            `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`
          );
        }

        if (!oauthAgeBracket) {
          console.error("[auth/callback] Signup without age validation - missing age_bracket");
          return NextResponse.redirect(
            `${siteUrl}/auth/signup?error=${encodeURIComponent("Age verification required. Please complete the signup process.")}`
          );
        }

        // Validate age bracket value from query params
        if (!isValidAgeBracket(oauthAgeBracket)) {
          console.error("[auth/callback] Invalid age bracket value:", oauthAgeBracket);
          return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`);
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

        // Block under_13 signups (parental consent not implemented yet)
        if (tokenResult.ageBracket === "under_13") {
          console.log("[auth/callback] Under-13 OAuth attempt - redirecting to parental consent");
          return NextResponse.redirect(`${siteUrl}/auth/parental-consent`);
        }
      } else {
        // Age bracket exists in user metadata (email signup confirmation)
        if (!isValidAgeBracket(ageBracket)) {
          console.error("[auth/callback] Invalid age bracket in metadata:", ageBracket);
          return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`);
        }

        // Verify the token if provided (for email signups)
        if (ageToken) {
          const tokenResult = verifyAgeValidationToken(ageToken);
          if (!tokenResult.valid) {
            console.error("[auth/callback] Invalid age token in metadata:", tokenResult.error);
            if (tokenResult.error === "Token expired") {
              // Token expired is expected for email confirmations (user may confirm hours later)
              // Just log and continue - the age_bracket itself is still valid
              console.log("[auth/callback] Age token expired but age_bracket present, continuing");
            } else {
              return NextResponse.redirect(`${siteUrl}/auth/error?message=${encodeURIComponent("Invalid age data")}`);
            }
          }
        }

        // Block under_13 confirmations
        if (ageBracket === "under_13") {
          console.log("[auth/callback] Under-13 email confirmation - redirecting to parental consent");
          return NextResponse.redirect(`${siteUrl}/auth/parental-consent`);
        }
      }

      console.log("[auth/callback] Age validation passed");
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
