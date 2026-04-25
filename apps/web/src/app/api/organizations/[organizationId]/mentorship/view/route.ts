import { NextResponse } from "next/server";
import { createAuthenticatedApiClient } from "@/lib/supabase/api";
import { createServiceClient } from "@/lib/supabase/service";
import { baseSchemas } from "@/lib/security/validation";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { parseMentorshipTab } from "@/lib/mentorship/view-state";
import { loadMentorshipTabView } from "@/lib/mentorship/tab-data";
import { resolveOrgTimezone } from "@/lib/utils/timezone";

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

  const { supabase, user } = await createAuthenticatedApiClient(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(req, {
    userId: user.id,
    orgId: organizationId,
    feature: "mentorship tab view",
    limitPerUser: 120,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const url = new URL(req.url);
  const requestedTab = parseMentorshipTab(url.searchParams.get("tab") ?? undefined);
  const pairParam = url.searchParams.get("pair");
  const pairIdParam =
    pairParam && baseSchemas.uuid.safeParse(pairParam).success ? pairParam : null;

  const service = createServiceClient();
  const [{ data: membership }, { data: organization }] = await Promise.all([
    service
      .from("user_organization_roles")
      .select("role, status")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle(),
    service
      .from("organizations")
      .select("slug, timezone")
      .eq("id", organizationId)
      .maybeSingle(),
  ]);

  if (!membership || membership.status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!organization?.slug) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const view = await loadMentorshipTabView({
    supabase: service,
    orgId: organizationId,
    orgSlug: organization.slug,
    role: membership.role,
    status: membership.status,
    currentUserId: user.id,
    requestedTab,
    pairIdParam,
    orgTimezone: resolveOrgTimezone(organization.timezone),
  });

  return NextResponse.json(view);
}
