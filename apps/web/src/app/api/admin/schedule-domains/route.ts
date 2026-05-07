import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // IP-based rate limiting
    const ipRateLimit = checkRateLimit(request, {
      limitPerIp: 30,
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
        { error: "Unauthorized", message: "You must be logged in to view schedule approvals." },
        { status: 401 }
      );
    }

    // User-based rate limiting
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 0,
      limitPerUser: 20,
      windowMs: 60_000,
      feature: "schedule domains",
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) {
      return NextResponse.json(
        { error: "Missing parameters", message: "orgId is required." },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can review schedule domains." },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: domains, error } = await serviceClient
      .from("schedule_allowed_domains")
      .select("id,hostname,vendor_id,status,verified_by_org_id,created_at,fingerprint")
      .eq("status", "pending")
      .eq("verified_by_org_id", orgId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[schedule-domains] Failed to load pending domains:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to load pending domains." },
        { status: 500 }
      );
    }

    return NextResponse.json({ domains: domains || [] }, { headers: rateLimit.headers });
  } catch (error) {
    console.error("[schedule-domains] Error:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to load schedule domains." },
      { status: 500 }
    );
  }
}
