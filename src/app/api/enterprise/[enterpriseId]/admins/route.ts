import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import {
  requireEnterpriseRole,
  requireEnterpriseOwner,
} from "@/lib/auth/enterprise-roles";
import type { EnterpriseRole } from "@/types/enterprise";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for user_enterprise_roles table row (until types are regenerated)
interface UserEnterpriseRoleRow {
  id: string;
  user_id: string;
  enterprise_id: string;
  role: EnterpriseRole;
  created_at: string;
}

const inviteAdminSchema = z
  .object({
    email: baseSchemas.email,
    role: z.enum(["owner", "billing_admin", "org_admin"]),
  })
  .strict();

const removeAdminSchema = z
  .object({
    userId: baseSchemas.uuid,
  })
  .strict();

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise admins",
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
  const { data: resolved, error: resolveError } = await resolveEnterpriseParam(enterpriseId, serviceSupabase);
  if (resolveError) {
    return respond({ error: resolveError.message }, resolveError.status);
  }

  const resolvedEnterpriseId = resolved?.enterpriseId ?? enterpriseId;

  try {
    // Any enterprise member can view admins
    await requireEnterpriseRole(resolvedEnterpriseId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Forbidden";
    if (message === "Unauthorized") {
      return respond({ error: "Unauthorized" }, 401);
    }
    return respond({ error: "Forbidden" }, 403);
  }

  // Get all enterprise admins with user details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: admins, error } = await (serviceSupabase as any)
    .from("user_enterprise_roles")
    .select("id, user_id, role, created_at")
    .eq("enterprise_id", resolvedEnterpriseId)
    .order("created_at", { ascending: true }) as { data: UserEnterpriseRoleRow[] | null; error: Error | null };

  if (error) {
    return respond({ error: error.message }, 400);
  }

  // Fetch user details for each admin
  const userIds = (admins ?? []).map((admin) => admin.user_id);
  let userDetails: Record<string, { email: string; full_name: string | null }> = {};

  if (userIds.length > 0) {
    // Using the auth.users table requires admin access
    const { data: users } = await serviceSupabase.auth.admin.listUsers();
    if (users?.users) {
      userDetails = users.users.reduce((acc, u) => {
        if (userIds.includes(u.id)) {
          acc[u.id] = {
            email: u.email ?? "",
            full_name: (u.user_metadata?.full_name as string) ?? null,
          };
        }
        return acc;
      }, {} as Record<string, { email: string; full_name: string | null }>);
    }
  }

  const adminsWithDetails = (admins ?? []).map((admin) => ({
    ...admin,
    email: userDetails[admin.user_id]?.email ?? null,
    full_name: userDetails[admin.user_id]?.full_name ?? null,
  }));

  return respond({ admins: adminsWithDetails });
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "invite enterprise admin",
      limitPerIp: 20,
      limitPerUser: 10,
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
      // Only owner can invite new admins
      await requireEnterpriseOwner(resolvedEnterpriseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forbidden";
      if (message === "Unauthorized") {
        return respond({ error: "Unauthorized" }, 401);
      }
      return respond({ error: "Forbidden" }, 403);
    }

    const body = await validateJson(req, inviteAdminSchema, { maxBodyBytes: 8_000 });
    const { email, role } = body;

    // Find user by email
    const { data: users } = await serviceSupabase.auth.admin.listUsers();
    const targetUser = users?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!targetUser) {
      return respond({ error: "User not found. They must create an account first." }, 404);
    }

    // Check if user already has a role in this enterprise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingRole } = await (serviceSupabase as any)
      .from("user_enterprise_roles")
      .select("id, role")
      .eq("enterprise_id", resolvedEnterpriseId)
      .eq("user_id", targetUser.id)
      .maybeSingle() as { data: UserEnterpriseRoleRow | null };

    if (existingRole) {
      return respond({ error: "User already has a role in this enterprise" }, 409);
    }

    // Create the role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newRole, error: roleError } = await (serviceSupabase as any)
      .from("user_enterprise_roles")
      .insert({
        enterprise_id: resolvedEnterpriseId,
        user_id: targetUser.id,
        role: role as EnterpriseRole,
      })
      .select()
      .single() as { data: UserEnterpriseRoleRow | null; error: Error | null };

    if (roleError) {
      return respond({ error: roleError.message }, 400);
    }

    return respond({
      admin: {
        ...newRole,
        email: targetUser.email,
        full_name: (targetUser.user_metadata?.full_name as string) ?? null,
      },
    }, 201);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}

export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "remove enterprise admin",
      limitPerIp: 20,
      limitPerUser: 10,
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
      // Only owner can remove admins
      await requireEnterpriseOwner(resolvedEnterpriseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forbidden";
      if (message === "Unauthorized") {
        return respond({ error: "Unauthorized" }, 401);
      }
      return respond({ error: "Forbidden" }, 403);
    }

    const body = await validateJson(req, removeAdminSchema, { maxBodyBytes: 4_000 });
    const { userId: targetUserId } = body;

    // Check target user's role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetRole } = await (serviceSupabase as any)
      .from("user_enterprise_roles")
      .select("id, role")
      .eq("enterprise_id", resolvedEnterpriseId)
      .eq("user_id", targetUserId)
      .single() as { data: UserEnterpriseRoleRow | null };

    if (!targetRole) {
      return respond({ error: "User is not an admin of this enterprise" }, 404);
    }

    // If removing an owner, ensure there's at least one other owner
    if (targetRole.role === "owner") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: ownerCount } = await (serviceSupabase as any)
        .from("user_enterprise_roles")
        .select("*", { count: "exact", head: true })
        .eq("enterprise_id", resolvedEnterpriseId)
        .eq("role", "owner") as { count: number | null };

      if ((ownerCount ?? 0) <= 1) {
        return respond({ error: "Cannot remove the last owner. Transfer ownership first." }, 400);
      }
    }

    // Remove the role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteError } = await (serviceSupabase as any)
      .from("user_enterprise_roles")
      .delete()
      .eq("id", targetRole.id) as { error: Error | null };

    if (deleteError) {
      return respond({ error: deleteError.message }, 400);
    }

    return respond({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
