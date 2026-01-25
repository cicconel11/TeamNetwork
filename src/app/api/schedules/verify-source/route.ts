import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { checkHostStatus } from "@/lib/schedule-security/allowlist";
import { verifyAndEnroll } from "@/lib/schedule-security/verifyAndEnroll";
import { normalizeUrl, maskUrl } from "@/lib/schedule-security/url";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to verify schedule sources." },
        { status: 401 }
      );
    }

    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 20,
      limitPerUser: 10,
      windowMs: 60_000,
      feature: "schedule verification",
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    let body: { orgId?: string; url?: string };
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

    if (!membership || membership.status === "revoked") {
      return NextResponse.json(
        { error: "Forbidden", message: "You are not a member of this organization." },
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
    const existingStatus = await checkHostStatus(host);
    if (existingStatus.status === "active") {
      return NextResponse.json(
        {
          vendorId: existingStatus.vendorId ?? "unknown",
          confidence: 1,
          allowStatus: "active",
          evidenceSummary: "allowlist rule",
          maskedUrl: maskUrl(normalizedUrl),
        },
        { headers: rateLimit.headers }
      );
    }

    if (existingStatus.status === "blocked") {
      return NextResponse.json(
        {
          vendorId: existingStatus.vendorId ?? "unknown",
          confidence: 1,
          allowStatus: "blocked",
          evidenceSummary: "blocked",
          maskedUrl: maskUrl(normalizedUrl),
        },
        { headers: rateLimit.headers }
      );
    }

    if (existingStatus.status === "pending") {
      return NextResponse.json(
        {
          vendorId: existingStatus.vendorId ?? "unknown",
          confidence: 0.9,
          allowStatus: "pending",
          evidenceSummary: "pending approval",
          maskedUrl: maskUrl(normalizedUrl),
        },
        { headers: rateLimit.headers }
      );
    }

    const enrollment = await verifyAndEnroll({
      url: normalizedUrl,
      orgId: body.orgId,
      userId: user.id,
    });

    return NextResponse.json(
      {
        vendorId: enrollment.vendorId ?? "unknown",
        confidence: enrollment.confidence ?? 0,
        allowStatus: enrollment.allowStatus,
        evidenceSummary: (enrollment.evidence || []).join(", ") || "verification",
        maskedUrl: maskUrl(normalizedUrl),
      },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    console.error("[schedule-verify] Error:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to verify schedule source." },
      { status: 500 }
    );
  }
}
