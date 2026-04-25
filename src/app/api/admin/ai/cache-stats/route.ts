/**
 * GET /api/admin/ai/cache-stats
 *
 * Platform-admin (dev-admin) view of AI semantic-cache hit rate over the last
 * 7 days. Aggregates only — no per-org rows, no prompt content. Backed by the
 * `ai_cache_hit_rate_daily` view (service-role only).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isDevAdmin } from "@/lib/auth/dev-admin";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRACKED_STATUSES = [
  "hit_exact",
  "miss",
  "bypass",
  "ineligible",
  "disabled",
  "error",
] as const;

type TrackedStatus = (typeof TRACKED_STATUSES)[number];

export interface ViewRow {
  day: string;
  cache_status: string;
  count: number | string;
  pct_of_day: number | string | null;
}

interface DaySummary {
  day: string;
  total: number;
  byStatus: Record<TrackedStatus | "unset" | "other", number>;
}

interface CacheStatsResponse {
  windowDays: number;
  totalRequests: number;
  overallHitRate: number;
  byStatus: Record<TrackedStatus | "unset" | "other", number>;
  byDay: DaySummary[];
}

function emptyStatusMap(): Record<TrackedStatus | "unset" | "other", number> {
  return {
    hit_exact: 0,
    miss: 0,
    bypass: 0,
    ineligible: 0,
    disabled: 0,
    error: 0,
    unset: 0,
    other: 0,
  };
}

function classify(status: string): TrackedStatus | "unset" | "other" {
  if (status === "unset") return "unset";
  if ((TRACKED_STATUSES as readonly string[]).includes(status)) {
    return status as TrackedStatus;
  }
  return "other";
}

export function buildResponse(rows: ViewRow[], windowDays: number): CacheStatsResponse {
  const overall = emptyStatusMap();
  const dayMap = new Map<string, DaySummary>();

  for (const row of rows) {
    const count = typeof row.count === "string" ? Number(row.count) : row.count;
    if (!Number.isFinite(count) || count <= 0) continue;

    const bucket = classify(row.cache_status);
    overall[bucket] += count;

    const dayKey = new Date(row.day).toISOString();
    let day = dayMap.get(dayKey);
    if (!day) {
      day = { day: dayKey, total: 0, byStatus: emptyStatusMap() };
      dayMap.set(dayKey, day);
    }
    day.total += count;
    day.byStatus[bucket] += count;
  }

  const totalRequests = Object.values(overall).reduce((acc, n) => acc + n, 0);
  const overallHitRate =
    totalRequests > 0 ? Number((overall.hit_exact / totalRequests).toFixed(4)) : 0;

  const byDay = Array.from(dayMap.values()).sort((a, b) =>
    a.day < b.day ? 1 : a.day > b.day ? -1 : 0
  );

  return { windowDays, totalRequests, overallHitRate, byStatus: overall, byDay };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const ipRateLimit = checkRateLimit(req, {
      feature: "admin-ai-cache-stats",
      limitPerIp: 30,
      limitPerUser: 0,
    });
    if (!ipRateLimit.ok) {
      return buildRateLimitResponse(ipRateLimit);
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRateLimit = checkRateLimit(req, {
      userId: user.id,
      feature: "admin-ai-cache-stats",
      limitPerIp: 0,
      limitPerUser: 20,
    });
    if (!userRateLimit.ok) {
      return buildRateLimitResponse(userRateLimit);
    }

    if (!isDevAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const windowDays = 7;
    const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const serviceClient = createServiceClient();
    const { data, error } = await (serviceClient as any)
      .from("ai_cache_hit_rate_daily")
      .select("day, cache_status, count, pct_of_day")
      .gte("day", sinceIso);

    if (error) {
      console.error("[admin/ai/cache-stats] view query failed:", error);
      return NextResponse.json(
        { error: "Database error" },
        { status: 500 }
      );
    }

    const response = buildResponse((data ?? []) as ViewRow[], windowDays);
    return NextResponse.json(response);
  } catch (err) {
    console.error("[admin/ai/cache-stats] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
