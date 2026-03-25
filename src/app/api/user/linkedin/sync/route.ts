import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  syncLinkedInProfile,
  runProxycurlEnrichment,
  runBrightDataEnrichment,
  getLinkedInUrlForUser,
} from "@/lib/linkedin/oauth";
import { isBrightDataConfigured } from "@/lib/linkedin/bright-data";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/linkedin/sync
 *
 * Re-fetches the user's LinkedIn profile data using the stored access token
 * and updates the connection record. Triggers enrichment via Bright Data
 * (preferred) or Proxycurl (fallback) if a LinkedIn URL is available.
 *
 * Enforces a per-user monthly rate limit (2/month) via the
 * claim_linkedin_resync RPC when the org has the feature enabled.
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

    // Check rate limit via claim_linkedin_resync RPC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: claimResult, error: claimError } = await (serviceClient as any).rpc(
      "claim_linkedin_resync",
      { p_user_id: user.id },
    );

    if (claimError) {
      console.error("[linkedin-sync] Rate limit check error:", claimError);
      // Proceed anyway — don't block sync on rate limit infrastructure failure
    }

    const claim = claimResult as { allowed: boolean; remaining?: number; reason?: string } | null;

    if (claim && !claim.allowed) {
      return NextResponse.json(
        {
          error: claim.reason === "rate_limited"
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

    // Best-effort enrichment — prefer Bright Data, fall back to Proxycurl
    const linkedinUrl = await getLinkedInUrlForUser(serviceClient, user.id);
    let enriched = false;

    if (linkedinUrl) {
      if (isBrightDataConfigured()) {
        const enrichResult = await runBrightDataEnrichment(serviceClient, user.id, linkedinUrl);
        enriched = enrichResult.enriched;
      } else {
        const enrichResult = await runProxycurlEnrichment(serviceClient, user.id, linkedinUrl);
        enriched = enrichResult.enriched;
      }
    }

    const remaining = claim?.remaining ?? null;

    return NextResponse.json({
      message: enriched ? "LinkedIn profile synced and enriched" : "LinkedIn profile synced",
      remaining_syncs: remaining,
    });
  } catch (error) {
    console.error("[linkedin-sync] Error syncing profile:", error);
    return NextResponse.json(
      { error: "An error occurred while syncing your LinkedIn profile." },
      { status: 500 },
    );
  }
}
