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
 * a LinkedIn URL is available (rate-limited to once per 30 days).
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

    // Best-effort enrichment — rate-limited to once per 30 days
    try {
      const linkedinUrl = await getLinkedInUrlForUser(serviceClient, user.id);
      if (linkedinUrl) {
        const enrichResult = await runProxycurlEnrichment(serviceClient, user.id, linkedinUrl);
        if (enrichResult.enriched) {
          return NextResponse.json({ message: "LinkedIn profile synced and enriched" });
        }
        if (enrichResult.rateLimited) {
          return NextResponse.json({
            message: "LinkedIn profile synced",
            enrichment: {
              rateLimited: true,
              retryAfterDays: enrichResult.retryAfterDays,
            },
          });
        }
      }
    } catch (enrichErr) {
      console.error("[linkedin-sync] Best-effort enrichment failed:", enrichErr);
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
