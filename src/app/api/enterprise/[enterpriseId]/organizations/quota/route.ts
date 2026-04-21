import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { canEnterpriseAddSubOrg } from "@/lib/enterprise/quota";
import { getFreeSubOrgCount } from "@/lib/enterprise/pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise org quota",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  const seatQuota = await canEnterpriseAddSubOrg(ctx.enterpriseId);
  if (seatQuota.error) {
    return respond({ error: "Unable to fetch quota info" }, 503);
  }

  // Fetch bucket quantity for free org calculation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription } = await (ctx.serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("alumni_bucket_quantity")
    .eq("enterprise_id", ctx.enterpriseId)
    .single() as { data: { alumni_bucket_quantity: number } | null };

  const bucketQuantity = subscription?.alumni_bucket_quantity ?? 1;
  const freeOrgs = getFreeSubOrgCount(bucketQuantity);
  const currentCount = seatQuota.currentCount;
  const maxAllowed = seatQuota.maxAllowed;
  const remaining = maxAllowed != null ? Math.max(maxAllowed - currentCount, 0) : null;
  const paidOrgs = Math.max(currentCount - freeOrgs, 0);

  return respond({
    currentCount,
    maxAllowed,
    remaining,
    freeOrgs,
    paidOrgs,
    bucketQuantity,
  });
}
