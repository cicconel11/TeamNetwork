import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";

/**
 * POST /api/live-activity/unregister
 *
 * Marks one (or all) of the caller's Live Activities as ended and enqueues
 * `live_activity_end` jobs so the device tears the on-screen card down.
 *
 * Body shapes:
 *   - { activityId }            — end one specific activity.
 *   - { deviceId }              — end every active LA on this device (sign-out).
 *
 * Auth: session required. We scope by `user_id = auth.uid()` server-side so
 * a request can never end someone else's LA.
 */
export const dynamic = "force-dynamic";

const schema = z
  .object({
    activityId: safeString(120).optional(),
    deviceId: safeString(120).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.activityId) || Boolean(v.deviceId), {
    message: "Provide activityId or deviceId",
  });

interface ActiveTokenRow {
  activity_id: string;
  event_id: string;
  organization_id: string;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const service = createServiceClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await validateJson(request, schema, { maxBodyBytes: 4_000 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = service as any;

    // 1. Find every active row matching the request scope.
    let query = svc
      .from("live_activity_tokens")
      .select("activity_id, event_id, organization_id")
      .eq("user_id", user.id)
      .is("ended_at", null);
    if (body.activityId) query = query.eq("activity_id", body.activityId);
    if (body.deviceId) query = query.eq("device_id", body.deviceId);

    const { data: rows, error: lookupError } = await query;
    if (lookupError) {
      console.error("[live-activity.unregister] lookup failed:", lookupError);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    const targets = (rows ?? []) as ActiveTokenRow[];
    if (targets.length === 0) {
      return NextResponse.json({ success: true, ended: 0 });
    }

    const activityIds = targets.map((r) => r.activity_id);

    // 2. Mark them ended.
    const nowIso = new Date().toISOString();
    const { error: updateError } = await svc
      .from("live_activity_tokens")
      .update({ ended_at: nowIso })
      .in("activity_id", activityIds);
    if (updateError) {
      console.error("[live-activity.unregister] update failed:", updateError);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    // 3. Enqueue end pushes so the device teardown isn't reliant on the host
    // app being foregrounded (the app might be terminating right now).
    const dismissalDate = Math.floor(Date.now() / 1000);
    const jobs = targets.map((row) => ({
      organization_id: row.organization_id,
      kind: "live_activity_end",
      priority: 10,
      data: {
        event_id: row.event_id,
        activity_id: row.activity_id,
        reason: "unregister",
        dismissal_date: dismissalDate,
        content_state: {},
      },
      status: "pending",
      scheduled_for: nowIso,
    }));

    const { error: insertError } = await svc
      .from("notification_jobs")
      .insert(jobs);
    if (insertError) {
      // Non-fatal: the token row is already ended; the device will just rely
      // on Activity.end() that the app already called locally.
      console.warn(
        `[live-activity.unregister] failed to enqueue end jobs: ${insertError.message}`,
      );
    }

    return NextResponse.json({ success: true, ended: targets.length });
  } catch (err) {
    if (err instanceof ValidationError) {
      return validationErrorResponse(err);
    }
    console.error("[live-activity.unregister] unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
