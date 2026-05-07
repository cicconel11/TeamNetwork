import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { getBlackbaudSubscriptionKey } from "@/lib/blackbaud/oauth";
import { refreshTokenWithFallback } from "@/lib/blackbaud/token-refresh";
import { createBlackbaudClient } from "@/lib/blackbaud/client";
import { runSync } from "@/lib/blackbaud/sync";
import { getAlumniCapacitySnapshot } from "@/lib/alumni/capacity";
import { debugLog } from "@/lib/debug";

export const dynamic = "force-dynamic";

const MAX_CONCURRENCY = 3;

interface DueIntegrationRow {
  id: string;
  organization_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
  last_synced_at: string | null;
}

export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const supabase = createServiceClient();

  // Find all active Blackbaud integrations due for sync (not synced in last 24h)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integrations, error } = (await (supabase as any)
    .from("org_integrations")
    .select(
      "id, organization_id, access_token_enc, refresh_token_enc, token_expires_at, last_synced_at"
    )
    .eq("provider", "blackbaud")
    .eq("status", "active")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)) as {
    data: DueIntegrationRow[] | null;
    error: { message?: string } | null;
  };

  if (error) {
    debugLog("integrations-cron", "failed to load integrations", { error });
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
      batch.map(async (integration: DueIntegrationRow) => {
        try {
          const accessToken = await refreshTokenWithFallback(integration, supabase);

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
