import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgRole } from "@/lib/auth/roles";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getBlackbaudSubscriptionKey } from "@/lib/blackbaud/oauth";
import { refreshTokenWithFallback } from "@/lib/blackbaud/token-refresh";
import { createBlackbaudClient } from "@/lib/blackbaud/client";
import { runSync } from "@/lib/blackbaud/sync";
import { getAlumniCapacitySnapshot } from "@/lib/alumni/capacity";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrgIntegrationRow = Database["public"]["Tables"]["org_integrations"]["Row"];
type BlackbaudIntegration = Pick<
  OrgIntegrationRow,
  "id" | "access_token_enc" | "refresh_token_enc" | "token_expires_at" | "last_synced_at"
>;
type BlackbaudIntegrationWithTokens = BlackbaudIntegration & {
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
};

const QUOTA_PATTERN = /quota exhausted/i;

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

  try {
    await requireOrgRole({ orgId: organizationId, allowedRoles: ["admin"] });
  } catch {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403, headers: rateLimit.headers }
    );
  }

  const serviceSupabase = createServiceClient();
  const { data: integration } = await serviceSupabase
    .from("org_integrations")
    .select(
      "id, status, access_token_enc, refresh_token_enc, token_expires_at, last_synced_at"
    )
    .eq("organization_id", organizationId)
    .eq("provider", "blackbaud")
    .eq("status", "active")
    .maybeSingle();

  if (!integration) {
    return NextResponse.json(
      { error: "No active Blackbaud connection for this organization" },
      { status: 404, headers: rateLimit.headers }
    );
  }

  const activeIntegration = integration as BlackbaudIntegration;
  if (
    !activeIntegration.access_token_enc ||
    !activeIntegration.refresh_token_enc ||
    !activeIntegration.token_expires_at
  ) {
    return NextResponse.json(
      { error: "Blackbaud connection is missing token data" },
      { status: 502, headers: rateLimit.headers }
    );
  }
  const hydratedIntegration: BlackbaudIntegrationWithTokens = {
    ...activeIntegration,
    access_token_enc: activeIntegration.access_token_enc,
    refresh_token_enc: activeIntegration.refresh_token_enc,
    token_expires_at: activeIntegration.token_expires_at,
  };

  let accessToken: string;
  try {
    accessToken = await refreshTokenWithFallback(hydratedIntegration, serviceSupabase);
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
    integrationId: activeIntegration.id,
    organizationId,
    alumniLimit: capacity.alumniLimit,
    currentAlumniCount: capacity.currentAlumniCount,
    syncType: "manual",
    lastSyncedAt: activeIntegration.last_synced_at,
  });

  if (!result.ok) {
    const isQuota = QUOTA_PATTERN.test(result.error ?? "");
    return NextResponse.json(
      { result },
      { status: isQuota ? 429 : 500, headers: rateLimit.headers }
    );
  }

  return NextResponse.json(
    { result },
    { status: 200, headers: rateLimit.headers }
  );
}
