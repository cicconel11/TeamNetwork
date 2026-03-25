import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  syncLinkedInProfile,
  runBrightDataEnrichment,
  getLinkedInUrlForUser,
} from "@/lib/linkedin/oauth";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/linkedin/sync
 *
 * Re-fetches the user's LinkedIn profile data using the stored access token
 * and updates the connection record. Triggers enrichment via Bright Data
 * if a LinkedIn URL is available.
 *
 * Enforces:
 * - Org must have linkedin_resync_enabled = true
 * - Per-user monthly rate limit (2/month) via claim_linkedin_resync RPC
 * - Fail-closed: if rate limit check errors, sync is denied
 */
export async function POST() {
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

    // Check org toggle — user must belong to an org with resync enabled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgRole } = await (serviceClient as any)
      .from("user_organization_roles")
      .select("organization_id, organizations!inner(linkedin_resync_enabled)")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .eq("organizations.linkedin_resync_enabled", true)
      .limit(1)
      .maybeSingle();

    if (!orgRole) {
      return NextResponse.json(
        { error: "LinkedIn re-sync is not enabled for your organization." },
        { status: 403 },
      );
    }

    // Check rate limit — fail closed on error
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: claimResult, error: claimError } = await (serviceClient as any).rpc(
      "claim_linkedin_resync",
      { p_user_id: user.id },
    );

    if (claimError) {
      console.error("[linkedin-sync] Rate limit check error:", claimError);
      return NextResponse.json(
        { error: "Unable to verify sync eligibility. Please try again later." },
        { status: 503 },
      );
    }

    const claim = claimResult as { allowed: boolean; remaining?: number; reason?: string } | null;

    if (!claim || !claim.allowed) {
      const reason = claim?.reason;
      return NextResponse.json(
        {
          error: reason === "rate_limited"
            ? "You've reached your sync limit for this month (2 per month). Resets next month."
            : "LinkedIn connection not found. Please connect LinkedIn first.",
          remaining_syncs: 0,
        },
        { status: 429 },
      );
    }

    // Sync OAuth profile (name, photo) — existing behavior
    const result = await syncLinkedInProfile(serviceClient, user.id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to sync LinkedIn profile" },
        { status: 502 },
      );
    }

    // Best-effort enrichment via Bright Data
    const linkedinUrl = await getLinkedInUrlForUser(serviceClient, user.id);
    let enriched = false;

    if (linkedinUrl) {
      const enrichResult = await runBrightDataEnrichment(serviceClient, user.id, linkedinUrl);
      enriched = enrichResult.enriched;
    }

    return NextResponse.json({
      message: enriched ? "LinkedIn profile synced and enriched" : "LinkedIn profile synced",
      remaining_syncs: claim.remaining ?? null,
    });
  } catch (error) {
    console.error("[linkedin-sync] Error syncing profile:", error);
    return NextResponse.json(
      { error: "An error occurred while syncing your LinkedIn profile." },
      { status: 500 },
    );
  }
}
