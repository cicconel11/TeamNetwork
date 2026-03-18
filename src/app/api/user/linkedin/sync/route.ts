import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncLinkedInProfile, runProxycurlEnrichment, getLinkedInUrlForUser } from "@/lib/linkedin/oauth";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/linkedin/sync
 *
 * Re-fetches the user's LinkedIn profile data using the stored access token
 * and updates the connection record. Also triggers Proxycurl enrichment if
 * a LinkedIn URL is available.
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
    const result = await syncLinkedInProfile(serviceClient, user.id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to sync LinkedIn profile" },
        { status: 502 }
      );
    }

    // Best-effort enrichment — don't fail the sync if this errors
    const linkedinUrl = await getLinkedInUrlForUser(serviceClient, user.id);
    if (linkedinUrl) {
      const enrichResult = await runProxycurlEnrichment(serviceClient, user.id, linkedinUrl);
      if (enrichResult.enriched) {
        return NextResponse.json({ message: "LinkedIn profile synced and enriched" });
      }
    }

    return NextResponse.json({ message: "LinkedIn profile synced" });
  } catch (error) {
    console.error("[linkedin-sync] Error syncing profile:", error);
    return NextResponse.json(
      { error: "An error occurred while syncing your LinkedIn profile." },
      { status: 500 }
    );
  }
}
