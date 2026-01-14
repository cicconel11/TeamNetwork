import { createServiceClient } from "@/lib/supabase/service";
import { redactEmail } from "@/lib/auth/dev-admin";

export interface EnterpriseAuditEntry {
  actorUserId: string;
  actorEmail: string;
  action: string;
  enterpriseId: string;
  targetType?: string;
  targetId?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
  requestPath?: string;
  requestMethod?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Extract request context for audit logging.
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

/**
 * Log an enterprise audit action.
 * Fire-and-forget: returns immediately, logging happens asynchronously.
 */
export function logEnterpriseAuditAction(entry: EnterpriseAuditEntry): void {
  logEnterpriseAuditActionAsync(entry).catch((error) => {
    console.error("[enterprise-audit] Failed to log:", {
      action: entry.action,
      enterpriseId: entry.enterpriseId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  });
}

/**
 * Log an enterprise audit action and await completion.
 * Use this when the result must be confirmed before proceeding.
 */
export async function logEnterpriseAuditActionAwaited(
  entry: EnterpriseAuditEntry
): Promise<void> {
  await logEnterpriseAuditActionAsync(entry);
}

async function logEnterpriseAuditActionAsync(
  entry: EnterpriseAuditEntry
): Promise<void> {
  const serviceSupabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (serviceSupabase as any)
    .from("enterprise_audit_logs")
    .insert({
      actor_user_id: entry.actorUserId,
      actor_email_redacted: redactEmail(entry.actorEmail),
      action: entry.action,
      enterprise_id: entry.enterpriseId,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      organization_id: entry.organizationId ?? null,
      request_path: entry.requestPath ?? null,
      request_method: entry.requestMethod ?? null,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent?.slice(0, 500) ?? null,
      metadata: entry.metadata ?? {},
    });
  if (error) throw error;
}
