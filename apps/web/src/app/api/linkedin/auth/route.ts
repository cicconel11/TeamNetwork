import { NextResponse } from "next/server";
import {
  getLinkedInIntegrationDisabledMessage,
  LINKEDIN_INTEGRATION_DISABLED_CODE,
} from "@/lib/linkedin/config";
import { getLinkedInIntegrationStatus } from "@/lib/linkedin/config.server";
import { createClient } from "@/lib/supabase/server";
import { getLinkedInAuthUrl } from "@/lib/linkedin/oauth";
import { createLinkedInOAuthState, normalizeLinkedInRedirectPath } from "@/lib/linkedin/state";
import { getAppUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * GET /api/linkedin/auth
 *
 * Initiates the LinkedIn OAuth / OIDC authorization flow.
 * Mirrors the Google Calendar OAuth auth route pattern.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirectPath = normalizeLinkedInRedirectPath(
    url.searchParams.get("redirect"),
    "/settings/connected-accounts",
  );
  const appUrl = getAppUrl();

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(
        new URL(`/auth/login?error=unauthorized&next=${encodeURIComponent(redirectPath)}`, appUrl)
      );
    }

    const integration = getLinkedInIntegrationStatus();
    if (!integration.oauthAvailable) {
      const errorUrl = new URL(redirectPath, appUrl);
      errorUrl.searchParams.set("error", LINKEDIN_INTEGRATION_DISABLED_CODE);
      errorUrl.searchParams.set("error_message", getLinkedInIntegrationDisabledMessage());
      return NextResponse.redirect(errorUrl);
    }

    const oauthState = createLinkedInOAuthState({
      userId: user.id,
      redirectPath,
    });

    const authUrl = getLinkedInAuthUrl(oauthState.state);
    const response = NextResponse.redirect(authUrl);
    response.cookies.set(
      oauthState.cookie.name,
      oauthState.cookie.value,
      oauthState.cookie.options,
    );
    return response;
  } catch (error) {
    console.error("[linkedin-auth] Error initiating OAuth flow:", error);

    const errorUrl = new URL(redirectPath, appUrl);
    errorUrl.searchParams.set("error", "oauth_init_failed");
    return NextResponse.redirect(errorUrl);
  }
}
