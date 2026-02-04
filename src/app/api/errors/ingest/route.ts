import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { errorIngestRequestSchema, type ErrorEnv } from "@/lib/schemas/errors";
import { generateFingerprint } from "@/lib/telemetry/fingerprint";
import { checkAndNotify } from "@/lib/errors/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MINUTE_MS = 60_000;

export async function POST(request: Request) {
  try {
    // Rate limit: 50/min per IP, 100/min per user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "error ingestion",
      limitPerIp: 50,
      limitPerUser: 100,
      windowMs: MINUTE_MS,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    // Validate request body
    const body = await validateJson(request, errorIngestRequestSchema, {
      maxBodyBytes: 100_000, // 100KB for batched errors
    });

    const { events, sessionId, env: clientEnv } = body;
    const userId = user?.id || null;
    const env = clientEnv || getEnv();

    const serviceSupabase = createServiceClient();
    const processed: string[] = [];
    const errors: string[] = [];

    // Process each error event
    for (const event of events) {
      try {
        const result = await processErrorEvent({
          supabase: serviceSupabase,
          event,
          userId,
          sessionId: sessionId || null,
          env,
        });

        if (result.success) {
          processed.push(result.fingerprint!);
        } else {
          errors.push(result.error || "Unknown error");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        console.error("[errors/ingest] Error processing event:", msg);
      }
    }

    return NextResponse.json(
      {
        success: errors.length === 0,
        processed: processed.length,
        errors: errors.length > 0 ? errors : undefined,
      },
      {
        status: errors.length === events.length ? 500 : 200,
        headers: rateLimit.headers,
      }
    );
  } catch (err) {
    console.error("[errors/ingest] Error:", err);

    if (err instanceof ValidationError) {
      return validationErrorResponse(err);
    }

    return NextResponse.json(
      { error: "Failed to process errors" },
      { status: 500 }
    );
  }
}

interface ProcessEventParams {
  supabase: ReturnType<typeof createServiceClient>;
  event: {
    name?: string;
    message: string;
    stack?: string;
    route?: string;
    apiPath?: string;
    severity?: string;
    meta?: Record<string, unknown>;
  };
  userId: string | null;
  sessionId: string | null;
  env: ErrorEnv;
}

interface ProcessEventResult {
  success: boolean;
  fingerprint?: string;
  groupId?: string;
  error?: string;
}

async function processErrorEvent(params: ProcessEventParams): Promise<ProcessEventResult> {
  const { supabase, event, userId, sessionId, env } = params;

  const name = event.name || "Error";
  const severity = event.severity || "medium";

  // Generate fingerprint
  const { fingerprint, title, normalizedMessage, topFrame } = generateFingerprint({
    name,
    message: event.message,
    stack: event.stack,
    route: event.route || event.apiPath,
  });

  // Build sample event for storage
  const sampleEvent = {
    name,
    message: event.message,
    normalizedMessage,
    stack: event.stack?.slice(0, 5000),
    route: event.route,
    apiPath: event.apiPath,
    topFrame,
    userId,
    sessionId,
    severity,
    meta: event.meta || {},
    capturedAt: new Date().toISOString(),
  };

  // Upsert error group
  // Note: error_groups/error_events tables defined in migration, types need regeneration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: groupId, error: upsertError } = await (supabase.rpc as any)("upsert_error_group", {
    p_fingerprint: fingerprint,
    p_title: title,
    p_severity: severity,
    p_env: env,
    p_sample_event: sampleEvent,
  });

  if (upsertError) {
    console.error("[errors/ingest] Failed to upsert group:", upsertError);
    return { success: false, error: upsertError.message };
  }

  const gid = groupId as string;

  // Insert error event (fire-and-forget)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.from as any)("error_events")
    .insert({
      group_id: gid,
      env,
      user_id: userId,
      session_id: sessionId,
      route: event.route || null,
      api_path: event.apiPath || null,
      message: event.message,
      stack: event.stack?.slice(0, 10000) || null,
      meta: event.meta || {},
    })
    .then(({ error }: { error: Error | null }) => {
      if (error) {
        console.error("[errors/ingest] Failed to insert event:", error);
      }
    });

  // Trigger notification check (async, non-blocking)
  checkAndNotify(gid).catch((err) => {
    console.error("[errors/ingest] Notification check failed:", err);
  });

  return {
    success: true,
    fingerprint,
    groupId: gid,
  };
}

function getEnv(): ErrorEnv {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "staging";
  return "development";
}
