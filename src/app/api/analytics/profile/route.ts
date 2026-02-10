import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Disabled: self-evolving AI profile generation is intentionally off.
 */
export async function GET() {
  return NextResponse.json({ profile: null, consented: false });
}
