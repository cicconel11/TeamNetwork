import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Deprecated: analytics events now go through the log_analytics_event RPC.
 */
export async function POST() {
  return new NextResponse(null, { status: 204 });
}
