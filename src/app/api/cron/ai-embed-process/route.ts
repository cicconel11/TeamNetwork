import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { processEmbeddingQueue } from "@/lib/ai/embedding-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RUNTIME_MS = 25_000;

/**
 * Cron job to process the AI embedding queue.
 * Runs every 5 minutes, processes batches until queue is empty or 25s elapsed.
 */
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

    // Process queue in a loop until empty or time limit reached
    while (Date.now() - startTime < MAX_RUNTIME_MS) {
      const stats = await processEmbeddingQueue(supabase);
      totalProcessed += stats.processed;
      totalSkipped += stats.skipped;
      totalFailed += stats.failed;
      iterations++;

      // If nothing was processed, queue is empty
      if (stats.processed + stats.skipped + stats.failed === 0) {
        break;
      }
    }

    // Also purge old queue rows (dead-letter cleanup)
    const { data: purgedCount, error: purgeError } = await (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc as any
    )("purge_ai_embedding_queue");

    if (purgeError) {
      console.error("[ai-embed-process] queue purge failed:", purgeError);
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
    console.error("[ai-embed-process] Error:", err);
    return NextResponse.json(
      { error: "Failed to process embedding queue" },
      { status: 500 }
    );
  }
}
