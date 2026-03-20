import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgRole } from "@/lib/auth/roles";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ organizationId: string }> }
) {
  const { organizationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "blackbaud-sync",
    limitPerIp: 5,
    limitPerUser: 3,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: rateLimit.headers }
    );
  }

  // Verify org admin explicitly (uses orgId, not orgSlug)
  try {
    await requireOrgRole({ orgId: organizationId, allowedRoles: ["admin"] });
  } catch {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403, headers: rateLimit.headers }
    );
  }

  const serviceSupabase = createServiceClient();
  const { data: integration } = (await (serviceSupabase as any)
    .from("org_integrations")
    .select(
      "id, status, access_token_enc, refresh_token_enc, token_expires_at, last_synced_at"
    )
    .eq("organization_id", organizationId)
    .eq("provider", "blackbaud")
    .eq("status", "active")
    .maybeSingle()) as { data: any | null };

  if (!integration) {
    return NextResponse.json(
      { error: "No active Blackbaud connection for this organization" },
      { status: 404, headers: rateLimit.headers }
    );
  }

  // Get valid access token (refresh if needed)
  let accessToken: string;
  try {
    const tokenExpiresAt = new Date(integration.token_expires_at);
    if (isTokenExpired(tokenExpiresAt)) {
      const refreshToken = decryptToken(integration.refresh_token_enc);
      const newTokens = await refreshAccessToken(refreshToken);

      // Optimistic concurrency: only update if token_expires_at hasn't changed
      const { count } = (await (serviceSupabase as any)
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
        .eq("token_expires_at", integration.token_expires_at)
        .select("id", { count: "exact", head: true })) as { count: number };

      if (count === 0) {
        // Another process refreshed — re-read
        const { data: refreshed } = (await (serviceSupabase as any)
          .from("org_integrations")
          .select("access_token_enc")
          .eq("id", integration.id)
          .single()) as { data: { access_token_enc: string } };
        accessToken = decryptToken(refreshed.access_token_enc);
      } else {
        accessToken = newTokens.access_token;
      }
    } else {
      accessToken = decryptToken(integration.access_token_enc);
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to refresh Blackbaud access token" },
      { status: 502, headers: rateLimit.headers }
    );
  }

  const capacity = await getAlumniCapacitySnapshot(
    organizationId,
    serviceSupabase
  );

  const client = createBlackbaudClient({
    accessToken,
    subscriptionKey: getBlackbaudSubscriptionKey(),
  });

  const result = await runSync({
    client,
    supabase: serviceSupabase,
    integrationId: integration.id,
    organizationId,
    alumniLimit: capacity.alumniLimit,
    currentAlumniCount: capacity.currentAlumniCount,
    syncType: "manual",
    lastSyncedAt: integration.last_synced_at,
  });

  return NextResponse.json(
    { result },
    { status: result.ok ? 200 : 500, headers: rateLimit.headers }
  );
}
