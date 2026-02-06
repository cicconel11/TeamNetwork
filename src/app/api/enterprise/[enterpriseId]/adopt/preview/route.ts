import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { requireEnterpriseOwner } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "adopt org preview",
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
    await requireEnterpriseOwner(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  const url = new URL(req.url);
  const slugParam = url.searchParams.get("slug") ?? "";
  const slugParsed = baseSchemas.slug.safeParse(slugParam);
  if (!slugParsed.success) {
    return respond({ error: "Invalid organization slug" }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (serviceSupabase as any)
    .from("organizations")
    .select("id, name, slug, enterprise_id")
    .eq("slug", slugParsed.data)
    .maybeSingle() as { data: { id: string; name: string; slug: string; enterprise_id: string | null } | null };

  if (!org) {
    return respond({ error: "Organization not found" }, 404);
  }

  if (org.enterprise_id) {
    return respond({ error: "Organization already belongs to an enterprise" }, 400);
  }

  const { count: alumniCount } = await serviceSupabase
    .from("alumni")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .is("deleted_at", null);

  return respond({
    id: org.id,
    name: org.name,
    slug: org.slug,
    alumniCount: alumniCount ?? 0,
  });
}
