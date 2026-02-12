import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Deprecated: consent is now managed per-org via direct Supabase access.
 */
export async function GET() {
  return new NextResponse(null, { status: 204 });
}

export async function PUT() {
  return new NextResponse(null, { status: 204 });
}
