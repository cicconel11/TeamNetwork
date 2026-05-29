import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidApifyWebhookSecret } from "@/lib/linkedin/apify";
import { processFinishedApifyRun } from "@/lib/linkedin/enrichment-writeback";
import { checkWebhookRateLimit, getWebhookClientIp } from "@/lib/security/webhook-rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/linkedin/apify-webhook?secret=...
 *
 * Apify run-finished webhook. Verifies the shared secret carried on the URL,
 * dedupes the delivery, and writes the finished run's profiles back to the
 * member/alumni/parent rows that the run targeted.
 */
export async function POST(request: Request) {
  const clientIp = getWebhookClientIp(request) ?? "unknown";
  const rateLimit = checkWebhookRateLimit(clientIp);
  if (!rateLimit.ok) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const secret = new URL(request.url).searchParams.get("secret");
  if (!isValidApifyWebhookSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const eventType = typeof payload.eventType === "string" ? payload.eventType : "unknown";
  const resource = payload.resource as { id?: string } | undefined;
  const eventData = payload.eventData as { actorRunId?: string } | undefined;
  const runId = resource?.id ?? eventData?.actorRunId ?? null;

  if (!runId) {
    return NextResponse.json({ error: "Missing run id" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const eventId = `${runId}:${eventType}`;

  // Idempotency: dedup repeated deliveries of the same run event.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dedupError } = await (supabase as any)
    .from("apify_webhook_events")
    .insert({ id: eventId, run_id: runId, event_type: eventType });

  if (dedupError) {
    // Unique-violation = already processed; ack so Apify stops retrying.
    if (dedupError.code === "23505") {
      return NextResponse.json({ ok: true, deduped: true });
    }
    console.error("[apify-webhook] dedup insert error:", dedupError);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const result = await processFinishedApifyRun(supabase, runId);
  return NextResponse.json({ ok: true, ...result });
}
