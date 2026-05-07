import { supabase } from "@/lib/supabase";

const WEB_API_URL = (
  process.env.EXPO_PUBLIC_WEB_URL?.trim() || "https://www.myteamnetwork.com"
).replace(/\/+$/, "");

export function getWebAppUrl() {
  return WEB_API_URL;
}

export function getWebRoute(path?: string): string {
  const normalizedPath = path?.trim().replace(/^\/+|\/+$/g, "");
  return normalizedPath ? `${WEB_API_URL}/${normalizedPath}` : WEB_API_URL;
}

export function getWebPath(orgSlug: string, path?: string): string {
  const normalizedOrgSlug = orgSlug.trim().replace(/^\/+|\/+$/g, "");
  const normalizedPath = path?.trim().replace(/^\/+|\/+$/g, "");

  if (!normalizedOrgSlug) {
    return WEB_API_URL;
  }

  return normalizedPath
    ? `${WEB_API_URL}/${normalizedOrgSlug}/${normalizedPath}`
    : `${WEB_API_URL}/${normalizedOrgSlug}`;
}

export class NetworkUnreachableError extends Error {
  constructor(message = "Network request failed") {
    super(message);
    this.name = "NetworkUnreachableError";
  }
}

export function buildAuthorizedHeaders(
  headers: HeadersInit | undefined,
  accessToken: string
): Headers {
  const authorizedHeaders = new Headers(headers);
  authorizedHeaders.set("Authorization", `Bearer ${accessToken}`);
  return authorizedHeaders;
}

export async function fetchWithAuth(path: string, options: RequestInit = {}) {
  let { data: sessionData } = await supabase.auth.getSession();

  // If the access token is expired or expiring within 30 s, refresh it.
  if (sessionData.session) {
    const expiresAt = sessionData.session.expires_at ?? 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiresAt - nowSeconds;

    if (timeUntilExpiry < 30) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        throw new Error(`Session refresh failed: ${refreshError.message}`);
      }
      if (refreshed.session) {
        sessionData = refreshed;
      } else {
        throw new Error("Session refresh returned no session");
      }
    }
  }

  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error("Not authenticated");
  }

  const url = `${WEB_API_URL}${path}`;

  const send = async (token: string) => {
    const headers = buildAuthorizedHeaders(options.headers, token);
    return fetch(url, {
      ...options,
      headers,
    });
  };

  try {
    let response = await send(accessToken);

    // Access token can be rejected as stale (401) even when expires_at looked OK
    // (clock skew, refresh races, or server-side revocation). Refresh once and retry.
    if (response.status === 401) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshed.session?.access_token) {
        response = await send(refreshed.session.access_token);
      }
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    if (/network request failed|failed to fetch/i.test(message)) {
      throw new NetworkUnreachableError(message);
    }
    throw error;
  }
}
