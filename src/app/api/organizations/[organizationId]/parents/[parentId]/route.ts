import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { editParentSchema } from "@/lib/schemas";
import { getOrgMemberRole } from "@/lib/parents/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; parentId: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId, parentId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }
  const parentIdParsed = baseSchemas.uuid.safeParse(parentId);
  if (!parentIdParsed.success) {
    return NextResponse.json({ error: "Invalid parent id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org parents update",
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

  // Membership check and parent fetch run concurrently
  // parents table is not in generated types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untypedService = serviceSupabase as any;
  const [rawRole, { data: existing, error: fetchError }] = await Promise.all([
    getOrgMemberRole(supabase, user.id, organizationId),
    untypedService
      .from("parents")
      .select("id,user_id")
      .eq("id", parentId)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .single(),
  ]);

  if (fetchError || !existing) {
    return respond({ error: "Parent not found" }, 404);
  }

  const isAdmin = rawRole === "admin";
  // isSelf is restricted to parent-role users: active_member/alumni/member have no business
  // editing a parent record even if their user_id was incidentally linked to one.
  const isSelf = rawRole === "parent" && existing.user_id !== null && existing.user_id === user.id;
  if (!isAdmin && !isSelf) {
    return respond({ error: "Forbidden" }, 403);
  }

  let body;
  try {
    body = await validateJson(req, editParentSchema.partial(), { maxBodyBytes: 10_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return respond({ error: error.message, details: error.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.first_name !== undefined) updates.first_name = body.first_name;
  if (body.last_name !== undefined) updates.last_name = body.last_name;
  if (body.email !== undefined) updates.email = body.email ?? null;
  if (body.phone_number !== undefined) updates.phone_number = body.phone_number ?? null;
  if (body.photo_url !== undefined) updates.photo_url = body.photo_url ?? null;
  if (body.linkedin_url !== undefined) updates.linkedin_url = body.linkedin_url ?? null;
  if (body.student_name !== undefined) updates.student_name = body.student_name ?? null;
  if (body.relationship !== undefined) updates.relationship = body.relationship ?? null;
  if (body.notes !== undefined) updates.notes = body.notes ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: parent, error: updateError } = await (serviceSupabase as any)
    .from("parents")
    .update(updates)
    .eq("id", parentId)
    .eq("organization_id", organizationId)
    .select("id,first_name,last_name,email,phone_number,photo_url,linkedin_url,student_name,relationship,notes,created_at")
    .single();

  if (updateError || !parent) {
    console.error("[org/parents PATCH] DB error:", updateError);
    return respond({ error: "Internal server error" }, 500);
  }

  // Invalidate router cache so the parents list and dashboard show fresh data
  const { data: orgSlugRow } = await serviceSupabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .single();
  if (orgSlugRow?.slug) {
    revalidatePath(`/${orgSlugRow.slug}`);
    revalidatePath(`/${orgSlugRow.slug}/parents`);
    revalidatePath(`/${orgSlugRow.slug}/parents/${parentId}`);
  }

  return respond({ parent });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { organizationId, parentId } = await params;

  const orgIdParsed = baseSchemas.uuid.safeParse(organizationId);
  if (!orgIdParsed.success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }
  const parentIdParsed = baseSchemas.uuid.safeParse(parentId);
  if (!parentIdParsed.success) {
    return NextResponse.json({ error: "Invalid parent id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org parents delete",
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

  // Admin only
  const role = await getOrgMemberRole(supabase, user.id, organizationId);
  if (role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  const serviceSupabase = createServiceClient();

  // Verify parent exists and belongs to this org before soft-deleting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (serviceSupabase as any)
    .from("parents")
    .select("id")
    .eq("id", parentId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .single();

  if (!existing) {
    return respond({ error: "Parent not found" }, 404);
  }

  const deleteNow = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deletedRows, error: deleteError } = await (serviceSupabase as any)
    .from("parents")
    .update({ deleted_at: deleteNow, updated_at: deleteNow })
    .eq("id", parentId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .select("id");

  if (deleteError) {
    console.error("[org/parents DELETE] DB error:", deleteError);
    return respond({ error: "Internal server error" }, 500);
  }

  if (!deletedRows || deletedRows.length === 0) {
    // Concurrent deletion already completed — end state is correct, return idempotent success.
    console.warn("[org/parents DELETE] Concurrent soft-delete detected for parentId:", parentId);
  }

  // Invalidate router cache so the parents list and dashboard show fresh data
  const { data: orgSlugRow } = await serviceSupabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .single();
  if (orgSlugRow?.slug) {
    revalidatePath(`/${orgSlugRow.slug}`);
    revalidatePath(`/${orgSlugRow.slug}/parents`);
  }

  return respond({ success: true });
}
