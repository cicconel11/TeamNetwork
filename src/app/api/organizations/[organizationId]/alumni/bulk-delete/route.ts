import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateJson, ValidationError, baseSchemas } from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bulkDeleteSchema = z.object({
  alumniIds: z.array(baseSchemas.uuid).min(1).max(500),
});

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { organizationId: rawOrgId } = await params;

  // Validate organizationId path param
  const orgIdResult = baseSchemas.uuid.safeParse(rawOrgId);
  if (!orgIdResult.success) {
    return NextResponse.json({ error: "Invalid organization ID" }, { status: 400 });
  }
  const organizationId = orgIdResult.data;

  // Rate limit (before auth to throttle unauthenticated traffic)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    limitPerIp: 20,
    limitPerUser: 10,
    userId: user?.id ?? null,
    feature: "alumni-bulk-delete",
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  // Auth
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: rateLimit.headers });
  }

  // Admin role check
  const serviceSupabase = createServiceClient();
  const { data: roleData } = await serviceSupabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (roleData?.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can bulk-delete alumni" },
      { status: 403, headers: rateLimit.headers }
    );
  }

  // Read-only check
  const { isReadOnly } = await checkOrgReadOnly(organizationId);
  if (isReadOnly) {
    return NextResponse.json(readOnlyResponse(), {
      status: 403,
      headers: rateLimit.headers,
    });
  }

  // Validate body
  let body: z.infer<typeof bulkDeleteSchema>;
  try {
    body = await validateJson(req, bulkDeleteSchema);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: 400, headers: rateLimit.headers }
      );
    }
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400, headers: rateLimit.headers }
    );
  }

  const { alumniIds } = body;

  // Soft-delete: set deleted_at on matching alumni within this org
  const { data, error: deleteError } = await serviceSupabase
    .from("alumni")
    .update({ deleted_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .in("id", alumniIds)
    .is("deleted_at", null)
    .select("id");

  if (deleteError) {
    console.error("[alumni/bulk-delete] Soft delete failed:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete alumni records" },
      { status: 500, headers: rateLimit.headers }
    );
  }

  const deletedIds = (data ?? []).map((r) => r.id as string);
  const deleted = deletedIds.length;

  // Cache invalidation
  if (deleted > 0) {
    const { data: org } = await serviceSupabase
      .from("organizations")
      .select("slug, enterprise_id")
      .eq("id", organizationId)
      .single();

    if (org?.slug) {
      revalidatePath(`/${org.slug}`);
      revalidatePath(`/${org.slug}/alumni`);
    }

    if (org?.enterprise_id) {
      revalidateTag(`enterprise-alumni-stats-${org.enterprise_id}`);
    }
  }

  return NextResponse.json({ deleted, deletedIds }, { headers: rateLimit.headers });
}
