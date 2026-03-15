import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getAppUrl } from "@/lib/url";
import {
  encryptToken as sharedEncrypt,
  decryptToken as sharedDecrypt,
} from "@/lib/crypto/token-encryption";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkedInProfile {
  sub: string;
  givenName: string;
  familyName: string;
  email: string;
  picture: string | null;
  emailVerified: boolean;
}

export interface LinkedInConnection {
  id: string;
  linkedinMemberId: string;
  linkedinEmail: string | null;
  linkedinGivenName: string | null;
  linkedinFamilyName: string | null;
  linkedinPictureUrl: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  status: "connected" | "disconnected" | "error";
  lastSyncAt: Date | null;
}

export interface LinkedInTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  profile: LinkedInProfile;
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getLinkedInClientId(): string {
  const v = process.env.LINKEDIN_CLIENT_ID;
  if (!v || v.trim() === "") {
    throw new Error("Missing required environment variable: LINKEDIN_CLIENT_ID");
  }
  return v;
}

function getLinkedInClientSecret(): string {
  const v = process.env.LINKEDIN_CLIENT_SECRET;
  if (!v || v.trim() === "") {
    throw new Error("Missing required environment variable: LINKEDIN_CLIENT_SECRET");
  }
  return v;
}

function getLinkedInEncryptionKey(): string {
  const v = process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
  if (!v || v.trim() === "") {
    throw new Error("Missing required environment variable: LINKEDIN_TOKEN_ENCRYPTION_KEY");
  }
  return v;
}

const LINKEDIN_CALLBACK_PATH = "/api/linkedin/callback";

function getLinkedInRedirectUri(): string {
  return `${getAppUrl()}${LINKEDIN_CALLBACK_PATH}`;
}

// ---------------------------------------------------------------------------
// Encryption wrappers (delegate to shared crypto)
// ---------------------------------------------------------------------------

export function encryptToken(token: string): string {
  return sharedEncrypt(token, getLinkedInEncryptionKey());
}

export function decryptToken(encrypted: string): string {
  return sharedDecrypt(encrypted, getLinkedInEncryptionKey());
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

/**
 * Builds the LinkedIn OAuth authorization URL.
 */
export function getLinkedInAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getLinkedInClientId(),
    redirect_uri: getLinkedInRedirectUri(),
    state,
    scope: "openid profile email offline_access",
  });
  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges an authorization code for tokens and fetches the user profile.
 */
export async function exchangeLinkedInCode(code: string): Promise<LinkedInTokenResponse> {
  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getLinkedInRedirectUri(),
      client_id: getLinkedInClientId(),
      client_secret: getLinkedInClientSecret(),
    }).toString(),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[linkedin-oauth] Token exchange failed:", body.substring(0, 200));
    throw new Error("Failed to exchange LinkedIn authorization code");
  }

  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    throw new Error("No access token received from LinkedIn");
  }

  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

  // Fetch user profile via OIDC userinfo
  const profileRes = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!profileRes.ok) {
    const body = await profileRes.text();
    console.error("[linkedin-oauth] Userinfo fetch failed:", body.substring(0, 200));
    throw new Error("Failed to fetch LinkedIn profile");
  }

  const profileData = await profileRes.json();

  const profile: LinkedInProfile = {
    sub: profileData.sub,
    givenName: profileData.given_name || "",
    familyName: profileData.family_name || "",
    email: profileData.email || "",
    picture: profileData.picture || null,
    emailVerified: profileData.email_verified ?? false,
  };

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || "",
    expiresAt,
    profile,
  };
}

/**
 * Refreshes an expired access token using the refresh token.
 */
export async function refreshLinkedInToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: getLinkedInClientId(),
      client_secret: getLinkedInClientSecret(),
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[linkedin-oauth] Token refresh failed:", body.substring(0, 200));
    throw new Error("Failed to refresh LinkedIn access token");
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error("No access token received during refresh");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
  };
}

// ---------------------------------------------------------------------------
// Token expiry
// ---------------------------------------------------------------------------

export function isTokenExpired(expiresAt: Date, bufferSeconds: number = 300): boolean {
  return Date.now() >= expiresAt.getTime() - bufferSeconds * 1000;
}

// ---------------------------------------------------------------------------
// Database operations (all use service client — no RLS write policies needed)
// ---------------------------------------------------------------------------

/**
 * Stores or updates a LinkedIn connection for a user (upsert on user_id).
 */
export async function storeLinkedInConnection(
  supabase: SupabaseClient<Database>,
  userId: string,
  tokens: LinkedInTokenResponse,
): Promise<{ success: boolean; error?: string }> {
  const encryptedAccess = encryptToken(tokens.accessToken);
  const encryptedRefresh = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;

  // user_linkedin_connections is not fully covered by generated types in this codepath.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("user_linkedin_connections")
    .upsert(
      {
        user_id: userId,
        linkedin_sub: tokens.profile.sub,
        linkedin_email: tokens.profile.email || null,
        linkedin_name: [tokens.profile.givenName, tokens.profile.familyName].filter(Boolean).join(" ") || null,
        linkedin_given_name: tokens.profile.givenName || null,
        linkedin_family_name: tokens.profile.familyName || null,
        linkedin_picture_url: tokens.profile.picture || null,
        access_token_encrypted: encryptedAccess,
        refresh_token_encrypted: encryptedRefresh,
        token_expires_at: tokens.expiresAt.toISOString(),
        status: "connected",
        last_synced_at: new Date().toISOString(),
        sync_error: null,
        // linkedin_profile_url: not populated — LinkedIn OIDC userinfo doesn't
      // expose the profile URL. Users can set it manually via the URL field.
      linkedin_data: {
          email_verified: tokens.profile.emailVerified,
        },
      },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[linkedin-oauth] Failed to store connection:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Retrieves a user's LinkedIn connection with decrypted tokens.
 */
export async function getLinkedInConnection(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LinkedInConnection | null> {
  // user_linkedin_connections is not fully covered by generated types in this codepath.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("user_linkedin_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  try {
    return {
      id: data.id,
      linkedinMemberId: data.linkedin_sub,
      linkedinEmail: data.linkedin_email,
      linkedinGivenName: data.linkedin_given_name,
      linkedinFamilyName: data.linkedin_family_name,
      linkedinPictureUrl: data.linkedin_picture_url,
      accessToken: data.access_token_encrypted ? decryptToken(data.access_token_encrypted) : "",
      refreshToken: data.refresh_token_encrypted ? decryptToken(data.refresh_token_encrypted) : "",
      expiresAt: data.token_expires_at ? new Date(data.token_expires_at) : new Date(0),
      status: data.status as "connected" | "disconnected" | "error",
      lastSyncAt: data.last_synced_at ? new Date(data.last_synced_at) : null,
    };
  } catch (decryptError) {
    console.error("[linkedin-oauth] Failed to decrypt tokens for user:", userId, decryptError);
    return null;
  }
}

/**
 * Disconnects a user's LinkedIn by removing the connection record.
 * LinkedIn OIDC doesn't support token revocation.
 */
export async function disconnectLinkedIn(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  // user_linkedin_connections is not fully covered by generated types in this codepath.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("user_linkedin_connections")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error("[linkedin-oauth] Failed to disconnect:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

async function updateLinkedInConnection(
  supabase: SupabaseClient<Database>,
  userId: string,
  updates: Record<string, unknown>,
  context: string,
): Promise<boolean> {
  // user_linkedin_connections is not fully covered by generated types in this codepath.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("user_linkedin_connections")
    .update(updates)
    .eq("user_id", userId);

  if (error) {
    console.error(`[linkedin-oauth] Failed to ${context}:`, error);
    return false;
  }

  return true;
}

export async function syncLinkedInProfileFields(
  supabase: SupabaseClient<Database>,
  userId: string,
  profile: LinkedInProfile,
): Promise<{ success: true } | { success: false; error: string }> {
  // The profile write spans members/alumni/parents, so keep it in a single RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("sync_user_linkedin_profile_fields", {
    p_user_id: userId,
    p_first_name: profile.givenName || null,
    p_last_name: profile.familyName || null,
    p_photo_url: profile.picture || null,
  });

  if (error) {
    console.error("[linkedin-oauth] Failed to sync LinkedIn profile fields:", error);
    return { success: false, error: "Failed to sync LinkedIn profile to your organization profile" };
  }

  const updatedCount = typeof data?.updated_count === "number" ? data.updated_count : null;
  if (updatedCount === null) {
    console.error("[linkedin-oauth] sync_user_linkedin_profile_fields returned invalid payload:", data);
    return { success: false, error: "Failed to sync LinkedIn profile to your organization profile" };
  }

  if (updatedCount === 0) {
    return { success: false, error: "No profile found to update" };
  }

  return { success: true };
}

export async function recordLinkedInSyncWarning(
  supabase: SupabaseClient<Database>,
  userId: string,
  error: string,
): Promise<boolean> {
  return updateLinkedInConnection(
    supabase,
    userId,
    {
      status: "connected",
      sync_error: error,
    },
    "persist LinkedIn profile sync warning",
  );
}

/**
 * Gets a valid access token, auto-refreshing if expired.
 * On refresh failure marks the connection as error.
 */
export async function getValidLinkedInToken(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const conn = await getLinkedInConnection(supabase, userId);
  if (!conn || conn.status === "disconnected" || !conn.accessToken) return null;

  if (!isTokenExpired(conn.expiresAt)) {
    return conn.accessToken;
  }

  if (!conn.refreshToken) {
    await updateLinkedInConnection(
      supabase,
      userId,
      { status: "error", sync_error: "No refresh token available" },
      "mark connection as error after missing refresh token",
    );
    return null;
  }

  try {
    const refreshed = await refreshLinkedInToken(conn.refreshToken);

    const persisted = await updateLinkedInConnection(
      supabase,
      userId,
      {
        access_token_encrypted: encryptToken(refreshed.accessToken),
        refresh_token_encrypted: encryptToken(refreshed.refreshToken),
        token_expires_at: refreshed.expiresAt.toISOString(),
        status: "connected",
        sync_error: null,
      },
      "persist refreshed LinkedIn tokens",
    );

    if (!persisted) {
      return null;
    }

    return refreshed.accessToken;
  } catch (err) {
    console.error("[linkedin-oauth] Token refresh failed:", err);
    await updateLinkedInConnection(
      supabase,
      userId,
      { status: "error", sync_error: "Token refresh failed. Please reconnect." },
      "mark connection as error after token refresh failure",
    );
    return null;
  }
}

/**
 * Syncs the user's LinkedIn profile by fetching fresh data from the userinfo endpoint.
 */
export async function syncLinkedInProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ success: boolean; profile?: LinkedInProfile; error?: string }> {
  const token = await getValidLinkedInToken(supabase, userId);
  if (!token) {
    return { success: false, error: "Unable to get a valid LinkedIn token. Please reconnect your account." };
  }

  const res = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[linkedin-oauth] Sync userinfo failed:", body.substring(0, 200));
    await updateLinkedInConnection(
      supabase,
      userId,
      { status: "error", sync_error: "Failed to fetch profile from LinkedIn" },
      "mark connection as error after LinkedIn userinfo failure",
    );
    return { success: false, error: "Failed to fetch profile from LinkedIn" };
  }

  const data = await res.json();

  const profile: LinkedInProfile = {
    sub: data.sub,
    givenName: data.given_name || "",
    familyName: data.family_name || "",
    email: data.email || "",
    picture: data.picture || null,
    emailVerified: data.email_verified ?? false,
  };

  const persisted = await updateLinkedInConnection(
    supabase,
    userId,
    {
      linkedin_email: profile.email || null,
      linkedin_name: [profile.givenName, profile.familyName].filter(Boolean).join(" ") || null,
      linkedin_given_name: profile.givenName || null,
      linkedin_family_name: profile.familyName || null,
      linkedin_picture_url: profile.picture || null,
      last_synced_at: new Date().toISOString(),
      status: "connected",
      sync_error: null,
      linkedin_data: { email_verified: profile.emailVerified },
    },
    "persist LinkedIn profile sync",
  );

  if (!persisted) {
    return { success: false, error: "Failed to persist LinkedIn profile sync" };
  }

  const syncedProfileFields = await syncLinkedInProfileFields(supabase, userId, profile);
  if (!syncedProfileFields.success) {
    return syncedProfileFields;
  }

  return { success: true, profile };
}

/**
 * Creates a user-friendly error message from LinkedIn OAuth errors.
 */
export function getLinkedInOAuthErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    access_denied: "You denied access to your LinkedIn account. Please try again and allow access.",
    unauthorized_scope_error: "The requested permissions are not authorized. Please contact support.",
    user_cancelled_login: "You cancelled the LinkedIn login. Please try again.",
    user_cancelled_authorize: "You cancelled the LinkedIn authorization. Please try again.",
    invalid_request: "The authorization request was invalid. Please try again.",
    server_error: "LinkedIn's servers encountered an error. Please try again later.",
    temporarily_unavailable: "LinkedIn's servers are temporarily unavailable. Please try again later.",
  };
  return messages[error] || "An unexpected error occurred. Please try again.";
}
