import { decryptToken, encryptToken, isTokenExpired, refreshAccessToken } from "./oauth";

interface TokenRefreshIntegration {
  id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
}

const RE_READ_ATTEMPTS = 5;
const RE_READ_DELAY_MS = 50;

/**
 * Returns a valid access token for the given integration,
 * refreshing via Blackbaud OAuth if expired.
 *
 * Handles concurrent refresh races:
 * - CAS update on token_expires_at prevents overwrite
 * - Blackbaud invalid_grant (consumed refresh token) treated as lost race
 * - Lost race → re-read winner's token from DB
 */
export async function refreshTokenWithFallback(
  integration: TokenRefreshIntegration,
  supabase: any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<string> {
  const tokenExpiresAt = new Date(integration.token_expires_at);

  if (!isTokenExpired(tokenExpiresAt)) {
    return decryptToken(integration.access_token_enc);
  }

  const refreshToken = decryptToken(integration.refresh_token_enc);

  let newTokens: { access_token: string; refresh_token: string; expires_in: number } | null = null;
  try {
    newTokens = await refreshAccessToken(refreshToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid_grant/i.test(message)) {
      newTokens = null;
    } else {
      throw err;
    }
  }

  if (newTokens) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = (await (supabase as any)
      .from("org_integrations")
      .update({
        access_token_enc: encryptToken(newTokens.access_token),
        refresh_token_enc: encryptToken(newTokens.refresh_token),
        token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration.id)
      .eq("token_expires_at", integration.token_expires_at)
      // Supabase returns number | null; null treated as 0 (CAS miss)
      .select("id", { count: "exact", head: true })) as { count: number | null };

    if ((count ?? 0) > 0) {
      return newTokens.access_token;
    }
  }

  for (let attempt = 0; attempt < RE_READ_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: refreshed, error: reReadError } = (await (supabase as any)
      .from("org_integrations")
      .select("access_token_enc, token_expires_at")
      .eq("id", integration.id)
      .single()) as {
      data: { access_token_enc: string; token_expires_at?: string } | null;
      error: { message: string } | null;
    };

    if (reReadError || !refreshed) {
      throw new Error(
        `Token refresh failed: could not re-read token for integration ${integration.id}` +
          (reReadError ? `: ${reReadError.message}` : "")
      );
    }

    if (
      !refreshed.token_expires_at ||
      refreshed.token_expires_at !== integration.token_expires_at
    ) {
      return decryptToken(refreshed.access_token_enc);
    }

    if (attempt < RE_READ_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, RE_READ_DELAY_MS));
    }
  }

  throw new Error(
    `Token refresh failed: refreshed token not yet visible for integration ${integration.id}`
  );
}
