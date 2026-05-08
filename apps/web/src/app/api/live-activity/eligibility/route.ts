import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";

/**
 * GET /api/live-activity/eligibility
 *
 * Authenticated check the mobile LiveActivityProvider runs before calling
 * `Activity.request(...)`. Returns `{ enabled: boolean }` based on:
 *   1. Server-side kill switch (`LIVE_ACTIVITIES_KILL_SWITCH=true` disables).
 *   2. APNs is configured (otherwise the dispatcher would fail at push time).
 *
 * Auth is required so an unauthenticated client can't probe whether LA is
 * enabled before it has a session — keeps the surface narrow for abuse.
 * Accepts both Bearer (mobile) and cookie (web) auth via
 * `createAuthenticatedApiClient`.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { user } = await createAuthenticatedApiClient(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.LIVE_ACTIVITIES_KILL_SWITCH === "true") {
    return NextResponse.json({ enabled: false, reason: "kill_switch" });
  }

  const apnsConfigured = Boolean(
    process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      process.env.APNS_AUTH_KEY,
  );
  if (!apnsConfigured) {
    return NextResponse.json({ enabled: false, reason: "apns_not_configured" });
  }

  return NextResponse.json({ enabled: true });
}
