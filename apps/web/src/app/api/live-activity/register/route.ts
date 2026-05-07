import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  baseSchemas,
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";

/**
 * POST /api/live-activity/register
 *
 * Persists an iOS Live Activity push token issued by ActivityKit so the
 * dispatcher can target it for `liveactivity` APNs sends.
 *
 * Auth: Supabase session required. We additionally verify the user has an
 * active `attending` RSVP on the event so a malicious client can't register
 * arbitrary push tokens against events they don't belong to.
 */
export const dynamic = "force-dynamic";

const schema = z
  .object({
    activityId: safeString(120),
    eventId: baseSchemas.uuid,
    organizationId: baseSchemas.uuid,
    deviceId: safeString(120),
    pushToken: safeString(512, 8),
    endsAt: z.string().datetime(),
  })
  .strict();

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

    // Verify (user, event, org) consistency: the user must be a member of the
    // org and have an `attending` RSVP on the event.
    const { data: rsvp, error: rsvpError } = await service
      .from("event_rsvps")
      .select("event_id, status, organization_id")
      .eq("user_id", user.id)
      .eq("event_id", body.eventId)
      .maybeSingle();
    if (rsvpError) {
      console.error("[live-activity.register] rsvp lookup failed:", rsvpError);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    if (!rsvp || rsvp.status !== "attending") {
      return NextResponse.json(
        { error: "Not attending this event" },
        { status: 403 },
      );
    }
    if (rsvp.organization_id !== body.organizationId) {
      return NextResponse.json(
        { error: "Organization mismatch" },
        { status: 403 },
      );
    }

    // Upsert; the unique partial index on (user, event) WHERE ended_at IS NULL
    // means re-registering with a new activityId for the same event from a
    // second device will collide. We resolve that by ending the prior row
    // first.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = service as any;
    const { error: endPriorError } = await svc
      .from("live_activity_tokens")
      .update({ ended_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("event_id", body.eventId)
      .is("ended_at", null)
      .neq("activity_id", body.activityId);
    if (endPriorError) {
      console.warn(
        `[live-activity.register] failed to end prior LA: ${endPriorError.message}`,
      );
    }

    const { error: upsertError } = await svc
      .from("live_activity_tokens")
      .upsert(
        {
          activity_id: body.activityId,
          user_id: user.id,
          event_id: body.eventId,
          organization_id: body.organizationId,
          device_id: body.deviceId,
          push_token: body.pushToken,
          ends_at: body.endsAt,
          ended_at: null,
        },
        { onConflict: "activity_id" },
      );
    if (upsertError) {
      console.error("[live-activity.register] upsert failed:", upsertError);
      return NextResponse.json({ error: "Persist failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return validationErrorResponse(err);
    }
    console.error("[live-activity.register] unexpected error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
