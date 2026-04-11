import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getLinkedInIntegrationStatus } from "@/lib/linkedin/config.server";
import { isBrightDataConfigured } from "@/lib/linkedin/bright-data";
import { getLinkedInResyncStatus } from "@/lib/linkedin/resync";
import { getLinkedInStatusForUser } from "@/lib/linkedin/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/linkedin/status
 *
 * Returns the user's LinkedIn connection status, manual linkedin_url,
 * whether OAuth is available, and re-sync rate limit info.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
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
        brightDataConfigured: isBrightDataConfigured(),
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
