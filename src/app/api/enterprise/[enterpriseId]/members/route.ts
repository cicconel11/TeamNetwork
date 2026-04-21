import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

interface MemberOrgInfo {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: string;
}

interface MemberInfo {
  userId: string;
  email: string;
  fullName: string;
  organizations: MemberOrgInfo[];
}

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise members list",
    limitPerIp: 30,
    limitPerUser: 20,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
  const after = url.searchParams.get("after") ?? null;

  // Get enterprise sub-orgs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs, error: orgsError } = await (ctx.serviceSupabase as any)
    .from("organizations")
    .select("id, name, slug")
    .eq("enterprise_id", ctx.enterpriseId)
    .is("deleted_at", null) as { data: Array<{ id: string; name: string; slug: string }> | null; error: unknown };

  if (orgsError || !orgs) {
    return respond({ error: "Failed to fetch enterprise organizations" }, 500);
  }

  if (orgs.length === 0) {
    return respond({ members: [], nextCursor: null });
  }

  // For org_admin: scope to orgs where caller has org-level admin role
  let scopedOrgIds = orgs.map((o) => o.id);

  if (ctx.role === "org_admin") {
    const { data: callerOrgRoles } = await ctx.serviceSupabase
      .from("user_organization_roles")
      .select("organization_id")
      .eq("user_id", ctx.userId)
      .eq("role", "admin")
      .in("organization_id", scopedOrgIds);

    scopedOrgIds = (callerOrgRoles ?? []).map(
      (r: { organization_id: string }) => r.organization_id
    );

    if (scopedOrgIds.length === 0) {
      return respond({ members: [], nextCursor: null });
    }
  }

  // Build org lookup
  const orgLookup = new Map(orgs.map((o) => [o.id, o]));

  // Fetch member roles for scoped orgs with pagination
  let query = ctx.serviceSupabase
    .from("user_organization_roles")
    .select("user_id, organization_id, role, status")
    .in("organization_id", scopedOrgIds)
    .eq("status", "active")
    .order("user_id", { ascending: true });

  if (after) {
    query = query.gt("user_id", after);
  }

  // Fetch more than limit to handle aggregation (multiple rows per user)
  const { data: roles, error: rolesError } = await query.limit(limit * 5);

  if (rolesError) {
    return respond({ error: "Failed to fetch member roles" }, 500);
  }

  if (!roles || roles.length === 0) {
    return respond({ members: [], nextCursor: null });
  }

  // Group roles by user
  const userRolesMap = new Map<string, Array<{ organization_id: string; role: string }>>();
  for (const role of roles) {
    const existing = userRolesMap.get(role.user_id) ?? [];
    existing.push({ organization_id: role.organization_id, role: role.role });
    userRolesMap.set(role.user_id, existing);
  }

  // Get unique user IDs (limited)
  const userIds = Array.from(userRolesMap.keys()).slice(0, limit);

  // Fetch user details from users table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: users, error: usersError } = await (ctx.serviceSupabase as any)
    .from("users")
    .select("id, email, name")
    .in("id", userIds) as {
      data: Array<{ id: string; email: string | null; name: string | null }> | null;
      error: unknown;
    };

  if (usersError) {
    return respond({ error: "Failed to fetch user details" }, 500);
  }

  const userLookup = new Map((users ?? []).map((u) => [u.id, u]));

  // Build response
  const members: MemberInfo[] = userIds.map((userId) => {
    const userInfo = userLookup.get(userId);
    const userRoles = userRolesMap.get(userId) ?? [];

    return {
      userId,
      email: userInfo?.email ?? "",
      fullName: userInfo?.name ?? "",
      organizations: userRoles
        .filter((r) => orgLookup.has(r.organization_id))
        .map((r) => {
          const org = orgLookup.get(r.organization_id)!;
          return {
            orgId: org.id,
            orgName: org.name,
            orgSlug: org.slug,
            role: r.role,
          };
        }),
    };
  });

  const nextCursor = userIds.length === limit ? userIds[userIds.length - 1] : null;

  return respond({ members, nextCursor });
}
