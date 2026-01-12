import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthorizationUrl } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/google/auth
 * 
 * Initiates the Google OAuth 2.0 authorization flow for connecting
 * a user's Google Calendar.
 * 
 * Requirements: 1.2
 * - Generates state parameter with user ID for CSRF protection
 * - Redirects to Google authorization URL
 * - Supports optional redirect parameter to return to a specific page
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const redirectPath = url.searchParams.get("redirect") || "/settings/notifications";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

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

        // Get the Google OAuth authorization URL
        const authUrl = getAuthorizationUrl(state);

        // Redirect to Google's consent screen
        return NextResponse.redirect(authUrl);
    } catch (error) {
        console.error("[google-auth] Error initiating OAuth flow:", error);

        // Log specific error details for debugging
        if (error instanceof Error) {
            console.error("[google-auth] Error message:", error.message);
            if (error.message.includes("GOOGLE_CLIENT_ID")) {
                console.error("[google-auth] Missing GOOGLE_CLIENT_ID environment variable");
            }
            if (error.message.includes("GOOGLE_CLIENT_SECRET")) {
                console.error("[google-auth] Missing GOOGLE_CLIENT_SECRET environment variable");
            }
            if (error.message.includes("GOOGLE_TOKEN_ENCRYPTION_KEY")) {
                console.error("[google-auth] Missing GOOGLE_TOKEN_ENCRYPTION_KEY environment variable");
            }
        }

        // Redirect back to the original page with error
        const errorUrl = new URL(redirectPath, appUrl);
        errorUrl.searchParams.set("error", "oauth_init_failed");

        return NextResponse.redirect(errorUrl);
    }
}
