import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";

const linkUserSchema = z.object({
  user_id: baseSchemas.uuid,
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; alumniId: string }>;
}

// POST /api/organizations/:organizationId/alumni/:alumniId/link-user
//
// Admin-only: link an unlinked alumni row to an active org member. The
// member-initiated counterpart is the claim_alumni_profiles RPC (email
// match); this endpoint covers admin-initiated linking when emails differ.
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
    feature: "alumni link user",
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

  let body: z.infer<typeof linkUserSchema>;
  try {
    body = await validateJson(req, linkUserSchema, { maxBodyBytes: 10_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const serviceSupabase = createServiceClient();

  let membership;
  try {
    membership = await getOrgMembership(serviceSupabase, user.id, organizationId);
  } catch (error) {
    console.error("[alumni/link-user POST] Failed to verify membership:", error);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  if (membership?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  const { data: alumni, error: alumniError } = await serviceSupabase
    .from("alumni")
    .select("id, user_id")
    .eq("id", alumniId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (alumniError) {
    console.error("[alumni/link-user POST] Failed to load alumni:", alumniError);
    return respond({ error: "Failed to load alumni" }, 500);
  }

  if (!alumni?.id) {
    return respond({ error: "Alumni not found" }, 404);
  }

  if (alumni.user_id) {
    return respond({ error: "Profile already linked" }, 409);
  }

  const [{ data: targetMembership, error: targetError }, { data: existingLink, error: existingError }] =
    await Promise.all([
      serviceSupabase
        .from("user_organization_roles")
        .select("user_id")
        .eq("user_id", body.user_id)
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .maybeSingle(),
      serviceSupabase
        .from("alumni")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("user_id", body.user_id)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle(),
    ]);

  if (targetError || existingError) {
    console.error("[alumni/link-user POST] Failed to validate target user:", targetError ?? existingError);
    return respond({ error: "Unable to validate target user" }, 500);
  }

  if (!targetMembership) {
    return respond({ error: "Target user is not an active member of this organization" }, 403);
  }

  if (existingLink?.id) {
    return respond({ error: "User already has a linked alumni profile" }, 409);
  }

  const { error: updateError } = await serviceSupabase
    .from("alumni")
    .update({
      user_id: body.user_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", alumniId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .is("user_id", null);

  if (updateError) {
    console.error("[alumni/link-user POST] Failed to link alumni:", updateError);
    return respond({ error: "Failed to link alumni profile" }, 500);
  }

  // Audit trail: data_access_log is the org-scoped admin audit table
  // (TEXT resource_type, service-role-only RLS). The repo has no generic
  // admin-mutation audit table, so record the link there with both ids.
  // Awaited but non-blocking on failure — the link itself succeeded.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: auditError } = await (serviceSupabase as any)
    .from("data_access_log")
    .insert({
      actor_user_id: user.id,
      resource_type: "alumni_user_link",
      resource_id: `${alumniId}:${body.user_id}`,
      organization_id: organizationId,
    });

  if (auditError) {
    console.error("[alumni/link-user POST] Failed to write audit log:", auditError);
  }

  return respond({ ok: true });
}
