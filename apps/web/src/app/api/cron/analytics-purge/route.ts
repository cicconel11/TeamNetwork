import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily cron job to purge expired analytics + ops events.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: analyticsData, error: analyticsError } = await (supabase.rpc as any)("purge_analytics_events");
    if (analyticsError && analyticsError.code !== "42883") {
      throw analyticsError;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: opsData, error: opsError } = await (supabase.rpc as any)("purge_ops_events");
    if (opsError && opsError.code !== "42883") {
      throw opsError;
    }

    return NextResponse.json({
      success: true,
      analytics: analyticsData ?? null,
      ops: opsData ?? null,
    });
  } catch (err) {
    console.error("[cron/analytics-purge] Error:", err);
    return NextResponse.json(
      { error: "Failed to purge analytics events" },
      { status: 500 },
    );
  }
}
