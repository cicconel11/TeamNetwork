import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import {
  decryptToken,
  isTokenExpired,
  refreshAccessToken,
  encryptToken,
  getBlackbaudSubscriptionKey,
} from "@/lib/blackbaud/oauth";
import { createBlackbaudClient } from "@/lib/blackbaud/client";
import { runSync } from "@/lib/blackbaud/sync";
import { getAlumniCapacitySnapshot } from "@/lib/alumni/capacity";
import { debugLog } from "@/lib/debug";

export const dynamic = "force-dynamic";

const MAX_CONCURRENCY = 3;

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const supabase = createServiceClient();

  // Find all active Blackbaud integrations due for sync (not synced in last 24h)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: integrations, error } = (await (supabase as any)
    .from("org_integrations")
    .select(
      "id, organization_id, access_token_enc, refresh_token_enc, token_expires_at, last_synced_at"
    )
    .eq("provider", "blackbaud")
    .eq("status", "active")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)) as {
    data: any[] | null;
    error: any;
  };

  if (error) {
    console.error("[integrations-cron] Failed to load integrations:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  const typedIntegrations = integrations ?? [];
  const results: {
    id: string;
    orgId: string;
    status: string;
    created?: number;
    updated?: number;
    error?: string;
  }[] = [];

  for (let i = 0; i < typedIntegrations.length; i += MAX_CONCURRENCY) {
    const batch = typedIntegrations.slice(i, i + MAX_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (integration: any) => {
        try {
          let accessToken: string;
          const tokenExpiresAt = new Date(integration.token_expires_at);

          if (isTokenExpired(tokenExpiresAt)) {
            const refreshToken = decryptToken(integration.refresh_token_enc);
            const newTokens = await refreshAccessToken(refreshToken);

            await (supabase as any)
              .from("org_integrations")
              .update({
                access_token_enc: encryptToken(newTokens.access_token),
                refresh_token_enc: encryptToken(newTokens.refresh_token),
                token_expires_at: new Date(
                  Date.now() + newTokens.expires_in * 1000
                ).toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", integration.id)
              .eq("token_expires_at", integration.token_expires_at);

            accessToken = newTokens.access_token;
          } else {
            accessToken = decryptToken(integration.access_token_enc);
          }

          const capacity = await getAlumniCapacitySnapshot(
            integration.organization_id,
            supabase
          );
          const client = createBlackbaudClient({
            accessToken,
            subscriptionKey: getBlackbaudSubscriptionKey(),
          });

          const result = await runSync({
            client,
            supabase,
            integrationId: integration.id,
            organizationId: integration.organization_id,
            alumniLimit: capacity.alumniLimit,
            currentAlumniCount: capacity.currentAlumniCount,
            syncType: "incremental",
            lastSyncedAt: integration.last_synced_at,
          });

          return {
            id: integration.id,
            orgId: integration.organization_id,
            status: result.ok ? "ok" : "error",
            created: result.created,
            updated: result.updated,
            error: result.error,
          };
        } catch (err) {
          debugLog("integrations-cron", "sync error", {
            integrationId: integration.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            id: integration.id,
            orgId: integration.organization_id,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    results.push(...batchResults);
  }

  return NextResponse.json({
    processed: typedIntegrations.length,
    results,
  });
}
