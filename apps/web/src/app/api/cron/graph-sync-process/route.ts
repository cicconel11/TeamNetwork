import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { processGraphSyncQueue } from "@/lib/falkordb/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RUNTIME_MS = 25_000;

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let iterations = 0;
  let drainState: "processed" | "empty" | "unavailable" | "degraded" = "empty";
  let drainReason: string | null = null;

  try {
    const supabase = createServiceClient();

    while (Date.now() - startTime < MAX_RUNTIME_MS) {
      const stats = await processGraphSyncQueue(supabase);
      totalProcessed += stats.processed;
      totalSkipped += stats.skipped;
      totalFailed += stats.failed;
      iterations++;
      drainState = stats.drainState;
      drainReason = stats.reason ?? null;

      if (stats.drainState !== "processed") {
        break;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: purgedCount, error: purgeError } = await (supabase as any).rpc("purge_graph_sync_queue");

    if (purgeError) {
      console.error("[graph-sync-process] queue purge failed:", purgeError);
    }

    return NextResponse.json({
      ok: true,
      processed: totalProcessed,
      skipped: totalSkipped,
      failed: totalFailed,
      iterations,
      drainState,
      drainReason,
      purgedQueueRows: purgedCount ?? 0,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error("[graph-sync-process] Error:", error);
    return NextResponse.json(
      { error: "Failed to process graph sync queue" },
      { status: 500 }
    );
  }
}
