import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import { newAlumniSchema, type NewAlumniForm } from "@/lib/schemas/member";
import { buildAlumniWritePayload, canMutateAlumni } from "@/lib/alumni/mutations";
import { getAlumniCapacitySnapshot } from "@/lib/alumni/capacity";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

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

  const rl = checkRateLimit(req, {
    limitPerIp: 30,
    limitPerUser: 20,
    feature: "alumni management",
  });
  if (!rl.ok) return buildRateLimitResponse(rl);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    console.error("[alumni POST] Failed to fetch role:", roleError);
    return NextResponse.json({ error: "Unable to verify permissions" }, { status: 500 });
  }

  const policy = canMutateAlumni({
    action: "create",
    isAdmin: roleData?.role === "admin",
    isSelf: false,
    isReadOnly: false,
  });
  if (!policy.allowed) {
    return NextResponse.json({ error: policy.error, code: policy.code }, { status: policy.status });
  }

  let body: NewAlumniForm;
  try {
    body = await validateJson(req, newAlumniSchema, { maxBodyBytes: 100_000 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let capacitySnapshot;
  try {
    capacitySnapshot = await getAlumniCapacitySnapshot(organizationId);
  } catch (error) {
    console.error("[alumni POST] Failed to verify alumni capacity:", error);
    return NextResponse.json({ error: "Failed to verify alumni capacity" }, { status: 500 });
  }

  if (capacitySnapshot.remainingCapacity <= 0) {
    return NextResponse.json(
      { error: "Alumni quota reached for this plan. Upgrade your subscription to add more alumni." },
      { status: 409 },
    );
  }

  const insertPayload = {
    organization_id: organizationId,
    ...buildAlumniWritePayload(body),
  };

  const { data: created, error: insertError } = await supabase
    .from("alumni")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  const { data: orgEnterprise } = await serviceSupabase
    .from("organizations")
    .select("enterprise_id")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgEnterprise?.enterprise_id) {
    revalidateTag(`enterprise-alumni-stats-${orgEnterprise.enterprise_id}`);
  }

  return NextResponse.json({ id: created?.id ?? null });
}
