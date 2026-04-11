import { NextResponse } from "next/server";
import {
  getLinkedInIntegrationDisabledMessage,
  LINKEDIN_INTEGRATION_DISABLED_CODE,
} from "@/lib/linkedin/config";
import { getLinkedInIntegrationStatus } from "@/lib/linkedin/config.server";
import { createClient } from "@/lib/supabase/server";
import { getLinkedInAuthUrl } from "@/lib/linkedin/oauth";
import { createLinkedInOAuthState, normalizeLinkedInRedirectPath } from "@/lib/linkedin/state";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/linkedin/connect
 *
 * Initiates the LinkedIn OAuth / OIDC authorization flow.
 * Returns a JSON response with the redirect URL for the client to navigate to.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const integration = getLinkedInIntegrationStatus();
    if (!integration.oauthAvailable) {
      return NextResponse.json(
        {
          error: getLinkedInIntegrationDisabledMessage(),
          code: LINKEDIN_INTEGRATION_DISABLED_CODE,
        },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const redirectPath = normalizeLinkedInRedirectPath(
      (body as { redirectPath?: string }).redirectPath,
      "/settings/connected-accounts",
    );

    const oauthState = createLinkedInOAuthState({
      userId: user.id,
      redirectPath,
    });

    const redirectUrl = getLinkedInAuthUrl(oauthState.state);
    console.log("[linkedin-connect] redirect_uri used in OAuth URL:", redirectUrl.split("redirect_uri=")[1]?.split("&")[0]);
    const response = NextResponse.json({ redirectUrl });
    response.cookies.set(
      oauthState.cookie.name,
      oauthState.cookie.value,
      oauthState.cookie.options,
    );
    return response;
  } catch (error) {
    console.error("[linkedin-connect] Error initiating OAuth flow:", error);

    return NextResponse.json(
      { error: "Failed to initiate LinkedIn connection" },
      { status: 500 }
    );
  }
}
