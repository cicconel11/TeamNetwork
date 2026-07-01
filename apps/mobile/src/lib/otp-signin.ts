import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";

// Login-only email-code (OTP) sign-in for existing users who have no password
// and no social identity (magic-link users). This path MUST NEVER create an
// account: `shouldCreateUser: false` is the load-bearing security invariant.
// It deliberately avoids the web LoginClient silent-auto-provision behavior.

// Enumeration-safe copy: shown on the request step regardless of whether the
// email is on file, and reused for the `shouldCreateUser: false` "no account"
// error so we never reveal account existence (no enumeration oracle).
const REQUEST_GENERIC_MESSAGE =
  "If your email is on file, we sent an 8-digit code. Check your inbox.";
const RATE_LIMITED_MESSAGE =
  "Too many attempts. Please wait a moment and try again.";
const REQUEST_ERROR_MESSAGE = "We couldn't send a code. Please try again.";
const VERIFY_INVALID_MESSAGE =
  "That code didn't work. Please try again or resend.";
const VERIFY_ERROR_MESSAGE = "Something went wrong. Please try again.";

export type RequestLoginCodeResult =
  // "sent" is returned for BOTH real accounts and unknown emails so the caller
  // renders identical UI — closing the enumeration oracle.
  | { kind: "sent"; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

export type VerifyLoginCodeResult =
  | { kind: "success" }
  | { kind: "invalid-code"; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

type SupabaseAuthError = {
  message: string;
  status?: number;
  code?: string;
};

const isRateLimited = (error: SupabaseAuthError): boolean => {
  const code = error.code ?? "";
  return (
    error.status === 429 ||
    /rate.?limit/i.test(code) ||
    /rate.?limit/i.test(error.message)
  );
};

// A `shouldCreateUser: false` request for an email with no account surfaces as
// a user-not-found / signup-disabled error. We map it to the SAME generic
// "sent" result so the response is indistinguishable from a real send.
const isNoAccount = (error: SupabaseAuthError): boolean => {
  const code = error.code ?? "";
  return (
    error.status === 422 ||
    /user.?not.?found/i.test(code) ||
    /signups?.not.allowed/i.test(code) ||
    /otp.disabled/i.test(code) ||
    /user.*not.*found/i.test(error.message) ||
    /signups?.not.allowed/i.test(error.message)
  );
};

/**
 * Request a login OTP code for an existing account.
 *
 * `shouldCreateUser: false` guarantees this NEVER provisions an account. The
 * result is enumeration-safe: unknown emails and rate-limit-free sends both
 * return `kind: "sent"` with identical copy.
 */
export async function requestLoginCode(
  email: string,
  captchaToken: string,
): Promise<RequestLoginCodeResult> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        captchaToken,
        // SECURITY INVARIANT: login-only. Never create an account here.
        shouldCreateUser: false,
      },
    });

    if (error) {
      const authError = error as SupabaseAuthError;
      if (isRateLimited(authError)) {
        return { kind: "rate-limited", message: RATE_LIMITED_MESSAGE };
      }
      // No account for this email → return the SAME generic "sent" copy.
      // Do not reveal that the account is missing (enumeration-safe).
      if (isNoAccount(authError)) {
        return { kind: "sent", message: REQUEST_GENERIC_MESSAGE };
      }
      captureException(new Error(authError.message), {
        screen: "OtpSignIn",
        step: "request",
      });
      return { kind: "error", message: REQUEST_ERROR_MESSAGE };
    }

    return { kind: "sent", message: REQUEST_GENERIC_MESSAGE };
  } catch (e) {
    captureException(e as Error, { screen: "OtpSignIn", step: "request" });
    return { kind: "error", message: REQUEST_ERROR_MESSAGE };
  }
}

/**
 * Verify a login OTP code. On success the Supabase client sets the session and
 * the root layout redirects to `/(app)` — the helper does nothing further (no
 * getUser, no assertEmailConfirmed, no claim RPC).
 */
export async function verifyLoginCode(
  email: string,
  token: string,
): Promise<VerifyLoginCodeResult> {
  try {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) {
      const authError = error as SupabaseAuthError;
      if (isRateLimited(authError)) {
        return { kind: "rate-limited", message: RATE_LIMITED_MESSAGE };
      }
      // Invalid or expired code — re-requestable. Not captured as an
      // exception: it is an expected user-input error, not a system fault.
      return { kind: "invalid-code", message: VERIFY_INVALID_MESSAGE };
    }

    return { kind: "success" };
  } catch (e) {
    captureException(e as Error, { screen: "OtpSignIn", step: "verify" });
    return { kind: "error", message: VERIFY_ERROR_MESSAGE };
  }
}
