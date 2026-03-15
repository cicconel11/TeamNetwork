import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import { editAlumniSchema, type EditAlumniForm } from "@/lib/schemas/member";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { buildAlumniWritePayload, canMutateAlumni } from "@/lib/alumni/mutations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string; alumniId: string }>;
}

async function resolveAlumniAccess(params: { organizationId: string; alumniId: string; userId: string }) {
  const serviceSupabase = createServiceClient();
  const [{ data: roleData, error: roleError }, { data: alumni, error: alumniError }] = await Promise.all([
    serviceSupabase
      .from("user_organization_roles")
      .select("role")
      .eq("user_id", params.userId)
      .eq("organization_id", params.organizationId)
      .eq("status", "active")
      .maybeSingle(),
    serviceSupabase
      .from("alumni")
      .select("id, user_id")
      .eq("id", params.alumniId)
      .eq("organization_id", params.organizationId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  if (roleError) {
    throw new Error("Unable to verify permissions");
  }

  if (alumniError) {
    throw new Error("Unable to load alumni record");
  }

  return {
    isAdmin: roleData?.role === "admin",
    isSelf: Boolean(alumni?.user_id && alumni.user_id === params.userId),
    alumniExists: Boolean(alumni?.id),
  };
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { organizationId, alumniId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success || !baseSchemas.uuid.safeParse(alumniId).success) {
    return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let access;
  try {
    access = await resolveAlumniAccess({ organizationId, alumniId, userId: user.id });
  } catch (error) {
    console.error("[alumni PATCH] Access resolution failed:", error);
    return NextResponse.json({ error: "Unable to verify permissions" }, { status: 500 });
  }

  if (!access.alumniExists) {
    return NextResponse.json({ error: "Alumni not found" }, { status: 404 });
  }

  const { isReadOnly } = await checkOrgReadOnly(organizationId);
  if (isReadOnly) {
    return NextResponse.json(readOnlyResponse(), { status: 403 });
  }

  const policy = canMutateAlumni({
    action: "update",
    isAdmin: access.isAdmin,
    isSelf: access.isSelf,
    isReadOnly,
  });
  if (!policy.allowed) {
    return NextResponse.json({ error: policy.error, code: policy.code }, { status: policy.status });
  }

  let body: EditAlumniForm;
  try {
    body = await validateJson(req, editAlumniSchema, { maxBodyBytes: 100_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("alumni")
    .update({
      ...buildAlumniWritePayload(body),
      updated_at: new Date().toISOString(),
    })
    .eq("id", alumniId)
    .eq("organization_id", organizationId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { organizationId, alumniId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success || !baseSchemas.uuid.safeParse(alumniId).success) {
    return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let access;
  try {
    access = await resolveAlumniAccess({ organizationId, alumniId, userId: user.id });
  } catch (error) {
    console.error("[alumni DELETE] Access resolution failed:", error);
    return NextResponse.json({ error: "Unable to verify permissions" }, { status: 500 });
  }

  if (!access.alumniExists) {
    return NextResponse.json({ error: "Alumni not found" }, { status: 404 });
  }

  const { isReadOnly } = await checkOrgReadOnly(organizationId);
  if (isReadOnly) {
    return NextResponse.json(readOnlyResponse(), { status: 403 });
  }

  const policy = canMutateAlumni({
    action: "delete",
    isAdmin: access.isAdmin,
    isSelf: access.isSelf,
    isReadOnly,
  });
  if (!policy.allowed) {
    return NextResponse.json({ error: policy.error, code: policy.code }, { status: policy.status });
  }

  const { error: deleteError } = await supabase
    .from("alumni")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", alumniId)
    .eq("organization_id", organizationId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  // Invalidate cached pages that display alumni data
  const serviceSupabase = createServiceClient();
  const { data: org } = await serviceSupabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .single();

  if (org?.slug) {
    revalidatePath(`/${org.slug}`);
    revalidatePath(`/${org.slug}/alumni`);
  }

  return NextResponse.json({ success: true });
}
