import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { rejectAdoptionRequest } from "@/lib/enterprise/adoption";
import type { AdoptionRequestStatus } from "@/types/enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; requestId: string }>;
}

// Type for adoption request (until types are regenerated)
interface AdoptionRequestRow {
  id: string;
  organization_id: string;
  status: AdoptionRequestStatus;
}

export async function POST(req: Request, { params }: RouteParams) {
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
    feature: "reject adoption request",
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

  // Verify request belongs to this organization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: request } = await (serviceSupabase as any)
    .from("enterprise_adoption_requests")
    .select("id, organization_id, status")
    .eq("id", requestId)
    .single() as { data: AdoptionRequestRow | null };

  if (!request) {
    return respond({ error: "Request not found" }, 404);
  }

  if (request.organization_id !== organizationId) {
    return respond({ error: "Request does not belong to this organization" }, 403);
  }

  if (request.status !== "pending") {
    return respond({ error: "Request has already been processed" }, 400);
  }

  // Reject the adoption request
  const result = await rejectAdoptionRequest(requestId, user.id);

  if (!result.success) {
    return respond({ error: result.error }, 400);
  }

  return respond({ success: true });
}
