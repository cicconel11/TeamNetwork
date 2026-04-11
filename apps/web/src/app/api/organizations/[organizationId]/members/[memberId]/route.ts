import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { getOrgMemberRole } from "@/lib/parents/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; memberId: string }>;
}

const patchSchema = z
  .object({
    role: z.enum(["admin", "active_member", "alumni", "parent"]).optional(),
    status: z.enum(["active", "revoked", "pending"]).optional(),
  })
  .refine((d) => d.role !== undefined || d.status !== undefined, {
    message: "At least one of role or status is required",
  });

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId, memberId: userId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const userIdParsed = baseSchemas.uuid.safeParse(userId);
  if (!userIdParsed.success) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "member role update",
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

  const role = await getOrgMemberRole(supabase, user.id, organizationId);
  if (role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = await validateJson(req, patchSchema, { maxBodyBytes: 1_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const serviceSupabase = createServiceClient();

  const updatePayload: Record<string, string> = {};
  if (body.role !== undefined) updatePayload.role = body.role;
  if (body.status !== undefined) updatePayload.status = body.status;

  const { error: updateError } = await serviceSupabase
    .from("user_organization_roles")
    .update(updatePayload)
    .eq("organization_id", organizationId)
    .eq("user_id", userId);

  if (updateError) {
    console.error("[members PATCH] DB error:", updateError);
    return respond({ error: "Failed to update member" }, 500);
  }

  // Invalidate router cache so navigating to other pages shows fresh data
  const { data: orgSlugRow } = await serviceSupabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .single();

  if (orgSlugRow?.slug) {
    const slug = orgSlugRow.slug;
    revalidatePath(`/${slug}`);
    revalidatePath(`/${slug}/members`, "layout");
    revalidatePath(`/${slug}/parents`, "layout");
    revalidatePath(`/${slug}/settings/invites`);
  }

  return respond({ success: true });
}
