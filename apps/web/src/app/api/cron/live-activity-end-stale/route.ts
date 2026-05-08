import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

/**
 * Hourly sweep: end every Live Activity whose nominal `ends_at` has passed by
 * more than the grace window. Without this, an LA whose owning device went
 * offline between event-end and the natural APNs timeout (~12h) keeps showing
 * stale info on the lock screen. We enqueue `live_activity_end` jobs so the
 * existing dispatcher tears them down via APNs.
 */
export const dynamic = "force-dynamic";

const GRACE_MINUTES = 30;

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;

  const cutoff = new Date(
    Date.now() - GRACE_MINUTES * 60 * 1000,
  ).toISOString();

  const { data: stale, error: queryError } = await svc
    .from("live_activity_tokens")
    .select("activity_id, event_id, organization_id")
    .lt("ends_at", cutoff)
    .is("ended_at", null)
    .limit(500);

  if (queryError) {
    return NextResponse.json(
      { success: false, error: queryError.message },
      { status: 500 },
    );
  }

  const rows = (stale ?? []) as Array<{
    activity_id: string;
    event_id: string;
    organization_id: string;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ success: true, enqueued: 0 });
  }

  const now = Math.floor(Date.now() / 1000);
  const jobs = rows.map((r) => ({
    organization_id: r.organization_id,
    kind: "live_activity_end",
    priority: 5,
    data: {
      event_id: r.event_id,
      activity_id: r.activity_id,
      reason: "stale_grace_passed",
      dismissal_date: now,
      content_state: {},
    },
    status: "pending",
    scheduled_for: new Date().toISOString(),
  }));

  const { error: insertError } = await svc.from("notification_jobs").insert(jobs);
  if (insertError) {
    return NextResponse.json(
      { success: false, error: insertError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, enqueued: rows.length });
}
