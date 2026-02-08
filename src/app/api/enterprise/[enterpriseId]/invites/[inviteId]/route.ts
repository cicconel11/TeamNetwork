import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError } from "@/lib/security/validation";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

const invitePatchSchema = z.object({
  revoked: z.literal(true, { message: "revoked must be true" }),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string; inviteId: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { enterpriseId, inviteId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise invite update",
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

  // Verify invite belongs to this enterprise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite } = await (serviceSupabase as any)
    .from("enterprise_invites")
    .select("*")
    .eq("id", inviteId)
    .eq("enterprise_id", resolvedEnterpriseId)
    .single();

  if (!invite) {
    return respond({ error: "Invite not found" }, 404);
  }

  let body;
  try {
    body = await validateJson(req, invitePatchSchema);
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  if (body.revoked === true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (serviceSupabase as any)
      .from("enterprise_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", inviteId);

    if (updateError) {
      return respond({ error: updateError.message }, 400);
    }

    return respond({ success: true, message: "Invite revoked" });
  }

  return respond({ error: "No valid update operation provided" }, 400);
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { enterpriseId, inviteId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise invite delete",
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

  // Verify invite belongs to this enterprise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite } = await (serviceSupabase as any)
    .from("enterprise_invites")
    .select("id")
    .eq("id", inviteId)
    .eq("enterprise_id", resolvedEnterpriseId)
    .single();

  if (!invite) {
    return respond({ error: "Invite not found" }, 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deleteError } = await (serviceSupabase as any)
    .from("enterprise_invites")
    .delete()
    .eq("id", inviteId);

  if (deleteError) {
    return respond({ error: deleteError.message }, 400);
  }

  return respond({ success: true, message: "Invite deleted" });
}
