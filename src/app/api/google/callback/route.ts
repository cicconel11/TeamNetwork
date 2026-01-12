import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
    exchangeCodeForTokens,
    storeCalendarConnection,
    getOAuthErrorMessage,
} from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const SETTINGS_URL = `${APP_URL}/settings/notifications`;

/**
 * GET /api/google/callback
 * 
 * Handles the OAuth 2.0 callback from Google after user authorization.
 * 
 * Requirements: 1.3, 1.5
 * - Validates state parameter to prevent CSRF attacks
 * - Exchanges authorization code for tokens
 * - Stores encrypted tokens in user_calendar_connections
 * - Redirects back to settings page with success/error status
 */
export async function GET(request: Request) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Handle OAuth errors from Google
    if (error) {
        console.error("[google-callback] OAuth error from Google:", error);
        const errorUrl = new URL(SETTINGS_URL);
        errorUrl.searchParams.set("error", error);
        errorUrl.searchParams.set("error_message", getOAuthErrorMessage(error));
        return NextResponse.redirect(errorUrl);
    }

    // Validate required parameters
    if (!code) {
        console.error("[google-callback] Missing authorization code");
        const errorUrl = new URL(SETTINGS_URL);
        errorUrl.searchParams.set("error", "missing_code");
        errorUrl.searchParams.set("error_message", "Authorization code was not provided. Please try again.");
        return NextResponse.redirect(errorUrl);
    }

    if (!state) {
        console.error("[google-callback] Missing state parameter");
        const errorUrl = new URL(SETTINGS_URL);
        errorUrl.searchParams.set("error", "missing_state");
        errorUrl.searchParams.set("error_message", "Invalid request. Please try connecting again.");
        return NextResponse.redirect(errorUrl);
    }

    try {
        // Parse and validate state parameter
        // Format: userId:timestamp
        const [stateUserId, timestampStr] = state.split(":");
        const timestamp = parseInt(timestampStr, 10);

        if (!stateUserId || isNaN(timestamp)) {
            console.error("[google-callback] Invalid state format");
            const errorUrl = new URL(SETTINGS_URL);
            errorUrl.searchParams.set("error", "invalid_state");
            errorUrl.searchParams.set("error_message", "Invalid request. Please try connecting again.");
            return NextResponse.redirect(errorUrl);
        }

        // Check if state is not too old (15 minutes max)
        const maxAge = 15 * 60 * 1000; // 15 minutes
        if (Date.now() - timestamp > maxAge) {
            console.error("[google-callback] State parameter expired");
            const errorUrl = new URL(SETTINGS_URL);
            errorUrl.searchParams.set("error", "state_expired");
            errorUrl.searchParams.set("error_message", "The authorization request has expired. Please try again.");
            return NextResponse.redirect(errorUrl);
        }

        // Verify the authenticated user matches the state
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            console.error("[google-callback] User not authenticated");
            return NextResponse.redirect(
                new URL("/auth/login?error=unauthorized&next=/settings/notifications", APP_URL)
            );
        }

        if (user.id !== stateUserId) {
            console.error("[google-callback] State user ID mismatch");
            const errorUrl = new URL(SETTINGS_URL);
            errorUrl.searchParams.set("error", "state_mismatch");
            errorUrl.searchParams.set("error_message", "Session mismatch. Please try connecting again.");
            return NextResponse.redirect(errorUrl);
        }

        // Exchange authorization code for tokens
        const tokens = await exchangeCodeForTokens(code);

        // Store the connection using service client (bypasses RLS)
        const serviceClient = createServiceClient();
        const result = await storeCalendarConnection(serviceClient, user.id, tokens);

        if (!result.success) {
            console.error("[google-callback] Failed to store connection:", result.error);
            const errorUrl = new URL(SETTINGS_URL);
            errorUrl.searchParams.set("error", "storage_failed");
            errorUrl.searchParams.set("error_message", "Failed to save your Google Calendar connection. Please try again.");
            return NextResponse.redirect(errorUrl);
        }

        // Success - redirect back to settings
        const successUrl = new URL(SETTINGS_URL);
        successUrl.searchParams.set("calendar_connected", "true");
        return NextResponse.redirect(successUrl);

    } catch (error) {
        console.error("[google-callback] Error processing callback:", error);

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorUrl = new URL(SETTINGS_URL);

        // Provide user-friendly error messages for common errors
        if (errorMessage.includes("invalid_grant") || errorMessage.includes("expired")) {
            errorUrl.searchParams.set("error", "invalid_grant");
            errorUrl.searchParams.set("error_message", "The authorization code has expired. Please try connecting again.");
        } else if (errorMessage.includes("refresh_token")) {
            errorUrl.searchParams.set("error", "no_refresh_token");
            errorUrl.searchParams.set("error_message", "Could not get a refresh token. Please revoke access in your Google account settings and try again.");
        } else {
            errorUrl.searchParams.set("error", "callback_failed");
            errorUrl.searchParams.set("error_message", "An error occurred while connecting your Google Calendar. Please try again.");
        }

        return NextResponse.redirect(errorUrl);
    }
}
