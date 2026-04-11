import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { performBrightDataSync } from "@/lib/linkedin/resync";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/linkedin/bright-data-sync
 *
 * Refreshes the user's LinkedIn enrichment data from their saved public
 * LinkedIn profile URL via Bright Data.
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
    const result = await performBrightDataSync(serviceClient, user.id);

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[linkedin-bright-data-sync] Error syncing profile:", error);
    return NextResponse.json(
      { error: "An error occurred while syncing LinkedIn data." },
      { status: 500 },
    );
  }
}
