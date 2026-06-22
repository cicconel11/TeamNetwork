/**
 * App Review helpers (Apple Guideline 2.1).
 *
 * Apple's reviewer must reach the native Apple Pay Payment Sheet to verify the
 * PassKit integration, but the donation flow is gated by a Turnstile captcha
 * that reviewers routinely cannot pass. The documented review account skips the
 * captcha on iOS; the server (`/api/stripe/create-donation`) only honors the
 * sentinel token below for an allowlisted reviewer identity, so this is safe.
 *
 * Default-closed: when `EXPO_PUBLIC_APP_REVIEW_EMAIL` is unset, no account is
 * treated as a reviewer and the captcha shows for everyone.
 */

const APP_REVIEW_EMAIL =
  process.env.EXPO_PUBLIC_APP_REVIEW_EMAIL?.trim().toLowerCase() || "";

/**
 * Captcha token sent in place of a real Turnstile token for the App Review
 * account. Harmless for anyone else: the server still verifies the captcha for
 * non-allowlisted callers, and this token fails that verification.
 */
export const APP_REVIEW_CAPTCHA_TOKEN = "app-review-bypass";

/** True when `email` is the configured App Review account (case-insensitive). */
export function isAppReviewEmail(email: string | null | undefined): boolean {
  if (!APP_REVIEW_EMAIL) return false;
  return (email ?? "").trim().toLowerCase() === APP_REVIEW_EMAIL;
}
