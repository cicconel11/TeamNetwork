import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Deprecated: legacy usage_events ingest disabled.
 */
export async function POST() {
  return new NextResponse(null, { status: 204 });
}
