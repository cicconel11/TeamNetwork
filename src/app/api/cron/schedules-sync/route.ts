import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncScheduleSource } from "@/lib/schedule-connectors/sync-source";
import { debugLog } from "@/lib/debug";

export const dynamic = "force-dynamic";

const SYNC_INTERVAL_HOURS = 24;
const MAX_CONCURRENCY = 3;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return { ok: false, reason: "Missing CRON_SECRET" };
  }

  // Only accept header-based authentication to prevent secret leakage in logs/referrers
  const authHeader = request.headers.get("authorization");
  const headerSecret = request.headers.get("x-cron-secret");

  if (authHeader === `Bearer ${secret}` || headerSecret === secret) {
    return { ok: true };
  }

  return { ok: false, reason: "Unauthorized" };
}

export async function GET(request: Request) {
  const authResult = isAuthorized(request);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: "Unauthorized", message: authResult.reason },
      { status: authResult.reason === "Missing CRON_SECRET" ? 500 : 401 }
    );
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - SYNC_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();

  const { data: sources, error } = await supabase
    .from("schedule_sources")
    .select("id, org_id, vendor_id, source_url, last_synced_at, status")
    .eq("status", "active")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);

  if (error) {
    console.error("[schedule-cron] Failed to load sources:", error);
    return NextResponse.json(
      { error: "Database error", message: "Failed to load schedule sources." },
      { status: 500 }
    );
  }

  const window = buildSyncWindow();
  const results: { id: string; vendor: string; status: string; error?: string }[] = [];

  for (let i = 0; i < (sources || []).length; i += MAX_CONCURRENCY) {
    const batch = (sources || []).slice(i, i + MAX_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (source) => {
        const result = await syncScheduleSource(supabase, { source, window });
        debugLog("schedule-cron", "source sync result", {
          sourceId: source.id,
          url: source.source_url.slice(0, 80),
          vendor: result.vendor,
          status: result.ok ? "ok" : "error",
          imported: result.imported,
          updated: result.updated,
          cancelled: result.cancelled,
          error: result.error,
        });
        return {
          id: source.id,
          vendor: result.vendor,
          status: result.ok ? "ok" : "error",
          error: result.error,
        };
      })
    );
    results.push(...batchResults);
  }

  const successCount = results.filter((r) => r.status === "ok").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  debugLog("schedule-cron", "batch complete", {
    totalSources: (sources || []).length,
    successCount,
    errorCount,
    errors: results.filter((r) => r.error).map((r) => ({ id: r.id, error: r.error })),
  });

  return NextResponse.json({
    processed: (sources || []).length,
    results,
  });
}

function buildSyncWindow() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setDate(to.getDate() + 366);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}
