import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import {
  getEnterpriseApiContext,
  ENTERPRISE_ANY_ROLE,
  ENTERPRISE_OWNER_ROLE,
} from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import type { Enterprise } from "@/types/enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalSafeString(800),
    logo_url: z.string().url().max(500).optional().nullable(),
    primary_color: baseSchemas.hexColor.optional().nullable(),
    billing_contact_email: baseSchemas.email.optional(),
  })
  .strict();

export async function GET(req: Request, { params }: RouteParams) {
  const { enterpriseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "enterprise settings",
    limitPerIp: 60,
    limitPerUser: 40,
  });

  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_ANY_ROLE);
  if (!ctx.ok) return ctx.response;

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  // Parallelize enterprise and admins queries
  const [
    { data: enterprise, error: enterpriseError },
    { data: admins, error: adminsError },
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.serviceSupabase as any)
      .from("enterprises")
      .select("*")
      .eq("id", ctx.enterpriseId)
      .single() as Promise<{ data: Enterprise | null; error: Error | null }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx.serviceSupabase as any)
      .from("user_enterprise_roles")
      .select("id, user_id, role, created_at")
      .eq("enterprise_id", ctx.enterpriseId)
      .order("created_at", { ascending: true }) as Promise<{ data: { user_id: string; role: string }[] | null; error: Error | null }>,
  ]);

  if (enterpriseError || !enterprise) {
    return respond({ error: "Enterprise not found" }, 404);
  }

  if (adminsError) {
    return respond({ error: adminsError.message }, 400);
  }

  const userIds = (admins ?? []).map((admin) => admin.user_id);
  let userDetails: Record<string, { email: string; full_name: string | null }> = {};

  if (userIds.length > 0) {
    // Using getUserById per user avoids unbounded listUsers() pagination
    const userFetches = await Promise.all(
      userIds.map((id) => ctx.serviceSupabase.auth.admin.getUserById(id))
    );
    userFetches.forEach((r, i) => {
      if (r.error) console.error("[enterprise/settings] getUserById failed for", userIds[i], r.error);
    });
    userDetails = userFetches
      .filter((r) => !r.error && r.data.user)
      .map((r) => r.data.user!)
      .reduce((acc, u) => {
        acc[u.id] = {
          email: u.email ?? "",
          full_name: (u.user_metadata?.full_name as string) ?? null,
        };
        return acc;
      }, {} as Record<string, { email: string; full_name: string | null }>);
  }

  const adminsWithDetails = (admins ?? []).map((admin) => ({
    user_id: admin.user_id,
    role: admin.role,
    user_name: userDetails[admin.user_id]?.full_name ?? null,
    user_email: userDetails[admin.user_id]?.email ?? null,
  }));

  return respond({
    enterprise,
    admins: adminsWithDetails,
    userRole: ctx.role,
  });
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "enterprise settings update",
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

    const body = await validateJson(req, patchSchema, { maxBodyBytes: 16_000 });

    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload.name = body.name;
    if (body.description !== undefined) updatePayload.description = body.description;
    if (body.logo_url !== undefined) updatePayload.logo_url = body.logo_url;
    if (body.primary_color !== undefined) updatePayload.primary_color = body.primary_color;
    if (body.billing_contact_email !== undefined) updatePayload.billing_contact_email = body.billing_contact_email;

    if (Object.keys(updatePayload).length === 0) {
      return respond({ error: "No valid fields to update" }, 400);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (ctx.serviceSupabase as any)
      .from("enterprises")
      .update(updatePayload)
      .eq("id", ctx.enterpriseId)
      .select()
      .single() as { data: Enterprise | null; error: Error | null };

    if (updateError) {
      return respond({ error: updateError.message }, 400);
    }

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "update_settings",
      enterpriseId: ctx.enterpriseId,
      targetType: "enterprise",
      targetId: ctx.enterpriseId,
      metadata: { updatedFields: Object.keys(updatePayload) },
      ...extractRequestContext(req),
    });

    return respond({ enterprise: updated });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
