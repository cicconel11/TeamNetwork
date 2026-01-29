import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectConnector } from "@/lib/schedule-connectors/registry";
import { maskUrl, normalizeUrl } from "@/lib/schedule-connectors/fetch";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { schedulePreviewSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Apply IP-based rate limiting FIRST (before auth) to protect against unauthenticated abuse
  const ipRateLimit = checkRateLimit(request, {
    limitPerIp: 15,
    limitPerUser: 0, // IP-only, no user limit yet
    windowMs: 60_000,
    feature: "schedule preview",
  });

  if (!ipRateLimit.ok) {
    return buildRateLimitResponse(ipRateLimit);
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to preview schedules." },
        { status: 401, headers: ipRateLimit.headers }
      );
    }

    // Apply stricter user-based rate limiting for authenticated users
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 0, // Already checked above
      limitPerUser: 8,
      windowMs: 60_000,
      feature: "schedule preview",
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const body = await validateJson(request, schedulePreviewSchema);

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", body.orgId)
      .maybeSingle();

    if (membership?.status === "revoked" || membership?.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can preview schedules." },
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

    const { connector } = await detectConnector(normalizedUrl, { orgId: body.orgId });
    const preview = await connector.preview({ url: normalizedUrl, orgId: body.orgId });

    return NextResponse.json({
      vendor: preview.vendor,
      title: preview.title ?? null,
      eventsPreview: preview.events.slice(0, 20),
      inferredMeta: preview.inferredMeta ?? null,
      maskedUrl: maskUrl(normalizedUrl),
    }, { headers: rateLimit.headers });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

    const message = error instanceof Error ? error.message : "Failed to preview schedule.";
    const isClientError = isPreviewClientError(message);
    if (!isClientError) {
      console.error("[schedule-preview] Error:", error);
    }

    return NextResponse.json(
      { error: isClientError ? "Preview failed" : "Internal error", message },
      { status: isClientError ? 400 : 500, headers: ipRateLimit.headers }
    );
  }
}

function isPreviewClientError(message: string) {
  const normalized = message.toLowerCase();
  return [
    "no supported schedule connector",
    "url must start with http",
    "domain pending admin approval",
    "domain is blocked",
    "domain is not allowlisted",
    "fetch failed",
    "response exceeds size limit",
    "too many redirects",
    "localhost urls are not allowed",
    "private ips are not allowed",
    "only ports 80 and 443 are allowed",
  ].some((snippet) => normalized.includes(snippet));
}
