import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAiOrgContext } from "@/lib/ai/context";
import { buildRateLimitResponse, checkRateLimit } from "@/lib/security/rate-limit";
import { getOrgSpendStatus } from "@/lib/ai/spend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(request, {
    orgId,
    userId: user?.id ?? null,
    feature: "ai-spend",
    limitPerIp: 30,
    limitPerUser: 30,
    limitPerOrg: 60,
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getAiOrgContext(
    orgId,
    user,
    rateLimit,
    { supabase },
    { allowedRoles: ["admin"] },
  );
  if (!ctx.ok) return ctx.response;

  const status = await getOrgSpendStatus(orgId);
  const percentUsed = status.capCents > 0
    ? Math.min(100, (status.spendCents / status.capCents) * 100)
    : 100;
  // periodStart = first of same month as periodEnd (UTC), as YYYY-MM-DD.
  const end = new Date(status.periodEnd);
  const periodStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  return NextResponse.json(
    {
      currentCents: status.spendCents,
      capCents: status.capCents,
      percentUsed,
      periodStart,
      periodEnd: status.periodEnd,
    },
    { headers: rateLimit.headers },
  );
}
