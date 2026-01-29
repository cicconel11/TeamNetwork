/**
 * Dev-Admin System
 *
 * Provides super-admin access for developers to debug and fix issues
 * across all organizations without appearing in member lists.
 *
 * Dev-admins can:
 * - View all org data (members, events, billing, etc.)
 * - Trigger certain admin actions (reconcile, billing portal, delete orgs)
 * - See Stripe subscription details
 *
 * Dev-admins cannot:
 * - Edit org data (for now)
 * - Start new checkouts on behalf of orgs
 * - Cancel subscriptions
 *
 * Dev-admins are:
 * - Hidden from member lists
 * - Identified by a visual indicator in the nav
 * - Logged when taking admin actions (with redacted emails for privacy)
 *
 * Configuration:
 * - Set DEV_ADMIN_EMAILS environment variable as comma-separated list
 * - Example: DEV_ADMIN_EMAILS="admin1@example.com,admin2@example.com"
 */

/**
 * Get dev-admin emails from environment variable
 * Emails are stored as comma-separated values in DEV_ADMIN_EMAILS
 */
function loadDevAdminEmails(): string[] {
  const envValue = process.env.DEV_ADMIN_EMAILS;
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

/**
 * Redact email for logging (show first 2 chars + domain)
 * e.g., "john@example.com" -> "jo***@example.com"
 */
export function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const redactedLocal = local.slice(0, 2) + "***";
  return `${redactedLocal}@${domain}`;
}

/**
 * Check if an email belongs to a dev-admin
 */
export function isDevAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const devAdminEmails = loadDevAdminEmails();
  return devAdminEmails.some(
    (devEmail) => devEmail === email.toLowerCase()
  );
}

/**
 * Check if a user object represents a dev-admin
 */
export function isDevAdmin(user: { email?: string | null } | null | undefined): boolean {
  return isDevAdminEmail(user?.email);
}

/**
 * Get list of dev-admin emails (for queries that need to exclude them)
 */
export function getDevAdminEmails(): string[] {
  return loadDevAdminEmails();
}

/**
 * Actions that dev-admins are allowed to perform
 */
export type DevAdminAction =
  | "view_org"
  | "view_members"
  | "view_billing"
  | "reconcile_subscription"
  | "open_billing_portal"
  | "delete_org"
  | "view_stripe_details";

/**
 * Actions that dev-admins are NOT allowed to perform
 */
export type RestrictedAction =
  | "edit_org"
  | "start_checkout"
  | "cancel_subscription"
  | "create_member"
  | "edit_member";

/**
 * Check if a dev-admin can perform a specific action
 */
export function canDevAdminPerform(
  user: { email?: string | null } | null | undefined,
  action: DevAdminAction | RestrictedAction
): boolean {
  if (!isDevAdmin(user)) return false;
  const allowedActions: DevAdminAction[] = [
    "view_org",
    "view_members",
    "view_billing",
    "reconcile_subscription",
    "open_billing_portal",
    "delete_org",
    "view_stripe_details",
  ];
  return allowedActions.includes(action as DevAdminAction);
}

/**
 * Log a dev-admin action (for audit purposes)
 * Currently a no-op; can be extended to write to DB or external logging service
 * Email is redacted in logs for privacy
 */
export function logDevAdminAction(
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  userEmail: string,
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  action: string,
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  details?: Record<string, unknown>
): void {
  // No-op: audit logging should be implemented via DB or external service
}
