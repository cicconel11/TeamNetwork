import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  syncLinkedInProfile,
  runBrightDataEnrichment,
} from "@/lib/linkedin/oauth";
import { claimLinkedInResync } from "@/lib/linkedin/resync";
import { getLinkedInProfileUrlForUser } from "@/lib/linkedin/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/linkedin/sync
 *
 * Re-fetches the user's LinkedIn profile data using the stored access token
 * and updates the connection record. Triggers enrichment via Bright Data
 * if a LinkedIn URL is available.
 *
 * Admins can always sync their own profile regardless of the org toggle.
 * Non-admins require linkedin_resync_enabled = true on their org.
 * Rate limit (2/month) applies to all users.
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

    const claim = await claimLinkedInResync(serviceClient, user.id);
    if (!claim.ok) {
      return NextResponse.json(
        {
          error: claim.error,
          remaining_syncs: claim.remaining_syncs,
        },
        { status: claim.status },
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
    const linkedinUrl = await getLinkedInProfileUrlForUser(serviceClient, user.id);
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
