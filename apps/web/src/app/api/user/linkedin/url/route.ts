import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  parseLinkedInUrlPatchBody,
  saveLinkedInUrlForUser,
} from "@/lib/linkedin/settings";
import { runBrightDataEnrichment } from "@/lib/linkedin/oauth";
import { buildRateLimitResponse, checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/user/linkedin/url
 *
 * Saves a LinkedIn profile URL to the user's member and alumni records
 * across all organizations. Triggers Bright Data enrichment if a URL is provided.
 */
export async function PATCH(request: Request) {
  try {
    const ipRateLimit = checkRateLimit(request, {
      feature: "linkedin url",
      limitPerIp: 20,
      limitPerUser: 0,
    });
    if (!ipRateLimit.ok) return buildRateLimitResponse(ipRateLimit);

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: ipRateLimit.headers });
    }

    const userRateLimit = checkRateLimit(request, {
      feature: "linkedin url",
      limitPerIp: 0,
      limitPerUser: 10,
      userId: user.id,
    });
    if (!userRateLimit.ok) return buildRateLimitResponse(userRateLimit);

    const body = await request.json();
    const parsedBody = parseLinkedInUrlPatchBody(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error },
        { status: 400, headers: userRateLimit.headers }
      );
    }

    const serviceClient = createServiceClient();
    const saveResult = await saveLinkedInUrlForUser(
      serviceClient,
      user.id,
      parsedBody.linkedinUrl,
    );

    if (!saveResult.success) {
      return NextResponse.json(
        { error: saveResult.error },
        { status: saveResult.reason === "not_found" ? 404 : 500, headers: userRateLimit.headers }
      );
    }

    // Best-effort enrichment when a URL is saved
    if (parsedBody.linkedinUrl) {
      await runBrightDataEnrichment(serviceClient, user.id, parsedBody.linkedinUrl);
    }

    return NextResponse.json({ success: true }, { headers: userRateLimit.headers });
  } catch (error) {
    console.error("[linkedin-url] Error saving URL:", error);
    return NextResponse.json(
      { error: "Failed to save LinkedIn URL" },
      { status: 500 }
    );
  }
}
