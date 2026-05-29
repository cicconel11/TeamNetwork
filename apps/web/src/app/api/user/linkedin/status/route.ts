import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { getLinkedInIntegrationStatus } from "@/lib/linkedin/config.server";
import { isApifyConfigured } from "@/lib/linkedin/apify";
import { getLinkedInResyncStatus } from "@/lib/linkedin/resync";
import { getLinkedInStatusForUser } from "@/lib/linkedin/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/linkedin/status
 *
 * Returns the user's LinkedIn connection status, manual linkedin_url,
 * whether OAuth is available, and re-sync rate limit info.
 * Accepts cookie (web) or Bearer (mobile) auth.
 */
export async function GET(request: Request) {
  try {
    const { user } = await createAuthenticatedApiClient(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    const status = await getLinkedInStatusForUser(serviceClient, user.id);
    const integration = getLinkedInIntegrationStatus();
    const resync = await getLinkedInResyncStatus(serviceClient, user.id);

    return NextResponse.json({
      linkedin_url: status.linkedin_url,
      connection: status.connection,
      integration: {
        oauthAvailable: integration.oauthAvailable,
        enrichmentConfigured: isApifyConfigured(),
        reason: integration.reason,
      },
      resync: {
        enabled: resync.enabled,
        is_admin: resync.isAdmin,
        remaining: resync.remaining,
        max_per_month: resync.maxPerMonth,
      },
    });
  } catch (error) {
    console.error("[linkedin-status] Error fetching status:", error);
    return NextResponse.json(
      { error: "Failed to fetch LinkedIn status" },
      { status: 500 },
    );
  }
}
