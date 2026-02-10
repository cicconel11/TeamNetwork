import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily cron job to purge expired usage events (older than 90 days).
 * Runs every day at 3 AM UTC.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("purge_expired_usage_events");

    if (error) {
      if (error.code === "42883") {
        console.log("[cron/analytics-purge] RPC function not found, skipping");
        return NextResponse.json({
          success: true,
          message: "Purge skipped (function not found)",
        });
      }
      throw error;
    }

    console.log("[cron/analytics-purge] Purge completed:", data);

    return NextResponse.json({
      success: true,
      message: "Expired usage events purged",
      result: data,
    });
  } catch (err) {
    console.error("[cron/analytics-purge] Error:", err);
    return NextResponse.json(
      { error: "Failed to purge usage events" },
      { status: 500 },
    );
  }
}
