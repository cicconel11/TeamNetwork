import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  parseLinkedInUrlPatchBody,
  saveLinkedInUrlForUser,
} from "@/lib/linkedin/settings";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/user/linkedin/url
 *
 * Saves a LinkedIn profile URL to the user's member and alumni records
 * across all organizations.
 */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsedBody = parseLinkedInUrlPatchBody(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error },
        { status: 400 }
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
        { status: saveResult.reason === "not_found" ? 404 : 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[linkedin-url] Error saving URL:", error);
    return NextResponse.json(
      { error: "Failed to save LinkedIn URL" },
      { status: 500 }
    );
  }
}
