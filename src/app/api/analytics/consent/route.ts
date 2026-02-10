import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { consentUpdateSchema } from "@/lib/schemas/analytics";
import { getAnalyticsConsent, updateAnalyticsConsent } from "@/lib/analytics/consent";
import type { AgeBracket } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/consent
 * Returns the current consent status for the authenticated user.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "analytics consent check",
      limitPerIp: 30,
      limitPerUser: 20,
    });

    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
    }

    const serviceSupabase = createServiceClient();
    const consented = await getAnalyticsConsent(serviceSupabase, user.id);

    return NextResponse.json({ consented }, { headers: rateLimit.headers });
  } catch {
    return NextResponse.json({ error: "Failed to check consent" }, { status: 500 });
  }
}

/**
 * PUT /api/analytics/consent
 * Updates consent (body: { consented: boolean }).
 */
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "analytics consent update",
      limitPerIp: 10,
      limitPerUser: 5,
    });

    if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: rateLimit.headers });
    }

    const parsed = consentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400, headers: rateLimit.headers },
      );
    }

    const serviceSupabase = createServiceClient();
    const ageBracket = (user.user_metadata?.age_bracket as AgeBracket) ?? null;

    await updateAnalyticsConsent(serviceSupabase, user.id, parsed.data.consented, ageBracket);

    return NextResponse.json(
      { consented: parsed.data.consented },
      { headers: rateLimit.headers },
    );
  } catch (err) {
    console.error("[analytics/consent] Error:", err);
    return NextResponse.json({ error: "Failed to update consent" }, { status: 500 });
  }
}
