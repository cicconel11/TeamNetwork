import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; requestId: string }>;
}

// Type for adoption request (until types are regenerated)
interface AdoptionRequestRow {
  id: string;
  enterprise_id: string;
  organization_id: string;
  requested_by: string;
  requested_at: string;
  status: string;
  expires_at: string | null;
}

interface EnterpriseRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * GET /api/organizations/[organizationId]/adoption-requests/[requestId]
 *
 * Returns the adoption request details for org admins to review.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId, requestId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  const requestIdParsed = baseSchemas.uuid.safeParse(requestId);

  if (!orgIdParsed.success || !requestIdParsed.success) {
    return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "get adoption request",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) {
    return respond({ error: "Unauthorized" }, 401);
  }

  // Check user is admin of the organization
  const { data: role } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (role?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  const serviceSupabase = createServiceClient();

  // Get the adoption request
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request, error: requestError } = await (serviceSupabase as any)
    .from("enterprise_adoption_requests")
    .select("*")
    .eq("id", requestId)
    .single() as { data: AdoptionRequestRow | null; error: unknown };

  if (requestError || !request) {
    return respond({ error: "Request not found" }, 404);
  }

  if (request.organization_id !== organizationId) {
    return respond({ error: "Request does not belong to this organization" }, 403);
  }

  // Get enterprise details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enterprise } = await (serviceSupabase as any)
    .from("enterprises")
    .select("id, name, slug, description, logo_url")
    .eq("id", request.enterprise_id)
    .single() as { data: EnterpriseRow | null };

  // Get requester details
  const { data: requester } = await serviceSupabase
    .from("users")
    .select("id, name, email")
    .eq("id", request.requested_by)
    .single() as { data: UserRow | null };

  return respond({
    id: request.id,
    status: request.status,
    requested_at: request.requested_at,
    expires_at: request.expires_at,
    enterprise: enterprise || null,
    requester: requester
      ? { name: requester.name, email: requester.email }
      : { name: null, email: null },
  });
}
