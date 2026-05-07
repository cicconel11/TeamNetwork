/**
 * Friction feedback from FeedbackButton on pages where the user may not be signed in.
 * Keep this list aligned with FeedbackButton usage on auth/onboarding UIs.
 */
const ANONYMOUS_FRICTION_KEYS = new Set([
  "login:login_error",
  "signup:signup_error",
  "signup:age_gate_error",
]);

export function isAnonymousFrictionAllowed(context: string, trigger: string): boolean {
  return ANONYMOUS_FRICTION_KEYS.has(`${context}:${trigger}`);
}
