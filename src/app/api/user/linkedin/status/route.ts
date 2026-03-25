import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getLinkedInIntegrationStatus } from "@/lib/linkedin/config.server";
import { getLinkedInStatusForUser } from "@/lib/linkedin/settings";

export const dynamic = "force-dynamic";

const MAX_SYNCS_PER_MONTH = 2;

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

    // Fetch resync rate limit info
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: connectionRow } = await (serviceClient as any)
      .from("user_linkedin_connections")
      .select("resync_count, resync_month")
      .eq("user_id", user.id)
      .maybeSingle();

    let resyncRemaining = MAX_SYNCS_PER_MONTH;
    if (connectionRow && connectionRow.resync_month === currentMonth) {
      resyncRemaining = Math.max(0, MAX_SYNCS_PER_MONTH - (connectionRow.resync_count ?? 0));
    }

    // Check if user's org has resync enabled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgRole } = await (serviceClient as any)
      .from("user_organization_roles")
      .select("organization_id, organizations!inner(linkedin_resync_enabled)")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();

    const resyncEnabled = orgRole?.organizations?.linkedin_resync_enabled ?? false;

    return NextResponse.json({
      linkedin_url: status.linkedin_url,
      connection: status.connection,
      integration: {
        oauthAvailable: integration.oauthAvailable,
        reason: integration.reason,
      },
      resync: {
        enabled: resyncEnabled,
        remaining: resyncRemaining,
        max_per_month: MAX_SYNCS_PER_MONTH,
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
