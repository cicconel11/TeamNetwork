import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { exchangeCodeForTokens, encryptToken, makeSyncError, getBlackbaudSubscriptionKey } from "@/lib/blackbaud/oauth";
import { createBlackbaudClient } from "@/lib/blackbaud/client";
import { getAppUrl } from "@/lib/url";
import { debugLog } from "@/lib/debug";
import type { BlackbaudConstituent } from "@/lib/blackbaud/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_EXPIRY_MS = 15 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const appUrl = getAppUrl();

  if (error) {
    return NextResponse.redirect(`${appUrl}/app?error=blackbaud_oauth_denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/app?error=blackbaud_invalid_callback`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/auth/login?error=session_expired`);
  }

  const serviceSupabase = createServiceClient();
  const { data: oauthState, error: lookupError } = await (serviceSupabase as any)
    .from("org_integration_oauth_state")
    .select("id, organization_id, provider, user_id, redirect_path, initiated_at, used")
    .eq("id", state)
    .eq("provider", "blackbaud")
    .maybeSingle() as { data: any | null; error: any };

  if (lookupError || !oauthState) {
    return NextResponse.redirect(`${appUrl}/app?error=blackbaud_invalid_state`);
  }

  if (oauthState.used) {
    return NextResponse.redirect(`${appUrl}/app?error=blackbaud_state_reused`);
  }

  if (oauthState.user_id !== user.id) {
    return NextResponse.redirect(`${appUrl}/app?error=blackbaud_user_mismatch`);
  }

  const initiatedAt = new Date(oauthState.initiated_at);
  if (Date.now() - initiatedAt.getTime() > STATE_EXPIRY_MS) {
    return NextResponse.redirect(`${appUrl}/app?error=blackbaud_state_expired`);
  }

  // Re-check admin access BEFORE consuming state (so transient errors are retryable)
  const { data: adminRole, error: roleError } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("organization_id", oauthState.organization_id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .eq("status", "active")
    .maybeSingle();

  if (!adminRole && roleError) {
    // Transient DB error — don't consume state, let user retry
    debugLog("blackbaud-callback", "admin check transient error", { error: roleError.message });
    return NextResponse.redirect(`${appUrl}/app?error=blackbaud_admin_check_failed`);
  }

  if (!adminRole) {
    // Definitive: user no longer admin — consume state to prevent replay, then reject
    await (serviceSupabase as any)
      .from("org_integration_oauth_state")
      .update({ used: true })
      .eq("id", oauthState.id);
    return NextResponse.redirect(`${appUrl}/app?error=blackbaud_access_revoked`);
  }

  // Mark state as used (prevent replay)
  await (serviceSupabase as any)
    .from("org_integration_oauth_state")
    .update({ used: true })
    .eq("id", oauthState.id);

  try {
    const tokens = await exchangeCodeForTokens(code);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Post-callback verification: test API call
    const client = createBlackbaudClient({
      accessToken: tokens.access_token,
      subscriptionKey: getBlackbaudSubscriptionKey(),
    });

    try {
      await client.getList<BlackbaudConstituent>("/constituent/v1/constituents", { limit: "1" });
    } catch (verifyError) {
      const syncError = makeSyncError(
        "api_verify",
        "VERIFY_FAILED",
        verifyError instanceof Error ? verifyError.message : "API verification failed"
      );

      await (serviceSupabase as any)
        .from("org_integrations")
        .upsert({
          organization_id: oauthState.organization_id,
          provider: "blackbaud",
          status: "error",
          access_token_enc: encryptToken(tokens.access_token),
          refresh_token_enc: encryptToken(tokens.refresh_token),
          token_expires_at: tokenExpiresAt.toISOString(),
          connected_by: user.id,
          last_sync_error: syncError,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id,provider" });

      const redirectPath = oauthState.redirect_path || "/app";
      return NextResponse.redirect(`${appUrl}${redirectPath}?error=blackbaud_verify_failed`);
    }

    // Success: upsert integration row as active
    await (serviceSupabase as any)
      .from("org_integrations")
      .upsert({
        organization_id: oauthState.organization_id,
        provider: "blackbaud",
        status: "active",
        access_token_enc: encryptToken(tokens.access_token),
        refresh_token_enc: encryptToken(tokens.refresh_token),
        token_expires_at: tokenExpiresAt.toISOString(),
        connected_by: user.id,
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,provider" });

    const redirectPath = oauthState.redirect_path || "/app";
    return NextResponse.redirect(`${appUrl}${redirectPath}?success=blackbaud_connected`);
  } catch (err) {
    debugLog("blackbaud-callback", "token exchange failed", { error: err instanceof Error ? err.message : String(err) });

    const syncError = makeSyncError(
      "code_exchange",
      "EXCHANGE_FAILED",
      err instanceof Error ? err.message : "Token exchange failed"
    );

    await (serviceSupabase as any)
      .from("org_integrations")
      .update({
        last_sync_error: syncError,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", oauthState.organization_id)
      .eq("provider", "blackbaud");

    const redirectPath = oauthState.redirect_path || "/app";
    return NextResponse.redirect(`${appUrl}${redirectPath}?error=blackbaud_exchange_failed`);
  }
}
