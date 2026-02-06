import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise navigation sync",
    limitPerIp: 10,
    limitPerUser: 5,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const serviceSupabase = createServiceClient();
  const { data: resolved, error: resolveError } = await resolveEnterpriseParam(enterpriseId, serviceSupabase);
  if (resolveError) {
    return respond({ error: resolveError.message }, resolveError.status);
  }

  const resolvedEnterpriseId = resolved?.enterpriseId ?? enterpriseId;

  try {
    await requireEnterpriseRole(resolvedEnterpriseId, ["owner", "org_admin"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // Get all organizations for this enterprise
  const { data: orgs, error: orgsError } = await serviceSupabase
    .from("organizations")
    .select("id")
    .eq("enterprise_id", resolvedEnterpriseId);

  if (orgsError || !orgs) {
    return respond({ error: "Failed to fetch organizations" }, 400);
  }

  if (orgs.length === 0) {
    return respond({ success: true, synced: 0, message: "No organizations to sync" });
  }

  // Use the RPC function to sync each organization
  let synced = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      const { data, error: syncError } = await supabase.rpc("sync_enterprise_nav_to_org", {
        p_enterprise_id: resolvedEnterpriseId,
        p_organization_id: org.id,
      });

      if (syncError) {
        console.error(`Failed to sync org ${org.id}:`, syncError);
        failed++;
      } else if (data) {
        synced++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`Error syncing org ${org.id}:`, err);
      failed++;
    }
  }

  return respond({
    success: true,
    synced,
    failed,
    total: orgs.length,
    message: `Synced ${synced} of ${orgs.length} organizations`,
  });
}
