import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_OWNER_ROLE } from "@/lib/auth/enterprise-api-context";

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

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_OWNER_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  const url = new URL(req.url);
  const slugParam = url.searchParams.get("slug") ?? "";
  const slugParsed = baseSchemas.slug.safeParse(slugParam);
  if (!slugParsed.success) {
    return respond({ error: "Invalid organization slug" }, 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (ctx.serviceSupabase as any)
    .from("organizations")
    .select("id, name, slug, enterprise_id")
    .eq("slug", slugParsed.data)
    .maybeSingle() as { data: { id: string; name: string; slug: string; enterprise_id: string | null } | null };

  if (!org || org.enterprise_id) {
    return respond({ error: "Organization not available for adoption" }, 404);
  }

  const { count: alumniCount } = await ctx.serviceSupabase
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
