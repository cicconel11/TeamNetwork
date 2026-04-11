import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  getEnterpriseApiContext,
  ENTERPRISE_ANY_ROLE,
} from "@/lib/auth/enterprise-api-context";
import type { AdoptionRequestStatus } from "@/types/enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for adoption request row (until types are regenerated)
interface AdoptionRequestRow {
  id: string;
  enterprise_id: string;
  organization_id: string;
  requested_by: string;
  requested_at: string;
  status: AdoptionRequestStatus;
  responded_by: string | null;
  responded_at: string | null;
  expires_at: string | null;
  organization?: {
    id: string;
    name: string;
    slug: string;
  };
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "adoption requests",
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_ANY_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Get adoption requests with organization details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: requests, error } = await (ctx.serviceSupabase as any)
    .from("enterprise_adoption_requests")
    .select(`
      id,
      enterprise_id,
      organization_id,
      requested_by,
      requested_at,
      status,
      responded_by,
      responded_at,
      expires_at,
      organization:organizations(id, name, slug)
    `)
    .eq("enterprise_id", ctx.enterpriseId)
    .order("requested_at", { ascending: false }) as { data: AdoptionRequestRow[] | null; error: Error | null };

  if (error) {
    console.error("[enterprise/adoption-requests GET] DB error:", error);
    return respond({ error: "Internal server error" }, 500);
  }

  return respond({ requests: requests ?? [] });
}
