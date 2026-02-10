import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Deprecated: ops events now go through the log_ops_event RPC.
 */
export async function POST() {
  return new NextResponse(null, { status: 204 });
}
