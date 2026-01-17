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
 * - Logged when taking admin actions (future enhancement)
 */

// Hardcoded allowlist of dev-admin emails
// Add emails here to grant dev-admin access
const DEV_ADMIN_EMAILS: string[] = [
  "mleonard1616@gmail.com",
  "lociccone11@gmail.com",
];

/**
 * Check if an email belongs to a dev-admin
 */
export function isDevAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return DEV_ADMIN_EMAILS.some(
    (devEmail) => devEmail.toLowerCase() === email.toLowerCase()
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
  return [...DEV_ADMIN_EMAILS];
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
 * Currently just logs to console; can be extended to write to DB
 */
export function logDevAdminAction(
  userEmail: string,
  action: string,
  details?: Record<string, unknown>
): void {
  console.log(`[DEV-ADMIN] ${userEmail} performed "${action}"`, details ?? {});
}
