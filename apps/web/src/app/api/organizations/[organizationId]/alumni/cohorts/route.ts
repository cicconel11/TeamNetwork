import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOrgMembership } from "@/lib/auth/api-helpers";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import {
  classifyAlumniReachability,
  fetchAllPaged,
  linkedUserIdsOf,
  resolveEligibleUserIds,
  type ReachabilitySegment,
} from "@/lib/alumni/reachability-segments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ organizationId: string }>;
}

interface CohortAlumniRow {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  last_invite_sent_at: string | null;
  invite_count: number | null;
}

interface CohortEntry {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  segment: ReachabilitySegment;
  last_invite_sent_at: string | null;
  invite_count: number;
}

// GET /api/organizations/:organizationId/alumni/cohorts
//
// Admin-only: list this org's non-deleted alumni tagged with their reachability
// segment (the same predicate the data-health card counts, so the two surfaces
// agree). Returns alumni PII — every entry point here is admin-gated.
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
    feature: "alumni cohorts list",
    limitPerIp: 60,
    limitPerUser: 60,
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
    console.error("[alumni/cohorts GET] Failed to verify membership:", error);
    return respond({ error: "Unable to verify permissions" }, 500);
  }

  if (membership?.role !== "admin") {
    return respond({ error: "Forbidden" }, 403);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = serviceSupabase as any;

  let rows: CohortAlumniRow[];
  let truncated: boolean;
  try {
    const result = await fetchAllPaged<CohortAlumniRow>((from, to) =>
      sb
        .from("alumni")
        .select("id, user_id, first_name, last_name, email, last_invite_sent_at, invite_count")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true })
        .range(from, to)
    );
    rows = result.rows;
    truncated = result.truncated;
  } catch (error) {
    console.error("[alumni/cohorts GET] Failed to load alumni:", error);
    return respond({ error: "Failed to load alumni" }, 500);
  }

  let eligibleUserIds: Set<string>;
  try {
    const resolved = await resolveEligibleUserIds(sb, organizationId, linkedUserIdsOf(rows));
    eligibleUserIds = resolved.eligibleUserIds;
    truncated = truncated || resolved.truncated;
  } catch (error) {
    console.error("[alumni/cohorts GET] Failed to resolve eligibility:", error);
    return respond({ error: "Failed to resolve reachability" }, 500);
  }

  const entries: CohortEntry[] = rows.map((row) => ({
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    segment: classifyAlumniReachability(
      { user_id: row.user_id, email: row.email, deleted_at: null },
      eligibleUserIds
    ),
    last_invite_sent_at: row.last_invite_sent_at,
    invite_count: typeof row.invite_count === "number" ? row.invite_count : 0,
  }));

  return respond({ entries, truncated });
}
