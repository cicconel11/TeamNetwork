import { google } from "googleapis";
import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Environment variable helpers
function getGoogleClientId(): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId || clientId.trim() === "") {
        throw new Error("Missing required environment variable: GOOGLE_CLIENT_ID");
    }
    return clientId;
}

function getGoogleClientSecret(): string {
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientSecret || clientSecret.trim() === "") {
        throw new Error("Missing required environment variable: GOOGLE_CLIENT_SECRET");
    }
    return clientSecret;
}

function getGoogleRedirectUri(): string {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return `${appUrl}/api/google/callback`;
}

function getEncryptionKey(): Buffer {
    const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    if (!key || key.trim() === "") {
        throw new Error("Missing required environment variable: GOOGLE_TOKEN_ENCRYPTION_KEY");
    }
    // Key should be 32 bytes (64 hex characters) for AES-256
    if (key.length !== 64) {
        throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
    }
    return Buffer.from(key, "hex");
}

// OAuth configuration
export interface GoogleOAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
}

// Token response from Google OAuth
export interface TokenResponse {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    email: string;
}

// OAuth error types
export interface OAuthError {
    code: string;
    message: string;
}

// Required scopes for Google Calendar integration
const GOOGLE_CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
];

/**
 * Creates an OAuth2 client configured with Google credentials
 */
export function createOAuth2Client() {
    return new google.auth.OAuth2(
        getGoogleClientId(),
        getGoogleClientSecret(),
        getGoogleRedirectUri()
    );
}

/**
 * Generates the Google OAuth authorization URL for user consent
 * @param state - State parameter for CSRF protection (should contain user ID)
 * @returns The authorization URL to redirect the user to
 */
export function getAuthorizationUrl(state: string): string {
    const oauth2Client = createOAuth2Client();

    return oauth2Client.generateAuthUrl({
        access_type: "offline", // Required to get refresh token
        scope: GOOGLE_CALENDAR_SCOPES,
        state,
        prompt: "consent", // Force consent to always get refresh token
        include_granted_scopes: true,
    });
}

/**
 * Extracts components from an OAuth authorization URL for validation
 */
export function parseAuthorizationUrl(url: string): {
    clientId: string | null;
    redirectUri: string | null;
    scopes: string[];
    state: string | null;
    accessType: string | null;
} {
    const parsed = new URL(url);
    const params = parsed.searchParams;

    const scopeParam = params.get("scope") || "";
    const scopes = scopeParam.split(" ").filter(Boolean);

    return {
        clientId: params.get("client_id"),
        redirectUri: params.get("redirect_uri"),
        scopes,
        state: params.get("state"),
        accessType: params.get("access_type"),
    };
}

/**
 * Encrypts a token using AES-256-GCM
 * @param token - The plaintext token to encrypt
 * @returns The encrypted token as a base64 string (iv:authTag:ciphertext)
 */
export function encryptToken(token: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(token, "utf8", "base64");
    encrypted += cipher.final("base64");

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext (all base64)
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypts a token encrypted with encryptToken
 * @param encryptedToken - The encrypted token string
 * @returns The decrypted plaintext token
 */
export function decryptToken(encryptedToken: string): string {
    const key = getEncryptionKey();
    const parts = encryptedToken.split(":");

    if (parts.length !== 3) {
        throw new Error("Invalid encrypted token format");
    }

    const [ivBase64, authTagBase64, ciphertext] = parts;
    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
}

/**
 * Exchanges an authorization code for access and refresh tokens
 * @param code - The authorization code from Google callback
 * @returns Token response with access token, refresh token, expiry, and email
 */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    const oauth2Client = createOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
        throw new Error("No access token received from Google");
    }

    if (!tokens.refresh_token) {
        throw new Error("No refresh token received from Google. User may need to revoke access and reconnect.");
    }

    // Get user email
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    if (!userInfo.data.email) {
        throw new Error("Could not retrieve user email from Google");
    }

    // Calculate expiry time
    const expiresAt = tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3600 * 1000); // Default 1 hour if not provided

    return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        email: userInfo.data.email,
    };
}

/**
 * Refreshes an expired access token using the refresh token
 * @param refreshToken - The refresh token (decrypted)
 * @returns New token response with updated access token and expiry
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
}> {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
        throw new Error("Failed to refresh access token");
    }

    const expiresAt = credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600 * 1000);

    return {
        accessToken: credentials.access_token,
        expiresAt,
    };
}

/**
 * Revokes OAuth tokens when user disconnects
 * @param accessToken - The access token to revoke (decrypted)
 */
export async function revokeTokens(accessToken: string): Promise<void> {
    const oauth2Client = createOAuth2Client();
    await oauth2Client.revokeToken(accessToken);
}

/**
 * Checks if an access token is expired or about to expire
 * @param expiresAt - The token expiry date
 * @param bufferSeconds - Buffer time before expiry to consider token expired (default 5 minutes)
 * @returns true if token is expired or will expire within buffer time
 */
export function isTokenExpired(expiresAt: Date, bufferSeconds: number = 300): boolean {
    const bufferMs = bufferSeconds * 1000;
    return new Date().getTime() >= expiresAt.getTime() - bufferMs;
}

/**
 * Creates a user-friendly error message from OAuth errors
 */
export function getOAuthErrorMessage(error: string): string {
    const errorMessages: Record<string, string> = {
        access_denied: "You denied access to your Google Calendar. Please try again and allow access.",
        invalid_request: "The authorization request was invalid. Please try again.",
        invalid_client: "There was a configuration error. Please contact support.",
        invalid_grant: "The authorization code has expired. Please try connecting again.",
        unauthorized_client: "This application is not authorized. Please contact support.",
        unsupported_response_type: "There was a configuration error. Please contact support.",
        invalid_scope: "The requested permissions are invalid. Please contact support.",
        server_error: "Google's servers encountered an error. Please try again later.",
        temporarily_unavailable: "Google's servers are temporarily unavailable. Please try again later.",
    };

    return errorMessages[error] || "An unexpected error occurred. Please try again.";
}


/**
 * Stores OAuth tokens in the database after successful authorization
 * @param supabase - Supabase client (service role for server-side operations)
 * @param userId - The user's ID
 * @param tokens - The token response from Google
 * @returns The created connection record
 */
export async function storeCalendarConnection(
    supabase: SupabaseClient<Database>,
    userId: string,
    tokens: TokenResponse
): Promise<{ success: boolean; error?: string }> {
    const encryptedAccessToken = encryptToken(tokens.accessToken);
    const encryptedRefreshToken = encryptToken(tokens.refreshToken);

    const { error } = await supabase
        .from("user_calendar_connections")
        .upsert({
            user_id: userId,
            google_email: tokens.email,
            access_token_encrypted: encryptedAccessToken,
            refresh_token_encrypted: encryptedRefreshToken,
            token_expires_at: tokens.expiresAt.toISOString(),
            status: "connected",
            last_sync_at: new Date().toISOString(),
        }, {
            onConflict: "user_id",
        });

    if (error) {
        console.error("[google-oauth] Failed to store calendar connection:", error);
        return { success: false, error: error.message };
    }

    return { success: true };
}

/**
 * Retrieves a user's calendar connection from the database
 * @param supabase - Supabase client
 * @param userId - The user's ID
 * @returns The connection record with decrypted tokens, or null if not found
 */
export async function getCalendarConnection(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<{
    id: string;
    googleEmail: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    status: "connected" | "disconnected" | "error";
    targetCalendarId: string;
    lastSyncAt: Date | null;
} | null> {
    const { data, error } = await supabase
        .from("user_calendar_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error || !data) {
        return null;
    }

    try {
        return {
            id: data.id,
            googleEmail: data.google_email,
            accessToken: decryptToken(data.access_token_encrypted),
            refreshToken: decryptToken(data.refresh_token_encrypted),
            expiresAt: new Date(data.token_expires_at),
            status: data.status,
            targetCalendarId: data.target_calendar_id,
            lastSyncAt: data.last_sync_at ? new Date(data.last_sync_at) : null,
        };
    } catch (decryptError) {
        console.error("[google-oauth] Failed to decrypt tokens for user:", userId, decryptError);
        return null;
    }
}

/**
 * Updates the connection status in the database
 * @param supabase - Supabase client
 * @param userId - The user's ID
 * @param status - The new status
 */
export async function updateConnectionStatus(
    supabase: SupabaseClient<Database>,
    userId: string,
    status: "connected" | "disconnected" | "error"
): Promise<void> {
    await supabase
        .from("user_calendar_connections")
        .update({ status })
        .eq("user_id", userId);
}

/**
 * Updates the stored tokens after a refresh
 * @param supabase - Supabase client
 * @param userId - The user's ID
 * @param accessToken - The new access token (plaintext)
 * @param expiresAt - The new expiry time
 */
export async function updateStoredTokens(
    supabase: SupabaseClient<Database>,
    userId: string,
    accessToken: string,
    expiresAt: Date
): Promise<void> {
    const encryptedAccessToken = encryptToken(accessToken);

    await supabase
        .from("user_calendar_connections")
        .update({
            access_token_encrypted: encryptedAccessToken,
            token_expires_at: expiresAt.toISOString(),
            status: "connected",
        })
        .eq("user_id", userId);
}

/**
 * Removes a user's calendar connection from the database
 * @param supabase - Supabase client
 * @param userId - The user's ID
 */
export async function removeCalendarConnection(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<void> {
    await supabase
        .from("user_calendar_connections")
        .delete()
        .eq("user_id", userId);
}


/**
 * Attempts to refresh an expired access token and update the database
 * If refresh fails, marks the connection as disconnected
 * @param supabase - Supabase client
 * @param userId - The user's ID
 * @returns The new access token if successful, null if refresh failed
 */
export async function refreshAndStoreToken(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<string | null> {
    const connection = await getCalendarConnection(supabase, userId);

    if (!connection) {
        return null;
    }

    try {
        const { accessToken, expiresAt } = await refreshAccessToken(connection.refreshToken);
        await updateStoredTokens(supabase, userId, accessToken, expiresAt);
        return accessToken;
    } catch (error) {
        console.error("[google-oauth] Failed to refresh token:", error);
        // Mark connection as disconnected per requirement 7.2
        await updateConnectionStatus(supabase, userId, "disconnected");
        return null;
    }
}

/**
 * Gets a valid access token for a user, refreshing if necessary
 * @param supabase - Supabase client
 * @param userId - The user's ID
 * @returns The access token if available and valid, null otherwise
 */
export async function getValidAccessToken(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<string | null> {
    const connection = await getCalendarConnection(supabase, userId);

    if (!connection || connection.status !== "connected") {
        return null;
    }

    // Check if token is expired or about to expire
    if (isTokenExpired(connection.expiresAt)) {
        // Attempt to refresh
        return refreshAndStoreToken(supabase, userId);
    }

    return connection.accessToken;
}


/**
 * Disconnects a user's Google Calendar by revoking tokens and removing the connection
 * @param supabase - Supabase client
 * @param userId - The user's ID
 * @returns Success status and any error message
 */
export async function disconnectCalendar(
    supabase: SupabaseClient<Database>,
    userId: string
): Promise<{ success: boolean; error?: string }> {
    const connection = await getCalendarConnection(supabase, userId);

    if (!connection) {
        return { success: true }; // Already disconnected
    }

    try {
        // Attempt to revoke the token with Google
        await revokeTokens(connection.accessToken);
    } catch (error) {
        // Log but don't fail - token may already be revoked
        console.warn("[google-oauth] Failed to revoke token (may already be revoked):", error);
    }

    // Remove the connection from the database regardless of revocation result
    await removeCalendarConnection(supabase, userId);

    // Also clean up any event calendar entries for this user
    await supabase
        .from("event_calendar_entries")
        .delete()
        .eq("user_id", userId);

    return { success: true };
}
