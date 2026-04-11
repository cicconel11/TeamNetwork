import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import {
  checkRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";
import {
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import {
  telemetryErrorEventSchema,
  clientErrorPayloadSchema,
} from "@/lib/schemas/telemetry";
import { generateFingerprint } from "@/lib/telemetry/fingerprint";
import { checkAndNotify } from "@/lib/errors/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MINUTE_MS = 60_000;

// Combined schema that accepts either format
const combinedSchema = z.union([clientErrorPayloadSchema, telemetryErrorEventSchema]);

interface ErrorEvent {
  id: string;
  group_id: string;
  env: string;
  user_id: string | null;
  session_id: string | null;
  route: string | null;
  api_path: string | null;
  message: string;
  stack: string | null;
  meta: Record<string, unknown>;
  deployment_id: string | null;
  git_sha: string | null;
  created_at: string;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    // IP rate limit (30/min) - applied before parsing body to prevent DoS
    const ipRateLimit = checkRateLimit(request, {
      userId: null,
      feature: "error telemetry",
      limitPerIp: 30,
      limitPerUser: 0, // Disabled - we use session-based limiting below
      windowMs: MINUTE_MS,
    });

    if (!ipRateLimit.ok) {
      return buildRateLimitResponse(ipRateLimit);
    }

    // Validate and parse payload (accepts both client and simple formats)
    const body = await validateJson(request, combinedSchema, {
      maxBodyBytes: 100_000, // 100KB max for payloads with breadcrumbs
    });

    // Normalize the payload - check if it's the new client format (has breadcrumbs)
    const isClientFormat = "breadcrumbs" in body;

    // Extract common fields with defaults
    const message = body.message;
    const env = body.env;
    const name = body.name || "Error";
    const stack = body.stack;
    const route = body.route;
    const session_id = body.session_id;
    const user_id = body.user_id;

    // Fields that differ between formats
    const api_path = isClientFormat ? undefined : (body as z.infer<typeof telemetryErrorEventSchema>).api_path;
    const component = isClientFormat ? undefined : (body as z.infer<typeof telemetryErrorEventSchema>).component;
    const severity = isClientFormat ? undefined : (body as z.infer<typeof telemetryErrorEventSchema>).severity;

    // Build meta - for client format, include breadcrumbs and client meta
    let meta: Record<string, unknown> = {};
    if (isClientFormat) {
      const clientBody = body as z.infer<typeof clientErrorPayloadSchema>;
      meta = {
        ...clientBody.meta,
        breadcrumbs: clientBody.breadcrumbs,
        context: clientBody.context,
      };
    } else {
      meta = (body as z.infer<typeof telemetryErrorEventSchema>).meta || {};
    }

    // Skip development errors in production server (optional - can be removed if you want to track dev errors)
    const serverEnv = process.env.NODE_ENV === "production" ? "production" : "development";
    if (env === "development" && serverEnv === "production") {
      // Silently accept but don't store development errors on production server
      return new NextResponse(null, {
        status: 204,
        headers: ipRateLimit.headers,
      });
    }

    // User/session rate limit (20/min) - if user_id or session_id provided
    const rateLimitKey = user_id || session_id;
    if (rateLimitKey) {
      const userRateLimit = checkRateLimit(request, {
        userId: rateLimitKey,
        feature: "error telemetry (user)",
        limitPerIp: 0, // Already checked above
        limitPerUser: 20,
        windowMs: MINUTE_MS,
        pathOverride: `/api/telemetry/error/user/${rateLimitKey}`,
      });

      if (!userRateLimit.ok) {
        return buildRateLimitResponse(userRateLimit);
      }
    }

    // Get deployment metadata from Vercel environment variables
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || null;
    const gitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null;

    // Generate fingerprint and title
    const { fingerprint, title } = generateFingerprint({
      message,
      name,
      stack,
      route,
      api_path,
    });

    // Build sample event for storage
    const sampleEvent = {
      message,
      name,
      stack: stack?.slice(0, 2000), // Truncate for sample
      route,
      api_path,
      component,
      user_id,
      session_id,
      meta,
      deployment_id: deploymentId,
      git_sha: gitSha,
      timestamp: new Date().toISOString(),
    };

    // Use type assertion since error_groups/error_events tables are pending type regeneration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createServiceClient() as any;

    // Upsert error group (atomic insert/update)
    const { data: groupResult, error: groupError } = await supabase.rpc(
      "upsert_error_group",
      {
        p_fingerprint: fingerprint,
        p_title: title,
        p_severity: severity || "medium",
        p_env: env,
        p_sample_event: sampleEvent,
      }
    ) as { data: string | null; error: Error | null };

    if (groupError) {
      console.error(`[${requestId}] Error upserting error group:`, groupError);
      return NextResponse.json(
        { error: "Failed to record error" },
        { status: 500, headers: ipRateLimit.headers }
      );
    }

    const groupId = groupResult as string;

    // Insert individual error event
    const { error: eventError } = await supabase
      .from("error_events")
      .insert({
        group_id: groupId,
        env,
        user_id: user_id || null,
        session_id: session_id || null,
        route: route || null,
        api_path: api_path || null,
        message,
        stack: stack || null,
        meta: meta || {},
        deployment_id: deploymentId,
        git_sha: gitSha,
      } satisfies Omit<ErrorEvent, "id" | "created_at">);

    if (eventError) {
      console.error(`[${requestId}] Error inserting error event:`, eventError);
      // Don't fail the request - the group was created/updated successfully
    }

    // Trigger notification check (async, non-blocking)
    checkAndNotify(groupId).catch((err) => {
      console.error(`[${requestId}] Notification check failed:`, err);
    });

    // Return success with fingerprint
    return NextResponse.json(
      { success: true, fingerprint },
      { status: 200, headers: ipRateLimit.headers }
    );
  } catch (err) {
    console.error(`[${requestId}] Error in telemetry endpoint:`, err);

    if (err instanceof ValidationError) {
      return validationErrorResponse(err);
    }

    return NextResponse.json(
      { error: "Failed to process error telemetry" },
      { status: 500 }
    );
  }
}
