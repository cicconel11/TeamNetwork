import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { detectConnector } from "@/lib/schedule-connectors/registry";
import { maskUrl, normalizeUrl } from "@/lib/schedule-connectors/fetch";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { checkHostStatus } from "@/lib/schedule-security/allowlist";
import { verifyAndEnroll } from "@/lib/schedule-security/verifyAndEnroll";
import { syncScheduleSource } from "@/lib/schedule-connectors/sync-source";

export const dynamic = "force-dynamic";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 366;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to connect schedules." },
        { status: 401 }
      );
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 15,
      limitPerUser: 8,
      windowMs: 60_000,
      feature: "schedule connect",
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    let body: { orgId?: string; url?: string; title?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Request body must be valid JSON." },
        { status: 400, headers: rateLimit.headers }
      );
    }

    if (!body.orgId || !body.url) {
      return NextResponse.json(
        { error: "Missing parameters", message: "orgId and url are required." },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", body.orgId)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can connect schedules." },
        { status: 403, headers: rateLimit.headers }
      );
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(body.url);
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid URL", message: error instanceof Error ? error.message : "Invalid URL." },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const host = new URL(normalizedUrl).hostname;
    const allowStatus = await checkHostStatus(host);
    if (allowStatus.status === "blocked") {
      return NextResponse.json(
        { error: "Blocked", message: "This domain is blocked for schedule sources." },
        { status: 403, headers: rateLimit.headers }
      );
    }

    if (allowStatus.status === "pending") {
      // Only block if this org created the pending request
      if (allowStatus.verifiedByOrgId === body.orgId) {
        return NextResponse.json(
          { error: "Pending approval", message: "This domain needs admin approval before importing." },
          { status: 409, headers: rateLimit.headers }
        );
      }
      // Different org's pending domain - fall through to re-verify
    }

    if (allowStatus.status === "denied" ||
        (allowStatus.status === "pending" && allowStatus.verifiedByOrgId !== body.orgId)) {
      const enrollment = await verifyAndEnroll({
        url: normalizedUrl,
        orgId: body.orgId,
        userId: user.id,
      });

      if (enrollment.allowStatus === "pending") {
        return NextResponse.json(
          { error: "Pending approval", message: "This domain needs admin approval before importing." },
          { status: 409, headers: rateLimit.headers }
        );
      }

      if (enrollment.allowStatus !== "active") {
        return NextResponse.json(
          { error: "Not allowed", message: "This domain could not be verified for import." },
          { status: 400, headers: rateLimit.headers }
        );
      }
    }

    let connectorResult;
    try {
      connectorResult = await detectConnector(normalizedUrl, { orgId: body.orgId });
    } catch (error) {
      return NextResponse.json(
        { error: "Unsupported schedule", message: error instanceof Error ? error.message : "Unsupported schedule URL." },
        { status: 400, headers: rateLimit.headers }
      );
    }
    const { connector } = connectorResult;

    const { data: source, error } = await supabase
      .from("schedule_sources")
      .insert({
        org_id: body.orgId,
        created_by: user.id,
        vendor_id: connector.id,
        source_url: normalizedUrl,
        title: body.title ?? null,
      })
      .select("id, org_id, vendor_id, source_url, status, last_synced_at, last_error, title")
      .single();

    if (error || !source) {
      console.error("[schedule-connect] Failed to create source:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to create schedule source." },
        { status: 500, headers: rateLimit.headers }
      );
    }

    const serviceClient = createServiceClient();
    const window = buildSyncWindow();
    const result = await syncScheduleSource(serviceClient, { source, window });

    return NextResponse.json({
      source: {
        id: source.id,
        vendor_id: source.vendor_id,
        maskedUrl: maskUrl(source.source_url),
        status: source.status,
        last_synced_at: source.last_synced_at,
        last_error: source.last_error,
        title: source.title,
      },
      sync: result,
    }, { headers: rateLimit.headers });
  } catch (error) {
    console.error("[schedule-connect] Error:", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Internal error", message: "Failed to connect schedule." },
      { status: 500 }
    );
  }
}

function buildSyncWindow() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - WINDOW_PAST_DAYS);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setDate(to.getDate() + WINDOW_FUTURE_DAYS);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}
