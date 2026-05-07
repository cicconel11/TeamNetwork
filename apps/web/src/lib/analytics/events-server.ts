import { createServiceClient } from "@/lib/supabase/service";
import type { OpsEventName } from "./events";

/**
 * Server-only ops event tracker. Uses the service client so it can be called
 * from Node.js API routes. Do NOT import this in "use client" modules or
 * Edge runtime (middleware) — use trackOpsEvent() from events.ts for browser
 * code and the ?auth_expired param pattern for middleware.
 */
export async function trackOpsEventServer(
  event_name: OpsEventName,
  props: {
    endpoint_group?: string;
    http_status?: number;
    error_code?: string;
    retryable?: boolean;
  } = {},
  orgId?: string | null,
): Promise<void> {
  try {
    const supabase = createServiceClient();

    const payload = {
      p_org_id: orgId ?? null,
      p_session_id: "server",
      p_client_day: new Date().toISOString().slice(0, 10),
      p_platform: "web",
      p_device_class: "desktop",
      p_app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
      p_route: null,
      p_event_name: event_name,
      p_endpoint_group: props.endpoint_group ?? null,
      p_http_status: props.http_status ?? null,
      p_error_code: props.error_code ?? null,
      p_retryable: props.retryable ?? null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)("log_ops_event", payload);
  } catch {
    // Fire-and-forget — never let telemetry failures propagate to callers.
  }
}
