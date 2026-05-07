import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/organizations/by-slug/[slug]
 * 
 * Returns the organization ID for a given slug.
 * Used by CheckoutSuccessBanner to poll for org creation after checkout.
 * 
 * Security:
 * - Rate-limited to prevent enumeration attacks
 * - Returns only { id } to minimize data exposure
 * - Requires authentication
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { slug } = await params;
  
  // Validate slug format
  const slugParsed = baseSchemas.slug.safeParse(slug);
  if (!slugParsed.success) {
    return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Rate limit based on user (if authed) or IP
  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "org-by-slug",
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

  const { data: org, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[by-slug] Failed to lookup organization:", error);
    return respond({ error: "Failed to lookup organization" }, 500);
  }

  if (!org) {
    return respond({ error: "Organization not found" }, 404);
  }

  // Return only the ID to minimize data exposure
  return respond({ id: org.id });
}
