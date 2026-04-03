import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";

const createInviteSchema = z.object({
  role: z.enum(["admin", "active_member", "alumni", "parent"]),
  uses: z.number().int().positive().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  requireApproval: z.boolean().optional().nullable(),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org invite create",
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
  const { data: roleData, error: roleError } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (roleError) {
    console.error("[org/invites POST] Failed to fetch role:", roleError);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  if (roleData?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  let body: z.infer<typeof createInviteSchema>;
  try {
    body = await validateJson(req, createInviteSchema, { maxBodyBytes: 4_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  // Use the authenticated client so auth.uid() is available inside the RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite, error: rpcError } = await (supabase as any).rpc("create_org_invite", {
    p_organization_id: organizationId,
    p_role: body.role,
    p_uses: body.uses ?? null,
    p_expires_at: body.expiresAt ?? null,
    p_require_approval: body.requireApproval ?? null,
  });

  if (rpcError || !invite) {
    console.error("[org/invites POST] RPC error:", rpcError);
    return respond({ error: rpcError?.message || "Failed to create invite" }, 400);
  }

  const { data: orgSlugRow } = await serviceSupabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgSlugRow?.slug) {
    revalidatePath(`/${orgSlugRow.slug}/settings/invites`);
    revalidatePath(`/${orgSlugRow.slug}/settings/approvals`);
  }

  return respond({ invite });
}
