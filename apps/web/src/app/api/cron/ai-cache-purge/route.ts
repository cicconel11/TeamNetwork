import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PURGE_BATCH_SIZE = 500;
const MAX_PURGE_ROWS_PER_RUN = 5_000;

/**
 * Hourly cron job to purge expired AI semantic cache entries in bounded batches.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();
    let deletedCount = 0;
    let batches = 0;

    while (deletedCount < MAX_PURGE_ROWS_PER_RUN) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "purge_expired_ai_semantic_cache"
      );

      if (error) {
        console.error("[ai-cache-purge] purge failed:", error);
        return NextResponse.json(
          { error: "Purge failed", details: error.message },
          { status: 500 }
        );
      }

      const batchDeleted = Math.max(0, Number(data ?? 0));
      deletedCount += batchDeleted;
      batches += 1;

      if (batchDeleted < PURGE_BATCH_SIZE) {
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      deletedCount,
      batches,
      capped: deletedCount >= MAX_PURGE_ROWS_PER_RUN,
    });
  } catch (err) {
    console.error("[ai-cache-purge] Error:", err);
    return NextResponse.json({ error: "Failed to purge AI cache" }, { status: 500 });
  }
}
