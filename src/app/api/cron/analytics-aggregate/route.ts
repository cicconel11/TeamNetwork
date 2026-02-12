import { NextResponse } from "next/server";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Disabled: legacy usage_events aggregation is not used in the minimal analytics system.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  return NextResponse.json({ success: true, skipped: true });
}
