import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
    exchangeMicrosoftCodeForTokens,
    storeMicrosoftConnection,
    getMicrosoftOAuthErrorMessage,
} from "@/lib/microsoft/oauth";
import { getAppUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

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
 * GET /api/microsoft/callback
 *
 * Handles the OAuth 2.0 callback from Microsoft after user authorization.
 *
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
    const errorDescription = url.searchParams.get("error_description");

    // Parse state to get redirect path (use default if parsing fails)
    const parsedState = state ? parseState(state) : null;
    const redirectPath = parsedState?.redirectPath || DEFAULT_REDIRECT;
    const settingsUrl = `${getAppUrl()}${redirectPath}`;

    // Handle OAuth errors from Microsoft (including AADSTS-prefixed errors)
    if (error) {
        console.error("[microsoft-callback] OAuth error from Microsoft:", error, errorDescription);
        const errorUrl = new URL(settingsUrl);
        errorUrl.searchParams.set("error", error);
        errorUrl.searchParams.set(
            "error_message",
            getMicrosoftOAuthErrorMessage(error, errorDescription ?? undefined)
        );
        return NextResponse.redirect(errorUrl);
    }

    // Validate required parameters
    if (!code) {
        console.error("[microsoft-callback] Missing authorization code");
        const errorUrl = new URL(settingsUrl);
        errorUrl.searchParams.set("error", "missing_code");
        errorUrl.searchParams.set("error_message", "Authorization code was not provided. Please try again.");
        return NextResponse.redirect(errorUrl);
    }

    if (!state || !parsedState) {
        console.error("[microsoft-callback] Missing or invalid state parameter");
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
            console.error("[microsoft-callback] State parameter expired");
            const errorUrl = new URL(settingsUrl);
            errorUrl.searchParams.set("error", "state_expired");
            errorUrl.searchParams.set("error_message", "The authorization request has expired. Please try again.");
            return NextResponse.redirect(errorUrl);
        }

        // Verify the authenticated user matches the state
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            console.error("[microsoft-callback] User not authenticated");
            return NextResponse.redirect(
                new URL(`/auth/login?error=unauthorized&next=${encodeURIComponent(redirectPath)}`, getAppUrl())
            );
        }

        if (user.id !== stateUserId) {
            console.error("[microsoft-callback] State user ID mismatch");
            const errorUrl = new URL(settingsUrl);
            errorUrl.searchParams.set("error", "state_mismatch");
            errorUrl.searchParams.set("error_message", "Session mismatch. Please try connecting again.");
            return NextResponse.redirect(errorUrl);
        }

        // Exchange authorization code for tokens
        const tokens = await exchangeMicrosoftCodeForTokens(code);

        // Store the connection using service client (bypasses RLS)
        const serviceClient = createServiceClient();
        const result = await storeMicrosoftConnection(serviceClient, user.id, tokens);

        if (!result.success) {
            console.error("[microsoft-callback] Failed to store connection:", result.error);
            const errorUrl = new URL(settingsUrl);
            errorUrl.searchParams.set("error", "storage_failed");
            errorUrl.searchParams.set("error_message", "Failed to save your Outlook Calendar connection. Please try again.");
            return NextResponse.redirect(errorUrl);
        }

        // Success - redirect back to settings
        const successUrl = new URL(settingsUrl);
        successUrl.searchParams.set("calendar", "connected");
        return NextResponse.redirect(successUrl);

    } catch (error) {
        console.error("[microsoft-callback] Error processing callback:", error);

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorUrl = new URL(settingsUrl);

        // Provide user-friendly error messages for common errors
        if (errorMessage.includes("invalid_grant") || errorMessage.includes("expired")) {
            errorUrl.searchParams.set("error", "invalid_grant");
            errorUrl.searchParams.set("error_message", "The authorization code has expired. Please try connecting again.");
        } else if (errorMessage.includes("refresh_token")) {
            errorUrl.searchParams.set("error", "no_refresh_token");
            errorUrl.searchParams.set("error_message", "Could not get a refresh token. Please revoke access in your Microsoft account settings and try again.");
        } else if (errorMessage.includes("AADSTS")) {
            // AADSTS-prefixed errors from Microsoft identity platform
            console.error("[microsoft-callback] AADSTS error:", errorMessage);
            errorUrl.searchParams.set("error", "aadsts_error");
            errorUrl.searchParams.set("error_message", "Microsoft authentication failed. Please try connecting again.");
        } else {
            // 3-way classification: safe → config → unknown
            const safePatterns = [
                "No access token received",
                "No refresh token received",
                "Could not retrieve user email",
                "Failed to refresh access token",
            ];
            const configPatterns = [
                "Missing required environment variable",
                "ENCRYPTION_KEY",
                "must be 64 hex",
                "MICROSOFT_CLIENT_ID",
                "MICROSOFT_CLIENT_SECRET",
                "SUPABASE",
            ];

            const isSafe = safePatterns.some(p => errorMessage.includes(p));
            const isConfig = configPatterns.some(p => errorMessage.includes(p));

            if (isSafe) {
                errorUrl.searchParams.set("error", "callback_failed");
                errorUrl.searchParams.set("error_message", errorMessage);
            } else if (isConfig) {
                console.error("[microsoft-callback] Server config error:", errorMessage);
                errorUrl.searchParams.set("error", "server_config_error");
                errorUrl.searchParams.set(
                    "error_message",
                    "There is a server configuration issue. Please contact support."
                );
            } else {
                console.error("[microsoft-callback] Unclassified error:", errorMessage);
                errorUrl.searchParams.set("error", "callback_failed");
                errorUrl.searchParams.set(
                    "error_message",
                    "An unexpected error occurred while connecting your Outlook Calendar. Please try again later."
                );
            }
        }

        return NextResponse.redirect(errorUrl);
    }
}
