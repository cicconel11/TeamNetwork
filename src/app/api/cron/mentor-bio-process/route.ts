import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { processMentorBioBackfillQueue } from "@/lib/mentorship/bio-backfill";

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

  try {
    const supabase = createServiceClient();

    while (Date.now() - startTime < MAX_RUNTIME_MS) {
      const stats = await processMentorBioBackfillQueue(supabase);
      totalProcessed += stats.processed;
      totalSkipped += stats.skipped;
      totalFailed += stats.failed;
      iterations++;

      if (stats.processed + stats.skipped + stats.failed === 0) {
        break;
      }
    }

    const { data: purgedCount, error: purgeError } = await (
      supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: number | null; error: { message: string } | null }>;
      }
    ).rpc("purge_mentor_bio_backfill_queue");

    if (purgeError) {
      console.error("[mentor-bio-process] queue purge failed:", purgeError);
    }

    return NextResponse.json({
      ok: true,
      processed: totalProcessed,
      skipped: totalSkipped,
      failed: totalFailed,
      iterations,
      purgedQueueRows: purgedCount ?? 0,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error("[mentor-bio-process] Error:", err);
    return NextResponse.json(
      { error: "Failed to process mentor bio backfill queue" },
      { status: 500 }
    );
  }
}
