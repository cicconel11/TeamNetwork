import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { sendPush, type PushType } from "@/lib/notifications/push";
import type { NotificationCategory } from "@/lib/notifications";
import type { NotificationAudience } from "@/types/database";

/**
 * Notification dispatch cron worker — drains the `notification_jobs` queue
 * every minute. For each pending row:
 *   1. Lease (set status='processing' + leased_at=now()).
 *   2. Dispatch `kind="standard"` via sendPush with forceInline=true so the
 *      worker doesn't re-enqueue the same job (the bug commit 0f38c9bb fixed).
 *   3. Mark succeeded or increment attempts + set last_error. After
 *      MAX_ATTEMPTS we mark `failed` so the row stops re-leasing.
 *
 * Live Activity / APNs kinds are not handled here on main — those land in a
 * later port if/when the LA pipeline is brought across.
 */
export const dynamic = "force-dynamic";

const BATCH_SIZE = 200;
const MAX_ATTEMPTS = 5;

interface JobRow {
  id: string;
  organization_id: string;
  kind: string;
  priority: number;
  audience: string | null;
  target_user_ids: string[] | null;
  category: string | null;
  push_type: string | null;
  push_resource_id: string | null;
  title: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
  attempts: number;
}

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const service = createServiceClient();
  const startedAt = Date.now();

  // 1. Pick candidate ids.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;
  const { data: candidates, error: pickError } = await svc
    .from("notification_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("priority", { ascending: true })
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);

  if (pickError) {
    console.error("[notification-dispatch] pick failed:", pickError.message);
    return NextResponse.json(
      { success: false, error: pickError.message },
      { status: 500 },
    );
  }

  const candidateIds = ((candidates ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (candidateIds.length === 0) {
    return NextResponse.json({ success: true, leased: 0, dispatched: 0 });
  }

  // 2. Claim them. UPDATE WHERE status='pending' so racing workers can't
  //    re-claim the same rows.
  const { data: leased, error: leaseError } = await svc
    .from("notification_jobs")
    .update({ status: "processing", leased_at: new Date().toISOString() })
    .in("id", candidateIds)
    .eq("status", "pending")
    .select(
      "id, organization_id, kind, priority, audience, target_user_ids, category, push_type, push_resource_id, title, body, data, attempts",
    );

  if (leaseError) {
    console.error("[notification-dispatch] lease failed:", leaseError.message);
    return NextResponse.json(
      { success: false, error: leaseError.message },
      { status: 500 },
    );
  }

  let dispatched = 0;
  const results: Array<{ id: string; status: string; sent?: number; error?: string }> = [];

  for (const job of (leased ?? []) as JobRow[]) {
    try {
      if (job.kind !== "standard") {
        // Live Activity / APNs not handled in this port. Mark failed so the
        // row doesn't keep re-leasing.
        throw new Error(`unsupported kind=${job.kind} (Live Activity not yet ported to main)`);
      }

      // Resolve orgSlug for deep-link routing.
      let jobOrgSlug = (job.data as { orgSlug?: string } | null)?.orgSlug ?? undefined;
      if (!jobOrgSlug && job.organization_id) {
        const { data: orgRow } = await service
          .from("organizations")
          .select("slug")
          .eq("id", job.organization_id)
          .maybeSingle();
        jobOrgSlug = (orgRow as { slug?: string } | null)?.slug ?? undefined;
      }

      const result = await sendPush({
        supabase: service,
        organizationId: job.organization_id,
        audience: (job.audience as NotificationAudience | null) ?? null,
        targetUserIds: job.target_user_ids,
        title: job.title ?? "",
        body: job.body ?? "",
        category: (job.category as NotificationCategory | undefined) ?? undefined,
        pushType: (job.push_type as PushType | undefined) ?? undefined,
        pushResourceId: job.push_resource_id ?? undefined,
        data: (job.data ?? {}) as Record<string, unknown>,
        orgSlug: jobOrgSlug,
        forceInline: true,
      });

      if (result.errors.length > 0) {
        throw new Error(result.errors.join("; "));
      }

      await svc
        .from("notification_jobs")
        .update({
          status: "succeeded",
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", job.id);

      dispatched += 1;
      results.push({ id: job.id, status: "succeeded", sent: result.sent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttempts = job.attempts + 1;
      const finalStatus: "failed" | "pending" =
        nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";

      await svc
        .from("notification_jobs")
        .update({
          status: finalStatus,
          attempts: nextAttempts,
          last_error: message.slice(0, 2000),
          leased_at: null,
        })
        .eq("id", job.id);

      results.push({ id: job.id, status: finalStatus === "failed" ? "failed" : "retry", error: message });
      console.error(
        `[notification-dispatch] job ${job.id} failed (attempt ${nextAttempts}): ${message}`,
      );
    }
  }

  return NextResponse.json({
    success: true,
    leased: ((leased ?? []) as JobRow[]).length,
    dispatched,
    elapsedMs: Date.now() - startedAt,
    results,
  });
}
