import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { normalizeRole } from "@/lib/auth/role-utils";
import { CHAT_ELIGIBLE_ORG_ROLES } from "@/lib/chat/recipient-eligibility";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import {
  getViewerConnectionSuggestions,
  CONNECTIONS_PAGE_DISPLAY_LIMIT,
} from "@/lib/connections/viewer-suggestions";
import type { UserRole } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

// GET /api/organizations/:organizationId/connections/suggestions
//
// "People You Should Meet" — scored connection suggestions for the viewer.
// This is a MEMBER feature (chat-eligible roles), not admin-only. Suggestions are
// always sourced FROM THE VIEWER's own projected member/alumni node (see
// getViewerConnectionSuggestions), so the route can never surface people the
// viewer isn't already a peer of. The Message action re-checks eligibility
// server-side in the direct-chat/profile route.
export async function GET(req: Request, { params }: RouteParams) {
  const { organizationId } = await params;
  if (!baseSchemas.uuid.safeParse(organizationId).success) {
    return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    orgId: organizationId,
    feature: "connection suggestions",
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

  let membership;
  try {
    membership = await getOrgMembership(serviceSupabase, user.id, organizationId);
  } catch (error) {
    console.error("[connections/suggestions GET] Failed to verify membership:", error);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  // getOrgMembership returns the raw role; normalize before the eligibility check
  // (member→active_member, viewer→alumni) so it lines up with CHAT_ELIGIBLE_ORG_ROLES.
  const normalizedRole = normalizeRole((membership?.role as UserRole | null) ?? null);
  const isEligible =
    normalizedRole !== null &&
    (CHAT_ELIGIBLE_ORG_ROLES as readonly string[]).includes(normalizedRole);
  if (!isEligible) {
    return respond({ error: "Forbidden" }, 403);
  }

  try {
    const { state, suggestions } = await getViewerConnectionSuggestions({
      serviceSupabase,
      orgId: organizationId,
      viewerUserId: user.id,
      displayLimit: CONNECTIONS_PAGE_DISPLAY_LIMIT,
    });
    return respond({ state, suggestions });
  } catch (error) {
    console.error("[connections/suggestions GET] Failed to load suggestions:", error);
    return respond({ error: "Failed to load suggestions" }, 500);
  }
}
