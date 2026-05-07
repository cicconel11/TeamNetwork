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

import { createServiceClient } from "@/lib/supabase/service";
import { hashIp } from "@/lib/compliance/audit-log";

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
  | "view_enterprise"
  | "reconcile_subscription"
  | "open_billing_portal"
  | "delete_org"
  | "view_stripe_details"
  | "manage_error_groups";

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
    "view_enterprise",
    "reconcile_subscription",
    "open_billing_portal",
    "delete_org",
    "view_stripe_details",
    "manage_error_groups",
  ];
  return allowedActions.includes(action as DevAdminAction);
}

/**
 * Resolve the appropriate Supabase client for data queries.
 * Dev-admins get a service client (bypasses RLS), others keep the regular client.
 */
export function resolveDataClient<T>(
  user: { email?: string | null } | null | undefined,
  regularClient: T,
  action: DevAdminAction
): T {
  if (!canDevAdminPerform(user, action)) return regularClient;
  try {
    return createServiceClient() as unknown as T;
  } catch (error) {
    console.warn("DevAdmin: Failed to create service client (missing key?)", error);
    return regularClient;
  }
}

/**
 * Audit log entry for dev-admin actions
 */
export interface DevAdminAuditLogEntry {
  adminUserId: string;
  adminEmail: string;
  action: DevAdminAction;
  targetType?: "organization" | "member" | "subscription" | "billing" | "enterprise" | "error_group";
  targetId?: string;
  targetSlug?: string;
  requestPath?: string;
  requestMethod?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface MiddlewareAuditInput {
  userId: string;
  userEmail: string;
  action: "view_org" | "view_enterprise";
  targetSlug: string;
  pathname: string;
  method: string;
  headers: Headers;
}

/**
 * Extract request context for audit logging
 */
export function extractRequestContext(req: Request): {
  requestPath: string;
  requestMethod: string;
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  const url = new URL(req.url);
  return {
    requestPath: url.pathname,
    requestMethod: req.method,
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
}

export function createMiddlewareAuditEntry(
  input: MiddlewareAuditInput
): DevAdminAuditLogEntry | null {
  if (!isDevAdminEmail(input.userEmail)) return null;
  return {
    adminUserId: input.userId,
    adminEmail: input.userEmail,
    action: input.action,
    targetType: input.action === "view_enterprise" ? "enterprise" : "organization",
    targetSlug: input.targetSlug,
    requestPath: input.pathname,
    requestMethod: input.method,
    ipAddress:
      input.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      input.headers.get("x-real-ip") ??
      undefined,
    userAgent: input.headers.get("user-agent") ?? undefined,
    metadata: { source: "middleware" },
  };
}

/**
 * Log a dev-admin action (for audit purposes)
 * Fire-and-forget: returns immediately, logging happens asynchronously
 * Email is redacted in logs for privacy
 */
export function logDevAdminAction(entry: DevAdminAuditLogEntry): void {
  // Fire-and-forget: call async but don't await
  void fireAndForgetDevAdminAudit(entry);
}

export async function fireAndForgetDevAdminAudit(
  entry: DevAdminAuditLogEntry,
  writer: (entry: DevAdminAuditLogEntry) => Promise<void> = writeDevAdminAuditLog
): Promise<void> {
  try {
    await writer(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Edge runtime cannot use Node crypto — audit writes from middleware silently skip.
    if (message.includes("edge runtime does not support")) return;
    console.error("[dev-admin-audit] Failed to log:", { action: entry.action, error: message });
  }
}

export async function writeDevAdminAuditLog(
  entry: DevAdminAuditLogEntry,
  createServiceClientFn: typeof createServiceClient = createServiceClient
): Promise<void> {
  const serviceSupabase = createServiceClientFn();
  // Cast to bypass type checking since the table may not be in generated types yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (serviceSupabase as any)
    .from("dev_admin_audit_logs")
    .insert({
      admin_user_id: entry.adminUserId,
      admin_email_redacted: redactEmail(entry.adminEmail),
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      target_slug: entry.targetSlug ?? null,
      request_path: entry.requestPath ?? null,
      request_method: entry.requestMethod ?? null,
      ip_address: entry.ipAddress ? hashIp(entry.ipAddress) : null,
      user_agent: entry.userAgent?.slice(0, 500) ?? null,
      metadata: entry.metadata ?? {},
    });
  if (error) throw error;
}
