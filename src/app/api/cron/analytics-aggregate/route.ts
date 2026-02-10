import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Weekly cron job to aggregate raw usage_events into usage_summaries.
 * Runs every Sunday at 2 AM UTC.
 *
 * Calls the aggregate_usage_events RPC for the past week.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // Calculate the past week's period
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCHours(0, 0, 0, 0);

    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - 7);

    const pStart = periodStart.toISOString().split("T")[0];
    const pEnd = periodEnd.toISOString().split("T")[0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("aggregate_usage_events", {
      p_period_start: pStart,
      p_period_end: pEnd,
    });

    if (error) {
      if (error.code === "42883") {
        console.log("[cron/analytics-aggregate] RPC function not found, skipping");
        return NextResponse.json({
          success: true,
          message: "Aggregation skipped (function not found)",
        });
      }
      throw error;
    }

    console.log("[cron/analytics-aggregate] Aggregation completed:", data);

    return NextResponse.json({
      success: true,
      message: "Usage events aggregated",
      period: { start: pStart, end: pEnd },
      result: data,
    });
  } catch (err) {
    console.error("[cron/analytics-aggregate] Error:", err);
    return NextResponse.json(
      { error: "Failed to aggregate usage events" },
      { status: 500 },
    );
  }
}
