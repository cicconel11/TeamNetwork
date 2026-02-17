import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { maskUrl, normalizeUrl } from "@/lib/schedule-connectors/fetch";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { checkHostStatus } from "@/lib/schedule-security/allowlist";
import { verifyAndEnroll } from "@/lib/schedule-security/verifyAndEnroll";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { scheduleConnectSchema } from "@/lib/schemas";

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

    const body = await validateJson(request, scheduleConnectSchema);

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

    // Block mutations if org is in grace period (read-only mode)
    const { isReadOnly } = await checkOrgReadOnly(body.orgId);
    if (isReadOnly) {
      return NextResponse.json(readOnlyResponse(), { status: 403, headers: rateLimit.headers });
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

    const { detectConnector } = await import("@/lib/schedule-connectors/registry");
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
      // Unique constraint violation → duplicate source URL for this org
      if (error?.code === "23505") {
        return NextResponse.json(
          { error: "Already connected", message: "This schedule URL is already connected." },
          { status: 409, headers: rateLimit.headers }
        );
      }
      console.error("[schedule-connect] Failed to create source:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to create schedule source." },
        { status: 500, headers: rateLimit.headers }
      );
    }

    const { syncScheduleSource } = await import("@/lib/schedule-connectors/sync-source");
    const serviceClient = createServiceClient();
    const window = buildSyncWindow();
    const result = await syncScheduleSource(serviceClient, { source, window });

    // Re-fetch source to get post-sync state (last_synced_at, last_event_count, etc.)
    const { data: freshSource } = await supabase
      .from("schedule_sources")
      .select("id, org_id, vendor_id, source_url, status, last_synced_at, last_error, title, last_event_count, last_imported")
      .eq("id", source.id)
      .single();

    const s = freshSource ?? source;

    return NextResponse.json({
      source: {
        id: s.id,
        vendor_id: s.vendor_id,
        maskedUrl: maskUrl(s.source_url),
        status: s.status,
        last_synced_at: s.last_synced_at,
        last_error: s.last_error,
        title: s.title,
      },
      sync: result,
    }, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

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
