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
const DEFAULT_REDIRECT = "/settings/notifications";

/**
 * Parses the state parameter and extracts user ID, timestamp, and redirect path
 */
function parseState(state: string): { userId: string; timestamp: number; redirectPath: string } | null {
    const parts = state.split(":");

    // Support both old format (userId:timestamp) and new format (userId:timestamp:encodedRedirect)
    if (parts.length < 2) return null;

    const userId = parts[0];
    const timestamp = parseInt(parts[1], 10);

    if (!userId || isNaN(timestamp)) return null;

    let redirectPath = DEFAULT_REDIRECT;
    if (parts.length >= 3) {
        try {
            redirectPath = Buffer.from(parts[2], "base64").toString("utf-8");
        } catch {
            // If decoding fails, use default
            redirectPath = DEFAULT_REDIRECT;
        }
    }

    return { userId, timestamp, redirectPath };
}

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

    // Parse state to get redirect path (use default if parsing fails)
    const parsedState = state ? parseState(state) : null;
    const redirectPath = parsedState?.redirectPath || DEFAULT_REDIRECT;
    const settingsUrl = `${APP_URL}${redirectPath}`;

    // Handle OAuth errors from Google
    if (error) {
        console.error("[google-callback] OAuth error from Google:", error);
        const errorUrl = new URL(settingsUrl);
        errorUrl.searchParams.set("error", error);
        errorUrl.searchParams.set("error_message", getOAuthErrorMessage(error));
        return NextResponse.redirect(errorUrl);
    }

    // Validate required parameters
    if (!code) {
        console.error("[google-callback] Missing authorization code");
        const errorUrl = new URL(settingsUrl);
        errorUrl.searchParams.set("error", "missing_code");
        errorUrl.searchParams.set("error_message", "Authorization code was not provided. Please try again.");
        return NextResponse.redirect(errorUrl);
    }

    if (!state || !parsedState) {
        console.error("[google-callback] Missing or invalid state parameter");
        const errorUrl = new URL(settingsUrl);
        errorUrl.searchParams.set("error", "missing_state");
        errorUrl.searchParams.set("error_message", "Invalid request. Please try connecting again.");
        return NextResponse.redirect(errorUrl);
    }

    try {
        const { userId: stateUserId, timestamp } = parsedState;

        // Check if state is not too old (15 minutes max)
        const maxAge = 15 * 60 * 1000; // 15 minutes
        if (Date.now() - timestamp > maxAge) {
            console.error("[google-callback] State parameter expired");
            const errorUrl = new URL(settingsUrl);
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
                new URL(`/auth/login?error=unauthorized&next=${encodeURIComponent(redirectPath)}`, APP_URL)
            );
        }

        if (user.id !== stateUserId) {
            console.error("[google-callback] State user ID mismatch");
            const errorUrl = new URL(settingsUrl);
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
            const errorUrl = new URL(settingsUrl);
            errorUrl.searchParams.set("error", "storage_failed");
            errorUrl.searchParams.set("error_message", "Failed to save your Google Calendar connection. Please try again.");
            return NextResponse.redirect(errorUrl);
        }

        // Success - redirect back to settings
        const successUrl = new URL(settingsUrl);
        successUrl.searchParams.set("calendar", "connected");
        return NextResponse.redirect(successUrl);

    } catch (error) {
        console.error("[google-callback] Error processing callback:", error);

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorUrl = new URL(settingsUrl);

        // Provide user-friendly error messages for common errors
        if (errorMessage.includes("invalid_grant") || errorMessage.includes("expired")) {
            errorUrl.searchParams.set("error", "invalid_grant");
            errorUrl.searchParams.set("error_message", "The authorization code has expired. Please try connecting again.");
        } else if (errorMessage.includes("refresh_token")) {
            errorUrl.searchParams.set("error", "no_refresh_token");
            errorUrl.searchParams.set("error_message", "Could not get a refresh token. Please revoke access in your Google account settings and try again.");
        } else {
            // Only pass through known user-friendly error messages;
            // server config errors (env vars, encryption key) get a generic fallback.
            const safePatterns = [
                "No access token received",
                "No refresh token received",
                "Could not retrieve user email",
                "Failed to refresh access token",
            ];
            const isSafe = safePatterns.some(p => errorMessage.includes(p));
            errorUrl.searchParams.set("error", "callback_failed");
            errorUrl.searchParams.set(
                "error_message",
                isSafe ? errorMessage : "An unexpected error occurred while connecting your Google Calendar. Please try again."
            );
        }

        return NextResponse.redirect(errorUrl);
    }
}
