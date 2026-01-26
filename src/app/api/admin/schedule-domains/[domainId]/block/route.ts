import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { domainId: string } }
) {
  try {
    // IP-based rate limiting
    const ipRateLimit = checkRateLimit(request, {
      limitPerIp: 15,
      limitPerUser: 0,
      windowMs: 60_000,
      feature: "schedule domains",
    });
    if (!ipRateLimit.ok) {
      return buildRateLimitResponse(ipRateLimit);
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to block domains." },
        { status: 401 }
      );
    }

    // User-based rate limiting
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 0,
      limitPerUser: 10,
      windowMs: 60_000,
      feature: "schedule domains",
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    let body: { orgId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    if (!body.orgId) {
      return NextResponse.json(
        { error: "Missing parameters", message: "orgId is required." },
        { status: 400 }
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
        { error: "Forbidden", message: "Only admins can block schedule domains." },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: domain, error: domainError } = await serviceClient
      .from("schedule_allowed_domains")
      .select("id,hostname,verified_by_org_id")
      .eq("id", params.domainId)
      .maybeSingle();

    if (domainError || !domain) {
      return NextResponse.json(
        { error: "Not found", message: "Schedule domain not found." },
        { status: 404 }
      );
    }

    if (domain.verified_by_org_id !== body.orgId) {
      return NextResponse.json(
        { error: "Forbidden", message: "This domain was not requested by your organization." },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await serviceClient
      .from("schedule_allowed_domains")
      .update({
        status: "blocked",
        verified_at: now,
        verification_method: "manual",
        last_seen_at: now,
      })
      .eq("id", domain.id)
      .select("id,hostname,status")
      .maybeSingle();

    if (updateError) {
      console.error("[schedule-domains] Failed to block domain:", updateError);
      return NextResponse.json(
        { error: "Database error", message: "Failed to block domain." },
        { status: 500 }
      );
    }

    const { data: sources, error: sourcesError } = await serviceClient
      .from("schedule_sources")
      .select("id,source_url")
      .ilike("source_url", `%${domain.hostname}%`);

    if (sourcesError) {
      console.error("[schedule-domains] Failed to find sources for blocked domain:", sourcesError);
    }

    const matchingIds = (sources || [])
      .filter((source) => {
        try {
          return new URL(source.source_url).hostname === domain.hostname;
        } catch {
          return false;
        }
      })
      .map((source) => source.id);

    if (matchingIds.length > 0) {
      const { error: disableError } = await serviceClient
        .from("schedule_sources")
        .update({
          status: "paused",
          last_error: "Domain blocked by admin.",
          updated_at: now,
        })
        .in("id", matchingIds);

      if (disableError) {
        console.error("[schedule-domains] Failed to disable blocked sources:", disableError);
      }
    }

    return NextResponse.json(
      { domain: updated, disabledSources: matchingIds.length },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    console.error("[schedule-domains] Error:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to block schedule domain." },
      { status: 500 }
    );
  }
}
