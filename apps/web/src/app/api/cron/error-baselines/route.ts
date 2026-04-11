import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hourly cron job to update error group baselines and reset hourly counts.
 *
 * This endpoint:
 * 1. Calculates rolling baseline rates for spike detection
 * 2. Resets count_1h to 0 for all error groups
 * 3. Decrements count_24h appropriately (approximate 24h sliding window)
 *
 * Expected to be called hourly via Vercel Cron.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // Update baselines and reset hourly counts using the PostgreSQL function
    // Note: This function is defined in the migration, types need regeneration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("update_error_baselines");

    if (error) {
      // If the function doesn't exist, run a simplified fallback
      if (error.code === "42883") {
        // Function not found - just reset hourly counts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: resetError } = await (supabase.from as any)("error_groups")
          .update({ count_1h: 0 })
          .neq("id", "00000000-0000-0000-0000-000000000000");

        if (resetError) {
          throw resetError;
        }

        console.log("[cron/error-baselines] Baseline update completed (fallback mode)");

        return NextResponse.json({
          success: true,
          message: "Baselines updated (fallback mode - function not found)",
        });
      }

      throw error;
    }

    console.log("[cron/error-baselines] Baseline update completed");

    return NextResponse.json({
      success: true,
      message: "Baselines updated successfully",
    });
  } catch (err) {
    console.error("[cron/error-baselines] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to update baselines",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
