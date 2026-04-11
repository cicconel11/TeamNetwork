import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import type { Database } from "@/types/database";
import { getAppUrl } from "@/lib/url";
import {
    encryptToken as sharedEncrypt,
    decryptToken as sharedDecrypt,
} from "@/lib/crypto/token-encryption";

// Environment variable helpers
function getMicrosoftClientId(): string {
    const id = process.env.MICROSOFT_CLIENT_ID;
    if (!id || id.trim() === "") {
        throw new Error("Missing required environment variable: MICROSOFT_CLIENT_ID");
    }
    return id;
}

function getMicrosoftClientSecret(): string {
    const secret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!secret || secret.trim() === "") {
        throw new Error("Missing required environment variable: MICROSOFT_CLIENT_SECRET");
    }
    return secret;
}

function getMicrosoftRedirectUri(): string {
    return `${getAppUrl()}/api/microsoft/callback`;
}

function getEncryptionKey(): string {
    const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    if (!key || key.trim() === "") {
        throw new Error("Missing required environment variable: GOOGLE_TOKEN_ENCRYPTION_KEY");
    }
    return key;
}

const MICROSOFT_AUTH_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_GRAPH_ME = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";

const MICROSOFT_SCOPES = [
    "Calendars.ReadWrite",
    "Calendars.Read.Shared",
    "User.Read",
    "offline_access",
];
const MICROSOFT_REFRESH_LOCK_TTL_MS = 30_000;
const MICROSOFT_REFRESH_LOCK_WAIT_MS = 250;
const MICROSOFT_REFRESH_LOCK_MAX_WAITS = 20;

/**
 * Extracts error code from Microsoft token endpoint response.
 * Logs the error details without exposing the full response body.
 */
function extractMicrosoftErrorCode(errorText: string): string {
    try {
        const parsed = JSON.parse(errorText);
        return parsed.error || "unknown_error";
    } catch {
        return "parse_error";
    }
}

export interface MicrosoftTokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    email: string;
}

export type MicrosoftConnectionStatus = "connected" | "disconnected" | "reconnect_required" | "error";

/**
 * Encrypts a token using the shared AES-256-GCM module
 */
export function encryptToken(token: string): string {
    return sharedEncrypt(token, getEncryptionKey());
}

/**
 * Decrypts a token using the shared AES-256-GCM module
 */
export function decryptToken(encryptedToken: string): string {
    return sharedDecrypt(encryptedToken, getEncryptionKey());
}

/**
 * Generates the Microsoft OAuth 2.0 authorization URL
 */
export function getMicrosoftAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
        client_id: getMicrosoftClientId(),
        response_type: "code",
        redirect_uri: getMicrosoftRedirectUri(),
        scope: MICROSOFT_SCOPES.join(" "),
        state,
        prompt: "consent",
        response_mode: "query",
    });

    return `${MICROSOFT_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchanges an authorization code for access and refresh tokens
 */
export async function exchangeMicrosoftCodeForTokens(code: string): Promise<MicrosoftTokenResponse> {
    const body = new URLSearchParams({
        client_id: getMicrosoftClientId(),
        client_secret: getMicrosoftClientSecret(),
        code,
        redirect_uri: getMicrosoftRedirectUri(),
        grant_type: "authorization_code",
        scope: MICROSOFT_SCOPES.join(" "),
    });

    const tokenResponse = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        const errorCode = extractMicrosoftErrorCode(errorText);
        console.error("[microsoft-oauth] Token exchange failed", {
            status: tokenResponse.status,
            error: errorCode,
        });
        throw new Error(`Token exchange failed: ${errorCode}`);
    }

    const tokens = await tokenResponse.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
    };

    if (!tokens.access_token) {
        throw new Error("No access token received from Microsoft");
    }

    if (!tokens.refresh_token) {
        throw new Error("No refresh token received from Microsoft. User may need to revoke access and reconnect.");
    }

    // Fetch user email from Microsoft Graph
    const userResponse = await fetch(MICROSOFT_GRAPH_ME, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userResponse.ok) {
        throw new Error("Could not retrieve user email from Microsoft");
    }

    const userInfo = await userResponse.json() as {
        mail?: string | null;
        userPrincipalName?: string | null;
    };

    const email = userInfo.mail ?? userInfo.userPrincipalName;
    if (!email) {
        throw new Error("Could not retrieve user email from Microsoft");
    }

    const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000);

    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        email,
    };
}

/**
 * Stores Outlook tokens in the database after successful authorization
 */
export async function storeMicrosoftConnection(
    supabase: SupabaseClient<Database>,
    userId: string,
    tokens: MicrosoftTokenResponse
): Promise<{ success: boolean; error?: string }> {
    const encryptedAccessToken = encryptToken(tokens.accessToken);
    const encryptedRefreshToken = encryptToken(tokens.refreshToken);
    const { data: existingConnection } = await supabase
        .from("user_calendar_connections")
        .select("target_calendar_id")
        .eq("user_id", userId)
        .eq("provider", "outlook")
        .maybeSingle();

    const { error } = await supabase
        .from("user_calendar_connections")
        .upsert({
            user_id: userId,
            provider: "outlook",
            provider_email: tokens.email,
            access_token_encrypted: encryptedAccessToken,
            refresh_token_encrypted: encryptedRefreshToken,
            token_expires_at: tokens.expiresAt.toISOString(),
            status: "connected",
            last_sync_at: new Date().toISOString(),
            target_calendar_id: existingConnection?.target_calendar_id ?? null,
        }, {
            onConflict: "user_id,provider",
        });

    if (error) {
        console.error("[microsoft-oauth] Failed to store connection:", error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

/**
 * Retrieves a user's Outlook calendar connection from the database
 */
export async function getMicrosoftConnection(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<{
    id: string;
    providerEmail: string;
    accessToken: string;
    refreshToken: string;
    refreshTokenEncrypted: string;
    expiresAt: Date;
    status: MicrosoftConnectionStatus;
    targetCalendarId: string | null;
    lastSyncAt: Date | null;
} | null> {
    const { data, error } = await supabase
        .from("user_calendar_connections")
        .select("*")
        .eq("user_id", userId)
        .eq("provider", "outlook")
        .maybeSingle();

    if (error || !data) {
        return null;
    }

    try {
        return {
            id: data.id,
            providerEmail: data.provider_email,
            accessToken: decryptToken(data.access_token_encrypted),
            refreshToken: decryptToken(data.refresh_token_encrypted),
            refreshTokenEncrypted: data.refresh_token_encrypted,
            expiresAt: new Date(data.token_expires_at),
            status: data.status as MicrosoftConnectionStatus,
            targetCalendarId: data.target_calendar_id ?? null,
            lastSyncAt: data.last_sync_at ? new Date(data.last_sync_at) : null,
        };
    } catch (decryptError) {
        console.error("[microsoft-oauth] Failed to decrypt tokens for user:", userId, decryptError);
        return null;
    }
}

/**
 * Updates the connection status in the database
 */
export async function updateMicrosoftConnectionStatus(
    supabase: SupabaseClient<Database>,
    userId: string,
    status: MicrosoftConnectionStatus
): Promise<void> {
    await supabase
        .from("user_calendar_connections")
        .update({ status })
        .eq("user_id", userId)
        .eq("provider", "outlook");
}

export async function markMicrosoftConnectionReconnectRequired(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<void> {
    await supabase
        .from("user_calendar_connections")
        .update({ status: "reconnect_required" })
        .eq("user_id", userId)
        .eq("provider", "outlook")
        .eq("status", "connected");
}

/**
 * Updates the stored tokens after a refresh.
 * CRITICAL: Microsoft rotates the refresh token on every refresh — must store both.
 */
export async function updateMicrosoftStoredTokens(
    supabase: SupabaseClient<Database>,
    userId: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date
): Promise<void> {
    const encryptedAccessToken = encryptToken(accessToken);
    const encryptedRefreshToken = encryptToken(refreshToken);

    await supabase
        .from("user_calendar_connections")
        .update({
            access_token_encrypted: encryptedAccessToken,
            refresh_token_encrypted: encryptedRefreshToken,
            token_expires_at: expiresAt.toISOString(),
            status: "connected",
        })
        .eq("user_id", userId)
        .eq("provider", "outlook");
}

/**
 * Checks if an access token is expired or about to expire (5-minute buffer)
 */
function isTokenExpired(expiresAt: Date, bufferSeconds = 300): boolean {
    const bufferMs = bufferSeconds * 1000;
    return new Date().getTime() >= expiresAt.getTime() - bufferMs;
}

/**
 * Refreshes an expired access token using the refresh token.
 * Stores BOTH the new access token and new refresh token (Microsoft rotation).
 * On failure, marks connection as reconnect_required.
 */
export async function refreshAndStoreMicrosoftToken(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const connection = await getMicrosoftConnection(supabase, userId);

        if (!connection) {
            return null;
        }

        if (!isTokenExpired(connection.expiresAt)) {
            return connection.accessToken;
        }

        const lockId = randomUUID();
        const claimedLock = await claimMicrosoftTokenRefreshLock(supabase, userId, lockId);

        if (!claimedLock) {
            const waitedToken = await waitForMicrosoftTokenRefresh(supabase, userId);
            if (waitedToken) {
                return waitedToken;
            }
            continue;
        }

        try {
            const latestConnection = await getMicrosoftConnection(supabase, userId);
            if (!latestConnection) {
                return null;
            }

            if (!isTokenExpired(latestConnection.expiresAt)) {
                return latestConnection.accessToken;
            }

            const body = new URLSearchParams({
                client_id: getMicrosoftClientId(),
                client_secret: getMicrosoftClientSecret(),
                refresh_token: latestConnection.refreshToken,
                grant_type: "refresh_token",
                scope: MICROSOFT_SCOPES.join(" "),
            });

            const response = await fetch(MICROSOFT_TOKEN_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body.toString(),
            });

            if (!response.ok) {
                const errorText = await response.text();
                const errorCode = extractMicrosoftErrorCode(errorText);
                console.error("[microsoft-oauth] Token refresh failed", {
                    status: response.status,
                    error: errorCode,
                });
                throw new Error(`Token refresh failed: ${errorCode}`);
            }

            const tokens = await response.json() as {
                access_token?: string;
                refresh_token?: string;
                expires_in?: number;
            };

            if (!tokens.access_token) {
                throw new Error("Failed to refresh access token");
            }

            const expiresAt = tokens.expires_in
                ? new Date(Date.now() + tokens.expires_in * 1000)
                : new Date(Date.now() + 3600 * 1000);

            const newRefreshToken = tokens.refresh_token || latestConnection.refreshToken;
            await updateMicrosoftStoredTokens(supabase, userId, tokens.access_token, newRefreshToken, expiresAt);

            return tokens.access_token;
        } catch (error) {
            console.error("[microsoft-oauth] Failed to refresh token:", error);
            await markMicrosoftConnectionReconnectRequiredIfUnchanged(
                supabase,
                userId,
                connection.refreshTokenEncrypted
            );
            return null;
        } finally {
            await releaseMicrosoftTokenRefreshLock(supabase, userId, lockId);
        }
    }

    return null;
}

/**
 * Gets a valid access token for a user, refreshing if necessary.
 * Returns null if the connection is missing, disconnected, or reconnect_required.
 */
export async function getMicrosoftValidAccessToken(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<string | null> {
    const connection = await getMicrosoftConnection(supabase, userId);

    if (!connection || connection.status !== "connected") {
        return null;
    }

    if (isTokenExpired(connection.expiresAt)) {
        return refreshAndStoreMicrosoftToken(supabase, userId);
    }

    return connection.accessToken;
}

async function claimMicrosoftTokenRefreshLock(
    supabase: SupabaseClient<Database>,
    userId: string,
    lockId: string
): Promise<boolean> {
    const lockExpiresAt = new Date(Date.now() + MICROSOFT_REFRESH_LOCK_TTL_MS).toISOString();
    const rpcClient = supabase as unknown as {
        rpc: (
            fn: string,
            args?: Record<string, unknown>
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };

    const { data, error } = await rpcClient.rpc("claim_microsoft_token_refresh_lock", {
        p_user_id: userId,
        p_lock_id: lockId,
        p_lock_expires_at: lockExpiresAt,
    });

    if (error) {
        console.error("[microsoft-oauth] Failed to claim refresh lock:", error);
        return false;
    }

    return data === true;
}

async function releaseMicrosoftTokenRefreshLock(
    supabase: SupabaseClient<Database>,
    userId: string,
    lockId: string
): Promise<void> {
    const rpcClient = supabase as unknown as {
        rpc: (
            fn: string,
            args?: Record<string, unknown>
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };

    const { error } = await rpcClient.rpc("release_microsoft_token_refresh_lock", {
        p_user_id: userId,
        p_lock_id: lockId,
    });

    if (error) {
        console.error("[microsoft-oauth] Failed to release refresh lock:", error);
    }
}

async function waitForMicrosoftTokenRefresh(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<string | null> {
    for (let attempt = 0; attempt < MICROSOFT_REFRESH_LOCK_MAX_WAITS; attempt++) {
        await sleep(MICROSOFT_REFRESH_LOCK_WAIT_MS);

        const connection = await getMicrosoftConnection(supabase, userId);
        if (!connection || connection.status !== "connected") {
            return null;
        }

        if (!isTokenExpired(connection.expiresAt)) {
            return connection.accessToken;
        }
    }

    return null;
}

async function markMicrosoftConnectionReconnectRequiredIfUnchanged(
    supabase: SupabaseClient<Database>,
    userId: string,
    refreshTokenEncrypted: string
): Promise<void> {
    await supabase
        .from("user_calendar_connections")
        .update({ status: "reconnect_required" })
        .eq("user_id", userId)
        .eq("provider", "outlook")
        .eq("refresh_token_encrypted", refreshTokenEncrypted);
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Disconnects a user's Outlook Calendar by removing the local connection and related records.
 */
export async function disconnectMicrosoft(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<{ success: boolean; error?: string }> {
    // Idempotent provider-scoped cleanup. Do not depend on getMicrosoftConnection,
    // because token decryption can fail (e.g. encryption key rotated) and would
    // otherwise leave stale rows behind that strand the user as "Connected".

    await supabase
        .from("user_calendar_connections")
        .delete()
        .eq("user_id", userId)
        .eq("provider", "outlook");

    await supabase
        .from("event_calendar_entries")
        .delete()
        .eq("user_id", userId)
        .eq("provider", "outlook");

    await supabase
        .from("calendar_feeds")
        .delete()
        .eq("connected_user_id", userId)
        .eq("provider", "outlook")
        .eq("scope", "personal");

    await supabase
        .from("schedule_sources")
        .delete()
        .eq("connected_user_id", userId)
        .eq("vendor_id", "outlook_calendar");

    return { success: true };
}

/**
 * Maps Microsoft OAuth / AADSTS error codes to user-friendly messages
 */
export function getMicrosoftOAuthErrorMessage(error: string, description?: string): string {
    // AADSTS error codes from Microsoft identity platform
    if (error.includes("AADSTS65001") || (description && description.includes("AADSTS65001"))) {
        return "Your organization requires admin consent to use this application. Please contact your IT administrator.";
    }
    if (error.includes("AADSTS90094") || (description && description.includes("AADSTS90094"))) {
        return "Your organization's admin has already granted consent. Please try connecting again.";
    }
    if (error.includes("AADSTS50076") || error.includes("AADSTS50079") ||
        (description && (description.includes("AADSTS50076") || description.includes("AADSTS50079")))) {
        return "Multi-factor authentication is required. Please complete MFA and try again.";
    }

    const errorMessages: Record<string, string> = {
        access_denied: "You denied access to your Outlook Calendar. Please try again and allow access.",
        invalid_request: "The authorization request was invalid. Please try again.",
        invalid_client: "There was a configuration error. Please contact support.",
        invalid_grant: "The authorization code has expired or was revoked. Please try connecting again.",
        unauthorized_client: "This application is not authorized. Please contact support.",
        unsupported_response_type: "There was a configuration error. Please contact support.",
        invalid_scope: "The requested permissions are invalid. Please contact support.",
        server_error: "Microsoft's servers encountered an error. Please try again later.",
        temporarily_unavailable: "Microsoft's servers are temporarily unavailable. Please try again later.",
    };

    return errorMessages[error] || "An unexpected error occurred. Please try again.";
}
