import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import {
  buildEnterpriseMembers,
  getActiveAdminOrgIds,
  paginateEnterpriseMemberUsers,
} from "@/lib/enterprise/member-list";

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
  const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Math.max(Number.isNaN(parsedLimit) ? 50 : parsedLimit, 1), 100);
  const after = url.searchParams.get("after") ?? null;

  // Get enterprise sub-orgs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs, error: orgsError } = await (ctx.serviceSupabase as any)
    .from("organizations")
    .select("id, name, slug")
    .eq("enterprise_id", ctx.enterpriseId) as { data: Array<{ id: string; name: string; slug: string }> | null; error: unknown };

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
      .select("organization_id, status")
      .eq("user_id", ctx.userId)
      .eq("role", "admin")
      .eq("status", "active")
      .in("organization_id", scopedOrgIds);

    scopedOrgIds = getActiveAdminOrgIds(
      (callerOrgRoles ?? []) as Array<{ organization_id: string; status: string | null }>
    );

    if (scopedOrgIds.length === 0) {
      return respond({ members: [], nextCursor: null });
    }
  }

  let userQuery = ctx.serviceSupabase
    .from("users")
    .select("id, email, name, user_organization_roles!inner(organization_id)")
    .in("user_organization_roles.organization_id", scopedOrgIds)
    .eq("user_organization_roles.status", "active")
    .order("id", { ascending: true });

  if (after) {
    userQuery = userQuery.gt("id", after);
  }

  const { data: usersPage, error: usersPageError } = await userQuery.limit(limit + 1) as {
    data: Array<{ id: string; email: string | null; name: string | null }> | null;
    error: unknown;
  };

  if (usersPageError) {
    return respond({ error: "Failed to fetch enterprise members" }, 500);
  }

  if (!usersPage || usersPage.length === 0) {
    return respond({ members: [], nextCursor: null });
  }

  const paginatedUsers = paginateEnterpriseMemberUsers(usersPage, limit);
  const userIds = paginatedUsers.users.map((member) => member.id);

  const { data: roles, error: rolesError } = await ctx.serviceSupabase
    .from("user_organization_roles")
    .select("user_id, organization_id, role, status")
    .in("organization_id", scopedOrgIds)
    .in("user_id", userIds)
    .eq("status", "active")
    .order("user_id", { ascending: true })
    .order("organization_id", { ascending: true });

  if (rolesError) {
    return respond({ error: "Failed to fetch member roles" }, 500);
  }

  const members = buildEnterpriseMembers(
    paginatedUsers.users,
    (roles ?? []) as Array<{
      user_id: string;
      organization_id: string;
      role: string;
      status?: string | null;
    }>,
    orgs
  );

  return respond({ members, nextCursor: paginatedUsers.nextCursor });
}
