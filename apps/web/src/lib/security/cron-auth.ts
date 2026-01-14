import { NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Validate cron job authorization.
 *
 * Returns a NextResponse (401 or 500) if invalid, or `null` if the
 * request is properly authenticated.
 */
export function validateCronAuth(request: Request): NextResponse | null {
  if (!CRON_SECRET) {
    console.error("[cron] CRON_SECRET not configured");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
