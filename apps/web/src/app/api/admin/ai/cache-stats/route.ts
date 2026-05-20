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
import { buildResponse, type ViewRow } from "./aggregate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
