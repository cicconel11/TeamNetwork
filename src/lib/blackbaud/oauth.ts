import {
  encryptToken as sharedEncrypt,
  decryptToken as sharedDecrypt,
} from "@/lib/crypto/token-encryption";
import { getAppUrl } from "@/lib/url";
import type { BlackbaudTokenResponse, SyncError } from "./types";

// ── Environment helpers ──────────────────────────────────────

/** Returns true when all required Blackbaud env vars are set. */
export function isBlackbaudConfigured(): boolean {
  return !!(
    process.env.BLACKBAUD_CLIENT_ID?.trim() &&
    process.env.BLACKBAUD_CLIENT_SECRET?.trim() &&
    process.env.BLACKBAUD_TOKEN_ENCRYPTION_KEY?.trim() &&
    process.env.BLACKBAUD_SUBSCRIPTION_KEY?.trim()
  );
}

function cleanEnvValue(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/\\n/g, "").trim();
}

function getBlackbaudClientId(): string {
  const val = cleanEnvValue(process.env.BLACKBAUD_CLIENT_ID);
  if (!val) {
    throw new Error("Missing required environment variable: BLACKBAUD_CLIENT_ID");
  }
  return val;
}

function getBlackbaudClientSecret(): string {
  const val = cleanEnvValue(process.env.BLACKBAUD_CLIENT_SECRET);
  if (!val) {
    throw new Error("Missing required environment variable: BLACKBAUD_CLIENT_SECRET");
  }
  return val;
}

function getBlackbaudEncryptionKey(): string {
  const val = cleanEnvValue(process.env.BLACKBAUD_TOKEN_ENCRYPTION_KEY);
  if (!val) {
    throw new Error("Missing required environment variable: BLACKBAUD_TOKEN_ENCRYPTION_KEY");
  }
  return val;
}

export function getBlackbaudSubscriptionKey(): string {
  const val = cleanEnvValue(process.env.BLACKBAUD_SUBSCRIPTION_KEY);
  if (!val) {
    throw new Error("Missing required environment variable: BLACKBAUD_SUBSCRIPTION_KEY");
  }
  return val;
}

function getRedirectUri(): string {
  return `${getAppUrl()}/api/blackbaud/callback`;
}

// ── Token encryption (delegates to shared crypto module) ─────

export function encryptToken(token: string): string {
  return sharedEncrypt(token, getBlackbaudEncryptionKey());
}

export function decryptToken(encryptedToken: string): string {
  return sharedDecrypt(encryptedToken, getBlackbaudEncryptionKey());
}

// ── OAuth flow ───────────────────────────────────────────────

const BLACKBAUD_AUTH_URL = "https://app.blackbaud.com/oauth/authorize";
const BLACKBAUD_TOKEN_URL = "https://oauth2.sky.blackbaud.com/token";

function getBasicAuthHeader(): string {
  const clientId = getBlackbaudClientId();
  const clientSecret = getBlackbaudClientSecret();
  const rawId = process.env.BLACKBAUD_CLIENT_ID ?? "";
  const rawSecret = process.env.BLACKBAUD_CLIENT_SECRET ?? "";
  // #region agent log
  console.error("[blackbaud-debug] credentials check", {
    clientIdLen: clientId.length,
    clientSecretLen: clientSecret.length,
    rawIdLen: rawId.length,
    rawSecretLen: rawSecret.length,
    idWasTrimmed: rawId.length !== clientId.length,
    secretWasTrimmed: rawSecret.length !== clientSecret.length,
    clientIdPrefix: clientId.substring(0, 8),
    secretPrefix: clientSecret.substring(0, 4) + "...",
  });
  // #endregion
  const credentials = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

/**
 * Generates the Blackbaud OAuth authorization URL.
 * @param state - The UUID of the pending oauth_state row (server-stored state)
 */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getBlackbaudClientId(),
    response_type: "code",
    redirect_uri: getRedirectUri(),
    state,
  });

  return `${BLACKBAUD_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges an authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<BlackbaudTokenResponse> {
  const redirectUri = getRedirectUri();
  // #region agent log
  console.error("[blackbaud-debug] exchangeCodeForTokens called", { redirectUri, codeLen: code.length, tokenUrl: BLACKBAUD_TOKEN_URL });
  // #endregion
  const response = await fetch(BLACKBAUD_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: getBasicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    // #region agent log
    console.error("[blackbaud-debug] token exchange FAILED", { status: response.status, statusText: response.statusText, body: text, redirectUri });
    // #endregion
    throw new Error(`Blackbaud token exchange failed (${response.status}): ${text}`);
  }

  // #region agent log
  console.error("[blackbaud-debug] token exchange SUCCEEDED");
  // #endregion
  return response.json() as Promise<BlackbaudTokenResponse>;
}

/**
 * Refreshes an expired access token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<BlackbaudTokenResponse> {
  const response = await fetch(BLACKBAUD_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: getBasicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Blackbaud token refresh failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<BlackbaudTokenResponse>;
}

/**
 * Checks if an access token is expired or about to expire.
 */
export function isTokenExpired(expiresAt: Date, bufferSeconds: number = 300): boolean {
  const bufferMs = bufferSeconds * 1000;
  return Date.now() >= expiresAt.getTime() - bufferMs;
}

/**
 * Creates a structured sync error for storage in org_integrations.last_sync_error
 */
export function makeSyncError(
  phase: SyncError["phase"],
  code: string,
  message: string
): SyncError {
  return { phase, code, message, at: new Date().toISOString() };
}
