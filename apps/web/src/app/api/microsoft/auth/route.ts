import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MICROSOFT_REDIRECT_PATH, sanitizeMicrosoftRedirectPath } from "@/lib/microsoft/redirect";
import { getMicrosoftAuthorizationUrl } from "@/lib/microsoft/oauth";
import { getAppUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

/**
 * GET /api/microsoft/auth
 *
 * Initiates the Microsoft OAuth 2.0 authorization flow for connecting
 * a user's Outlook Calendar.
 *
 * - Generates state parameter with user ID for CSRF protection
 * - Redirects to Microsoft authorization URL
 * - Supports optional redirect parameter to return to a specific page
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const rawRedirect = url.searchParams.get("redirect") || DEFAULT_MICROSOFT_REDIRECT_PATH;
    const redirectPath = sanitizeMicrosoftRedirectPath(rawRedirect);
    const appUrl = getAppUrl();

    try {
        // Get the authenticated user
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.redirect(
                new URL(`/auth/login?error=unauthorized&next=${encodeURIComponent(redirectPath)}`, appUrl)
            );
        }

        // Generate state parameter containing user ID and redirect path for CSRF protection
        // Format: userId:timestamp:redirectPath (base64 encoded redirect path)
        const timestamp = Date.now();
        const encodedRedirect = Buffer.from(redirectPath).toString("base64");
        const state = `${user.id}:${timestamp}:${encodedRedirect}`;

        // Get the Microsoft OAuth authorization URL
        const authUrl = getMicrosoftAuthorizationUrl(state);

        // Redirect to Microsoft's consent screen
        return NextResponse.redirect(authUrl);
    } catch (error) {
        console.error("[microsoft-auth] Error initiating OAuth flow:", error);

        if (error instanceof Error) {
            console.error("[microsoft-auth] Error message:", error.message);
        }

        // Redirect back to the original page with error
        const errorUrl = new URL(redirectPath, appUrl);
        errorUrl.searchParams.set("error", "oauth_init_failed");

        return NextResponse.redirect(errorUrl);
    }
}
