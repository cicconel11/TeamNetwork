import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { usageIngestRequestSchema } from "@/lib/schemas/analytics";
import { getAnalyticsConsent, resolveTrackingLevel } from "@/lib/analytics/consent";
import type { AgeBracket, OrgType } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/analytics/ingest
 *
 * Accepts batched usage events from the client-side tracker.
 * Validates auth, consent, age/org restrictions, and rate limits.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Rate limit: 30 req/min per user
    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "analytics ingest",
      limitPerIp: 60,
      limitPerUser: 30,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    if (!user) {
      return new NextResponse(null, { status: 401, headers: rateLimit.headers });
    }

    // Check consent
    const serviceSupabase = createServiceClient();
    const consented = await getAnalyticsConsent(serviceSupabase, user.id);
    if (!consented) {
      return new NextResponse(null, { status: 403, headers: rateLimit.headers });
    }

    // Parse and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: rateLimit.headers });
    }

    const parsed = usageIngestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const { events, session_id, organization_id } = parsed.data;

    // Resolve tracking level
    const ageBracket = (user.user_metadata?.age_bracket as AgeBracket) ?? "18_plus";
    let orgType: OrgType = "general";

    if (organization_id) {
      // Verify the user is an active member of this org before accepting events
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: membership } = await (serviceSupabase as any)
        .from("user_organization_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", organization_id)
        .eq("status", "active")
        .maybeSingle();

      if (!membership) {
        // Silently drop events for orgs the user doesn't belong to
        return new NextResponse(null, { status: 204, headers: rateLimit.headers });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: org } = await (serviceSupabase as any)
        .from("organizations")
        .select("org_type")
        .eq("id", organization_id)
        .maybeSingle();

      if (org?.org_type) {
        orgType = org.org_type as OrgType;
      }
    }

    const level = resolveTrackingLevel(true, ageBracket, orgType);
    if (level === "none") {
      return new NextResponse(null, { status: 204, headers: rateLimit.headers });
    }

    // Filter and sanitize events based on tracking level
    const rows = events
      .filter((e) => {
        if (level === "page_view_only" && e.event_type !== "page_view") return false;
        return true;
      })
      .map((e) => ({
        user_id: user.id,
        organization_id: organization_id || null,
        session_id,
        event_type: e.event_type,
        feature: e.feature,
        duration_ms: level === "page_view_only" ? null : (e.duration_ms ?? null),
        device_class: e.device_class,
        hour_of_day: level === "page_view_only" ? null : e.hour_of_day,
      }));

    if (rows.length === 0) {
      return new NextResponse(null, { status: 204, headers: rateLimit.headers });
    }

    // Insert events via service client (bypasses RLS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (serviceSupabase as any)
      .from("usage_events")
      .insert(rows);

    if (error) {
      // Table might not exist yet — graceful degradation
      if (error.code === "42P01") {
        return new NextResponse(null, { status: 204, headers: rateLimit.headers });
      }
      console.error("[analytics/ingest] Insert error:", error);
      return NextResponse.json({ error: "Failed to store events" }, { status: 500, headers: rateLimit.headers });
    }

    return new NextResponse(null, { status: 204, headers: rateLimit.headers });
  } catch (err) {
    console.error("[analytics/ingest] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
