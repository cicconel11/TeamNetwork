import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { performApifySync } from "@/lib/linkedin/resync";
import { buildRateLimitResponse, checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/linkedin/enrichment-sync
 *
 * Refreshes the user's LinkedIn enrichment data from their saved public
 * LinkedIn profile URL via Apify. Accepts cookie (web) or Bearer (mobile) auth.
 */
export async function POST(request: Request) {
  try {
    const ipRateLimit = checkRateLimit(request, {
      feature: "linkedin enrichment sync",
      limitPerIp: 10,
      limitPerUser: 0,
    });
    if (!ipRateLimit.ok) return buildRateLimitResponse(ipRateLimit);

    const { user } = await createAuthenticatedApiClient(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: ipRateLimit.headers });
    }

    const userRateLimit = checkRateLimit(request, {
      feature: "linkedin enrichment sync",
      limitPerIp: 0,
      limitPerUser: 3,
      userId: user.id,
    });
    if (!userRateLimit.ok) return buildRateLimitResponse(userRateLimit);

    const serviceClient = createServiceClient();
    const result = await performApifySync(serviceClient, user.id);

    return NextResponse.json(result.body, { status: result.status, headers: userRateLimit.headers });
  } catch (error) {
    console.error("[linkedin-enrichment-sync] Error syncing profile:", error);
    return NextResponse.json(
      { error: "An error occurred while syncing LinkedIn data." },
      { status: 500 },
    );
  }
}
