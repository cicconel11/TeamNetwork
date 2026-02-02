import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import {
  requireEnterpriseRole,
  requireEnterpriseOwner,
} from "@/lib/auth/enterprise-roles";
import type { AdoptionRequestStatus } from "@/types/enterprise";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string; requestId: string }>;
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
    description: string | null;
    primary_color: string | null;
  };
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId, requestId } = await params;

  const requestIdParsed = baseSchemas.uuid.safeParse(requestId);

  if (!requestIdParsed.success) {
    return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "adoption request details",
    limitPerIp: 60,
    limitPerUser: 40,
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
    // Check enterprise membership (any role can view)
    await requireEnterpriseRole(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request, error } = await (serviceSupabase as any)
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
      organization:organizations(id, name, slug, description, primary_color)
    `)
    .eq("id", requestId)
    .eq("enterprise_id", resolvedEnterpriseId)
    .single() as { data: AdoptionRequestRow | null; error: Error | null };

  if (error || !request) {
    return respond({ error: "Request not found" }, 404);
  }

  return respond({ request });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { enterpriseId, requestId } = await params;

  const requestIdParsed = baseSchemas.uuid.safeParse(requestId);

  if (!requestIdParsed.success) {
    return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "cancel adoption request",
    limitPerIp: 20,
    limitPerUser: 10,
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
    // Only owner can cancel/withdraw adoption requests
    await requireEnterpriseOwner(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // Check request exists and is pending
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request } = await (serviceSupabase as any)
    .from("enterprise_adoption_requests")
    .select("status")
    .eq("id", requestId)
    .eq("enterprise_id", resolvedEnterpriseId)
    .single() as { data: { status: AdoptionRequestStatus } | null };

  if (!request) {
    return respond({ error: "Request not found" }, 404);
  }

  if (request.status !== "pending") {
    return respond({ error: "Only pending requests can be withdrawn" }, 400);
  }

  // Delete the request
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deleteError } = await (serviceSupabase as any)
    .from("enterprise_adoption_requests")
    .delete()
    .eq("id", requestId) as { error: Error | null };

  if (deleteError) {
    return respond({ error: deleteError.message }, 400);
  }

  return respond({ success: true });
}
