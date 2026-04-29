import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { sendPush, type PushType } from "@/lib/notifications/push";
import { auditNotificationSend } from "@/lib/notifications/audit";
import { getApnsClient, getApnsTopicForKind } from "@/lib/notifications/apns";
import type { NotificationCategory } from "@/lib/notifications";
import type { NotificationAudience } from "@/types/database";

/**
 * Notification dispatch cron worker.
 *
 * Drains the `notification_jobs` queue every minute. For each pending row:
 *   1. Lease the row (set `status='processing'` + `leased_at=now()`).
 *   2. Dispatch by `kind`:
 *        - `standard`               → existing Expo `sendPush`
 *        - `live_activity_*`        → APNs HTTP/2 `liveactivity` push
 *        - `wallet_update`          → APNs `wallet` push (forward-compat)
 *   3. Audit-log the send to `public.notifications` with `kind`.
 *   4. Mark `succeeded` or increment `attempts` + set `last_error`. After
 *      MAX_ATTEMPTS we mark `failed` so the row stops re-leasing.
 *
 * The reminder cron also writes to this queue, but with `status='succeeded'`
 * for in-line audit only — those rows are not re-dispatched here. We only
 * touch `status='pending'` rows.
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

  // 1. Atomically lease a batch of pending rows. We use UPDATE ... RETURNING
  // with a CTE so concurrent workers can't double-claim. SQL string is built
  // once; values are parameterized via Supabase RPC `dispatch_notification_jobs_lease`
  // which we don't yet have, so we fall back to a two-step claim: pick ids,
  // then update by id list. Race-safety: if two workers race the same id,
  // the second's UPDATE will see status != 'pending' and skip.
  const { data: candidates, error: pickError } = await (service as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          v: string,
        ) => {
          lte: (
            col: string,
            v: string,
          ) => {
            order: (
              col: string,
              opts: { ascending: boolean },
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => {
                limit: (
                  n: number,
                ) => Promise<{ data: { id: string }[] | null; error: { message: string } | null }>;
              };
            };
          };
        };
      };
    };
  })
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

  const candidateIds = (candidates ?? []).map((r) => r.id);
  if (candidateIds.length === 0) {
    return NextResponse.json({ success: true, leased: 0, dispatched: 0 });
  }

  // 2. Claim them. UPDATE ... WHERE status='pending' so racing workers can't
  // re-claim the same rows.
  const { data: leased, error: leaseError } = await (service as unknown as {
    from: (t: string) => {
      update: (
        v: Record<string, unknown>,
      ) => {
        in: (
          col: string,
          vals: string[],
        ) => {
          eq: (
            col: string,
            v: string,
          ) => {
            select: (
              cols: string,
            ) => Promise<{ data: JobRow[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  })
    .from("notification_jobs")
    .update({
      status: "processing",
      leased_at: new Date().toISOString(),
    })
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
  const results: Array<{
    id: string;
    kind: string;
    status: "succeeded" | "failed" | "retry";
    error?: string;
    sent?: number;
  }> = [];

  for (const job of leased ?? []) {
    try {
      let sentCount = 0;
      switch (job.kind) {
        case "standard": {
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
          });
          sentCount = result.sent;
          if (result.errors.length > 0) {
            throw new Error(result.errors.join("; "));
          }
          break;
        }
        case "live_activity_start":
        case "live_activity_update":
        case "live_activity_end":
        case "wallet_update": {
          sentCount = await dispatchApnsJob(service, job);
          break;
        }
        default: {
          throw new Error(`Unknown notification job kind: ${job.kind}`);
        }
      }

      await markJobSucceeded(service, job.id);
      await auditNotificationSend(service, {
        organizationId: job.organization_id,
        kind: job.kind,
        title: job.title ?? "",
        body: job.body ?? "",
        audience: job.audience,
        targetUserIds: job.target_user_ids,
        sentAt: new Date().toISOString(),
      });

      dispatched += 1;
      results.push({
        id: job.id,
        kind: job.kind,
        status: "succeeded",
        sent: sentCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nextAttempts = job.attempts + 1;
      const finalStatus: "failed" | "pending" =
        nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";

      await markJobError(service, job.id, finalStatus, nextAttempts, message);
      results.push({
        id: job.id,
        kind: job.kind,
        status: finalStatus === "failed" ? "failed" : "retry",
        error: message,
      });
      console.error(
        `[notification-dispatch] job ${job.id} (${job.kind}) failed (attempt ${nextAttempts}): ${message}`,
      );
    }
  }

  return NextResponse.json({
    success: true,
    leased: (leased ?? []).length,
    dispatched,
    elapsedMs: Date.now() - startedAt,
    results,
  });
}

async function markJobSucceeded(
  service: ReturnType<typeof createServiceClient>,
  jobId: string,
): Promise<void> {
  // notification_jobs columns (kind, leased_at, attempts, last_error,
  // scheduled_for) ship in 20261101000000_notification_jobs_and_push_prefs.sql
  // but aren't in the generated `Database` types yet. Cast through unknown
  // until `bun run gen:types` runs against the new migrations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;
  await svc
    .from("notification_jobs")
    .update({
      status: "succeeded",
      sent_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", jobId);
}

async function markJobError(
  service: ReturnType<typeof createServiceClient>,
  jobId: string,
  status: "failed" | "pending",
  attempts: number,
  message: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = service as any;
  await svc
    .from("notification_jobs")
    .update({
      status,
      attempts,
      last_error: message.slice(0, 2000),
      // Reset leased_at so a future tick can pick up retries.
      leased_at: null,
    })
    .eq("id", jobId);
}

/**
 * Dispatch an APNs push for a Live Activity / wallet job. Reads the LA token
 * set from `live_activity_tokens` (for `live_activity_*` kinds) and sends one
 * push per active row.
 */
async function dispatchApnsJob(
  service: ReturnType<typeof createServiceClient>,
  job: JobRow,
): Promise<number> {
  const apns = getApnsClient();
  if (!apns) {
    throw new Error(
      "APNs client not configured (set APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY)",
    );
  }

  const topic = getApnsTopicForKind(job.kind);
  if (!topic) {
    throw new Error(`No APNs topic configured for kind=${job.kind}`);
  }

  // Live Activity pushes target tokens stored in live_activity_tokens — one
  // active row per (user, event). The job.data must carry `event_id` and the
  // ContentState payload to push.
  if (job.kind.startsWith("live_activity_")) {
    const data = (job.data ?? {}) as {
      event_id?: string;
      content_state?: Record<string, unknown>;
      stale_date?: number;
      dismissal_date?: number;
      apns_expiration?: number;
    };
    if (!data.event_id) {
      throw new Error("live_activity job missing data.event_id");
    }

    const { data: tokens, error: tokenError } = await (service as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (
            col: string,
            v: string,
          ) => {
            is: (
              col: string,
              v: null,
            ) => Promise<{
              data: Array<{ activity_id: string; push_token: string; started_at: string }> | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    })
      .from("live_activity_tokens")
      .select("activity_id, push_token, started_at")
      .eq("event_id", data.event_id)
      .is("ended_at", null);

    if (tokenError) throw new Error(tokenError.message);
    const rows = tokens ?? [];
    if (rows.length === 0) return 0;

    const eventName =
      job.kind === "live_activity_start"
        ? "start"
        : job.kind === "live_activity_end"
          ? "end"
          : "update";

    let sent = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const aps: Record<string, unknown> = {
        timestamp: Math.floor(Date.now() / 1000),
        event: eventName,
        "content-state": data.content_state ?? {},
      };
      if (typeof data.stale_date === "number") {
        aps["stale-date"] = data.stale_date;
      }
      if (typeof data.dismissal_date === "number") {
        aps["dismissal-date"] = data.dismissal_date;
      }

      try {
        await apns.send({
          token: row.push_token,
          topic,
          pushType: "liveactivity",
          payload: { aps },
          expiration:
            data.apns_expiration ??
            Math.floor(new Date(row.started_at).getTime() / 1000) +
              24 * 60 * 60,
          priority: 10,
        });
        sent += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${row.activity_id}: ${msg}`);
      }
    }
    if (errors.length > 0 && sent === 0) {
      throw new Error(`All APNs sends failed: ${errors.join("; ")}`);
    }
    return sent;
  }

  // wallet_update: not implemented yet — surface clearly rather than silent no-op.
  throw new Error(`APNs dispatch not implemented for kind=${job.kind}`);
}
