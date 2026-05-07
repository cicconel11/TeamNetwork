import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import { sanitizeRecoveryNextParam } from "@/lib/auth/redirect";
import { buildErrorRedirect } from "@/lib/auth/callback-flow";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

type RecoveryServerClientFactory = typeof createServerClient;

/**
 * Exchanges email OTP / recovery `token_hash` for a session (no PKCE verifier required).
 * Password reset emails must link here with `token_hash` and `type=recovery` (see recovery template).
 */
export function createRecoveryConfirmHandler(
  createServerClientImpl: RecoveryServerClientFactory = createServerClient
) {
  return async function GET(request: NextRequest) {
    const requestUrl = new URL(request.url);
    const token_hash = requestUrl.searchParams.get("token_hash");
    const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;
    const nextPath = sanitizeRecoveryNextParam(requestUrl.searchParams.get("next"));

    const redirectUrl = new URL(nextPath, siteUrl);
    const response = NextResponse.redirect(redirectUrl);

    if (!token_hash || !type) {
      return NextResponse.redirect(
        buildErrorRedirect(
          siteUrl,
          "This reset link is invalid or has expired. Please request a new password reset.",
          null,
          null
        )
      );
    }

    const supabase = createServerClientImpl(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, {
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

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });

    if (error) {
      return NextResponse.redirect(
        buildErrorRedirect(
          siteUrl,
          error.message ||
            "This reset link is invalid or has expired. Please request a new password reset.",
          null,
          null
        )
      );
    }

    return response;
  };
}
