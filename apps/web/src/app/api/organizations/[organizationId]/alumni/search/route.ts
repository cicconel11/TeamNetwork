import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, sanitizeIlikeInput } from "@/lib/security/validation";
import { getOrgMembership } from "@/lib/auth/api-helpers";

const searchQuerySchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid organization id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "alumni linkedin search",
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

  const rawParams = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = searchQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "param"}: ${issue.message}`,
    );
    return respond({ error: "Invalid query parameters", details }, 400);
  }

  const serviceSupabase = createServiceClient();
  let membership;
  try {
    membership = await getOrgMembership(serviceSupabase, user.id, organizationId);
  } catch (error) {
    console.error("[alumni/search GET] Failed to verify membership:", error);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  if (membership?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  const cleanedQuery = parsed.data.query.replace(/,/g, " ").trim();
  const tokens = Array.from(new Set(cleanedQuery.split(/\s+/).filter(Boolean)));
  if (tokens.length === 0) {
    return respond({ results: [] });
  }

  const conditions = tokens.flatMap((token) => {
    const safeToken = sanitizeIlikeInput(token);
    return [
      `first_name.ilike.%${safeToken}%`,
      `last_name.ilike.%${safeToken}%`,
      `email.ilike.%${safeToken}%`,
    ];
  });

  const { data, error } = await serviceSupabase
    .from("alumni")
    .select("id, first_name, last_name, email, linkedin_url")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .or(conditions.join(","))
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(parsed.data.limit);

  if (error) {
    console.error("[alumni/search GET] Failed to search alumni:", error);
    return respond({ error: "Failed to search alumni" }, 500);
  }

  return respond({ results: data ?? [] });
}
