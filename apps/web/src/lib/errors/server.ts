import { createServiceClient } from "@/lib/supabase/service";
import { generateFingerprint } from "@/lib/telemetry/fingerprint";
import type { ErrorSeverity, ErrorEnv } from "@/lib/schemas/errors";
import { checkAndNotify } from "./notify";

// Note: These tables/functions are defined in the migration but types need regeneration.
// After running `supabase db push` and `supabase gen types`, these type assertions can be removed.

export interface CaptureErrorParams {
  name?: string;
  message: string;
  stack?: string;
  route?: string;
  apiPath?: string;
  userId?: string | null;
  sessionId?: string | null;
  severity?: ErrorSeverity;
  env?: ErrorEnv;
  meta?: Record<string, unknown>;
}

interface CaptureResult {
  success: boolean;
  groupId?: string;
  fingerprint?: string;
  error?: string;
}

/**
 * Capture a server-side error.
 *
 * This function:
 * 1. Generates a stable fingerprint for error grouping
 * 2. Upserts the error group (atomic increment via PostgreSQL function)
 * 3. Inserts individual error event (fire-and-forget)
 * 4. Triggers notification check (async, non-blocking)
 */
export async function captureServerError(params: CaptureErrorParams): Promise<CaptureResult> {
  const {
    name = "Error",
    message,
    stack,
    route,
    apiPath,
    userId,
    sessionId,
    severity = "medium",
    env = getEnv(),
    meta = {},
  } = params;

  try {
    // Generate fingerprint for grouping
    const { fingerprint, title, normalizedMessage, topFrame } = generateFingerprint({
      name,
      message,
      stack,
      route: route || apiPath,
    });

    // Build sample event for storage
    const sampleEvent = {
      name,
      message,
      normalizedMessage,
      stack: stack?.slice(0, 5000), // Truncate for storage
      route,
      apiPath,
      topFrame,
      userId,
      sessionId,
      severity,
      meta,
      capturedAt: new Date().toISOString(),
    };

    const supabase = createServiceClient();

    // Upsert error group using atomic PostgreSQL function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: groupId, error: upsertError } = await (supabase.rpc as any)("upsert_error_group", {
      p_fingerprint: fingerprint,
      p_title: title,
      p_severity: severity,
      p_env: env,
      p_sample_event: sampleEvent,
    });

    if (upsertError) {
      console.error("[error-capture] Failed to upsert error group:", upsertError);
      return { success: false, error: upsertError.message };
    }

    const gid = groupId as string;

    // Insert error event (fire-and-forget, don't await)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from as any)("error_events")
      .insert({
        group_id: gid,
        env,
        user_id: userId || null,
        session_id: sessionId || null,
        route: route || null,
        api_path: apiPath || null,
        message,
        stack: stack?.slice(0, 10000) || null,
        meta,
      })
      .then(({ error }: { error: Error | null }) => {
        if (error) {
          console.error("[error-capture] Failed to insert error event:", error);
        }
      });

    // Trigger notification check (async, non-blocking)
    checkAndNotify(gid).catch((err) => {
      console.error("[error-capture] Notification check failed:", err);
    });

    return {
      success: true,
      groupId: gid,
      fingerprint,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[error-capture] Unexpected error:", errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Capture an error from a caught exception
 */
export function captureException(
  error: unknown,
  context?: Omit<CaptureErrorParams, "name" | "message" | "stack">
): Promise<CaptureResult> {
  if (error instanceof Error) {
    return captureServerError({
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...context,
    });
  }

  return captureServerError({
    name: "UnknownError",
    message: String(error),
    ...context,
  });
}

function getEnv(): ErrorEnv {
  const vercelEnv = process.env.VERCEL_ENV;

  // VERCEL_ENV is most specific - check first
  // In preview deployments, NODE_ENV is "production" but VERCEL_ENV is "preview"
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "staging";

  // Fallback to NODE_ENV for local development
  if (process.env.NODE_ENV === "production") return "production";
  return "development";
}
