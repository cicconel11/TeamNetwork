import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise lookup",
    limitPerIp: 60,
    limitPerUser: 40,
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

  // Look up enterprise by slug
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enterprise, error } = await (serviceSupabase as any)
    .from("enterprises")
    .select("id, name, slug")
    .eq("slug", slug)
    .single() as { data: { id: string; name: string; slug: string } | null; error: Error | null };

  if (error || !enterprise) {
    return respond({ error: "Enterprise not found" }, 404);
  }

  // Verify user has access to this enterprise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: role } = await (serviceSupabase as any)
    .from("user_enterprise_roles")
    .select("role")
    .eq("enterprise_id", enterprise.id)
    .eq("user_id", user.id)
    .single() as { data: { role: string } | null; error: Error | null };

  if (!role) {
    return respond({ error: "Forbidden" }, 403);
  }

  return respond({
    id: enterprise.id,
    name: enterprise.name,
    slug: enterprise.slug,
  });
}
