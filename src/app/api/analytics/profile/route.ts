import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getAnalyticsConsent } from "@/lib/analytics/consent";
import { getOrGenerateProfile, DEFAULT_PROFILE } from "@/lib/analytics/profile-generator";
import { AnthropicAdapter } from "@/lib/analytics/providers/anthropic";
import { ORG_NAV_ITEMS, type NavConfig } from "@/lib/navigation/nav-items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/profile?orgId=<uuid>
 *
 * Returns the cached or freshly-generated UI profile for the user+org.
 * Falls back to empty/default profile if no data or consent revoked.
 *
 * Response includes `consented: boolean` so the client can skip a
 * separate consent API call.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "analytics profile",
      limitPerIp: 20,
      limitPerUser: 10,
    });

    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
    }

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");

    if (!orgId) {
      return NextResponse.json({ error: "orgId query parameter is required" }, { status: 400, headers: rateLimit.headers });
    }

    // Validate UUID format before querying
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(orgId)) {
      return NextResponse.json({ error: "Invalid orgId format" }, { status: 400, headers: rateLimit.headers });
    }

    const serviceSupabase = createServiceClient();

    // Check consent
    const consented = await getAnalyticsConsent(serviceSupabase, user.id);
    if (!consented) {
      return NextResponse.json({ profile: DEFAULT_PROFILE, consented: false }, { headers: rateLimit.headers });
    }

    // Parallelize membership + org queries (both only need userId + orgId)
    const [membershipResult, orgResult] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (serviceSupabase as any)
        .from("user_organization_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (serviceSupabase as any)
        .from("organizations")
        .select("id, org_type, nav_config")
        .eq("id", orgId)
        .maybeSingle(),
    ]);

    const membership = membershipResult.data;
    const org = orgResult.data;

    if (!membership) {
      return NextResponse.json({ error: "Not a member of this organization" }, { status: 403, headers: rateLimit.headers });
    }

    if (!org) {
      return NextResponse.json({ profile: DEFAULT_PROFILE, consented: true }, { headers: rateLimit.headers });
    }

    const userRole = membership.role || "active_member";

    // Parse nav_config to exclude org-hidden features from profile generation
    const navConfig: NavConfig = (
      org.nav_config && typeof org.nav_config === "object" && !Array.isArray(org.nav_config)
        ? org.nav_config
        : {}
    ) as NavConfig;

    const availableFeatures = ORG_NAV_ITEMS
      .filter((item) => {
        if (!item.roles.includes(userRole)) return false;
        const configKey = item.href === "" ? "dashboard" : item.href;
        const config = navConfig[configKey];
        if (config?.hidden) return false;
        if (Array.isArray(config?.hiddenForRoles) && config.hiddenForRoles.includes(userRole)) return false;
        return true;
      })
      .map((item) => item.href === "" ? "dashboard" : item.href.replace(/^\//, ""));

    // Check if LLM provider is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ profile: DEFAULT_PROFILE, consented: true }, { headers: rateLimit.headers });
    }

    try {
      const adapter = new AnthropicAdapter();
      const profile = await getOrGenerateProfile(
        serviceSupabase,
        adapter,
        user.id,
        orgId,
        userRole,
        org.org_type || "general",
        availableFeatures,
      );

      return NextResponse.json({ profile, consented: true }, { headers: rateLimit.headers });
    } catch (err) {
      console.error("[analytics/profile] LLM error:", err);
      // Graceful degradation — return default profile
      return NextResponse.json({ profile: DEFAULT_PROFILE, consented: true }, { headers: rateLimit.headers });
    }
  } catch (err) {
    console.error("[analytics/profile] Error:", err);
    return NextResponse.json({ error: "Failed to get profile" }, { status: 500 });
  }
}
