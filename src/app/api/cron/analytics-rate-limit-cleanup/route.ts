import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily cron job to clean up expired rate limit records (older than 24 hours).
 * Runs at 3am UTC daily.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // Delete rate limit records older than 24 hours
    const { error, count } = await supabase
      .from("rate_limit_analytics")
      .delete({ count: "exact" })
      .lt("window_start", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      deleted: count ?? 0,
    });
  } catch (err) {
    console.error("[cron/analytics-rate-limit-cleanup] Error:", err);
    return NextResponse.json(
      { error: "Failed to clean up rate limit records" },
      { status: 500 },
    );
  }
}
