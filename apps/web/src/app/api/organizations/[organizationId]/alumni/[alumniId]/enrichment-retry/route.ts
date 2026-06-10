import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; alumniId: string }>;
}

// POST /api/organizations/:organizationId/alumni/:alumniId/enrichment-retry
//
// Re-queues LinkedIn enrichment for a failed (or stuck) alumni row by
// resetting the enrichment columns to the same "pending" state the
// linkedin-url attach route uses — the enrichment-process cron picks it up.
//
// Allowed callers: active org admins OR the linked self (alumni.user_id ===
// caller). Responses never echo the stored enrichment error (raw scraper
// output stays server-side).
export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId, alumniId } = await params;
  if (
    !baseSchemas.uuid.safeParse(organizationId).success ||
    !baseSchemas.uuid.safeParse(alumniId).success
  ) {
    return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "alumni enrichment retry",
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

  let membership;
  try {
    membership = await getOrgMembership(serviceSupabase, user.id, organizationId);
  } catch (error) {
    console.error("[alumni/enrichment-retry POST] Failed to verify membership:", error);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  if (!membership) {
    return respond({ error: "Forbidden" }, 403);
  }

  const { data: alumni, error: alumniError } = await serviceSupabase
    .from("alumni")
    .select("id, user_id, linkedin_url")
    .eq("id", alumniId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (alumniError) {
    console.error("[alumni/enrichment-retry POST] Failed to load alumni:", alumniError);
    return respond({ error: "Failed to load alumni" }, 500);
  }

  if (!alumni?.id) {
    return respond({ error: "Alumni not found" }, 404);
  }

  const isAdmin = membership.role === "admin";
  const isSelf = Boolean(alumni.user_id && alumni.user_id === user.id);
  if (!isAdmin && !isSelf) {
    return respond({ error: "Forbidden" }, 403);
  }

  if (!alumni.linkedin_url) {
    return respond({ error: "No LinkedIn URL on file" }, 409);
  }

  // Same reset triple as the linkedin-url attach route: the
  // enrichment-process cron starts the Apify run for pending rows.
  const { error: updateError } = await serviceSupabase
    .from("alumni")
    .update({
      enrichment_status: "pending",
      enrichment_retry_count: 0,
      enrichment_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", alumniId)
    .eq("organization_id", organizationId);

  if (updateError) {
    console.error("[alumni/enrichment-retry POST] Failed to queue retry:", updateError);
    return respond({ error: "Failed to queue enrichment retry" }, 500);
  }

  return respond({ ok: true, status: "pending" });
}
