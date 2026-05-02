/**
 * GET /api/admin/ai/latency-stats
 *
 * Dev-admin aggregate latency telemetry over raw ai_audit_log rows. Returns
 * aggregate buckets only; no prompt text, user/org/thread/message ids, or
 * individual request rows.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { isDevAdmin } from "@/lib/auth/dev-admin";
import { aiLog } from "@/lib/ai/logger";
import {
  buildLatencyStats,
  parseLatencyStatsDays,
  type AiLatencyAuditRow,
} from "@/lib/ai/latency-stats";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROW_LIMIT = 50_000;

export async function GET(req: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  try {
    const parsedDays = parseLatencyStatsDays(req.url);
    if (!parsedDays.ok) {
      return NextResponse.json({ error: "Invalid days" }, { status: 400 });
    }

    const ipRateLimit = checkRateLimit(req, {
      feature: "admin-ai-latency-stats",
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
      feature: "admin-ai-latency-stats",
      limitPerIp: 0,
      limitPerUser: 20,
    });
    if (!userRateLimit.ok) {
      return buildRateLimitResponse(userRateLimit);
    }

    if (!isDevAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sinceIso = new Date(
      Date.now() - parsedDays.days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const serviceClient = createServiceClient();
    const { data, error } = await (serviceClient as any)
      .from("ai_audit_log")
      .select("created_at, latency_ms, cache_status, context_surface, intent_type, stage_timings")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT);

    if (error) {
      aiLog("error", "admin-ai-latency-stats", "audit query failed", {
        requestId,
        orgId: "platform",
        userId: user.id,
      }, { error });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const rows = (data ?? []) as AiLatencyAuditRow[];
    const truncated = rows.length >= ROW_LIMIT;
    const response = {
      windowDays: parsedDays.days,
      ...buildLatencyStats(rows, { truncated }),
    };

    aiLog("info", "admin-ai-latency-stats", "latency stats served", {
      requestId,
      orgId: "platform",
      userId: user.id,
    }, {
      rows_scanned: rows.length,
      truncated,
      duration_ms: Date.now() - startedAt,
      days: parsedDays.days,
    });

    return NextResponse.json(response);
  } catch (error) {
    aiLog("error", "admin-ai-latency-stats", "unexpected error", {
      requestId,
      orgId: "platform",
    }, { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
