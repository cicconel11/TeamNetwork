import { createServiceClient } from "@/lib/supabase/service";
import { hashIp, getClientIp } from "@/lib/compliance/audit-log";

type ResourceType = "member_profile" | "form_submission" | "data_export" | "roster_download";

/**
 * Log an access event to the data_access_log table.
 * Fire-and-forget — never blocks the calling operation.
 *
 * Accepts either a Request object (API routes) or ReadonlyHeaders (Server Components).
 */
export function logDataAccess(params: {
  actorUserId: string;
  resourceType: ResourceType;
  resourceId?: string;
  organizationId?: string;
  request?: Request;
  headers?: { get(name: string): string | null };
}): void {
  void logDataAccessAsync(params);
}

async function logDataAccessAsync(params: {
  actorUserId: string;
  resourceType: ResourceType;
  resourceId?: string;
  organizationId?: string;
  request?: Request;
  headers?: { get(name: string): string | null };
}): Promise<void> {
  try {
    const { actorUserId, resourceType, resourceId, organizationId, request, headers } = params;

    // Extract IP from whichever source is available
    let ipHash: string | null = null;
    let userAgent: string | null = null;

    if (request) {
      const clientIp = getClientIp(request);
      ipHash = clientIp ? hashIp(clientIp) : null;
      userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
    } else if (headers) {
      const xForwardedFor = headers.get("x-forwarded-for");
      const clientIp =
        headers.get("cf-connecting-ip")?.trim() ??
        (xForwardedFor ? xForwardedFor.split(",")[0]?.trim() : null) ??
        headers.get("true-client-ip")?.trim() ??
        headers.get("x-real-ip")?.trim() ??
        null;
      ipHash = clientIp ? hashIp(clientIp) : null;
      userAgent = headers.get("user-agent")?.slice(0, 500) ?? null;
    }

    const serviceClient = createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (serviceClient as any)
      .from("data_access_log")
      .insert({
        actor_user_id: actorUserId,
        resource_type: resourceType,
        resource_id: resourceId ?? null,
        organization_id: organizationId ?? null,
        ip_hash: ipHash,
        user_agent: userAgent,
      });

    if (error) {
      console.error("[audit/data-access] Failed to log:", error);
    }
  } catch (err) {
    console.error("[audit/data-access] Exception:", err);
  }
}
