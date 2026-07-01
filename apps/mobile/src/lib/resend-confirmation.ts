import { supabase } from "@/lib/supabase";
import { captureException } from "@/lib/analytics";

/**
 * Result of a signup-confirmation resend attempt.
 *
 * Copy is intentionally generic on success: it never reveals whether the email
 * belongs to an account or whether that account still needs confirmation, so
 * the response cannot be used as an email-enumeration oracle.
 */
export type ResendConfirmationResult =
  | { status: "success"; message: string }
  | { status: "rate-limited"; message: string }
  | { status: "error"; message: string };

// Generic — same string whether or not the email is on file / already confirmed.
const SUCCESS_MESSAGE =
  "If your account needs confirmation, we've sent a new link. Please check your email.";
const RATE_LIMITED_MESSAGE =
  "Too many attempts. Please wait a moment and try again.";
const ERROR_MESSAGE = "We couldn't send a new link. Please try again.";

function isRateLimited(error: { status?: number; code?: string; message: string }): boolean {
  const status = error.status;
  const code = error.code ?? "";
  return status === 429 || /rate.?limit/i.test(code) || /rate.?limit/i.test(error.message);
}

/**
 * Resend the signup confirmation email for `email`.
 *
 * Wraps `supabase.auth.resend({ type: "signup" })`. Returns a discriminated
 * result with user-safe copy. Rate limits map to a distinct, non-alarming
 * message; every other failure is reported to Sentry (via captureException)
 * and surfaced as a generic error. Never throws.
 *
 * @param captchaToken Optional Turnstile token when the project requires a
 *   captcha on resend; passed through to Supabase when present.
 */
export async function resendSignupConfirmation(
  email: string,
  captchaToken?: string,
): Promise<ResendConfirmationResult> {
  try {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: captchaToken ? { captchaToken } : undefined,
    });

    if (error) {
      if (isRateLimited(error as { status?: number; code?: string; message: string })) {
        return { status: "rate-limited", message: RATE_LIMITED_MESSAGE };
      }
      captureException(new Error(error.message), {
        screen: "Login",
        method: "resend_confirmation",
      });
      return { status: "error", message: ERROR_MESSAGE };
    }

    return { status: "success", message: SUCCESS_MESSAGE };
  } catch (e) {
    captureException(e as Error, { screen: "Login", method: "resend_confirmation" });
    return { status: "error", message: ERROR_MESSAGE };
  }
}
