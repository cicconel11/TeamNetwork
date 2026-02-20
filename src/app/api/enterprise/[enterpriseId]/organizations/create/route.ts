import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { getEnterpriseApiContext, ENTERPRISE_CREATE_ORG_ROLE } from "@/lib/auth/enterprise-api-context";
import { logEnterpriseAuditAction, extractRequestContext } from "@/lib/audit/enterprise-audit";
import { canEnterpriseAddSubOrg } from "@/lib/enterprise/quota";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ enterpriseId: string }>;
}

// Type for enterprise row (until types are regenerated)
interface EnterpriseRow {
  id: string;
  primary_color: string | null;
}

const createOrgSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    description: optionalSafeString(800),
    primary_color: baseSchemas.hexColor.optional(),
    // Independent billing is not yet implemented - only enterprise_managed is supported
    billingType: z.literal("enterprise_managed").default("enterprise_managed"),
  })
  .strict();

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { enterpriseId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(req, {
      userId: user?.id ?? null,
      feature: "create sub-organization",
      limitPerIp: 20,
      limitPerUser: 10,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const ctx = await getEnterpriseApiContext(enterpriseId, user, rateLimit, ENTERPRISE_CREATE_ORG_ROLE);
    if (!ctx.ok) return ctx.response;

    const respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    const body = await validateJson(req, createOrgSchema, { maxBodyBytes: 16_000 });
    const { name, slug, description, primary_color } = body;

    // Check seat limit for enterprise-managed orgs
    const seatQuota = await canEnterpriseAddSubOrg(ctx.enterpriseId);
    if (seatQuota.error) {
      return respond(
        { error: "Unable to verify seat limit. Please try again." },
        503
      );
    }

    // Check slug uniqueness across both organizations and enterprises
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingOrg } = await (ctx.serviceSupabase as any)
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null };

    if (existingOrg) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingEnterprise } = await (ctx.serviceSupabase as any)
      .from("enterprises")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null };

    if (existingEnterprise) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // Check enterprise exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enterprise } = await (ctx.serviceSupabase as any)
      .from("enterprises")
      .select("id, primary_color")
      .eq("id", ctx.enterpriseId)
      .single() as { data: EnterpriseRow | null };

    if (!enterprise) {
      return respond({ error: "Enterprise not found" }, 404);
    }

    // Create organization under enterprise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newOrg, error: orgError } = await (ctx.serviceSupabase as any)
      .from("organizations")
      .insert({
        name,
        slug,
        description: description ?? null,
        primary_color: primary_color ?? enterprise.primary_color ?? "#1e3a5f",
        enterprise_id: ctx.enterpriseId,
        enterprise_relationship_type: "created",
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: Error | null };

    if (orgError || !newOrg) {
      if (orgError) console.error("[enterprise-create-org] Insert failed:", orgError);
      return respond({ error: "Unable to create organization" }, 400);
    }

    // Grant creator admin role on new organization
    const { error: roleError } = await ctx.serviceSupabase
      .from("user_organization_roles")
      .insert({
        user_id: ctx.userId,
        organization_id: newOrg.id as string,
        role: "admin",
      });

    if (roleError) {
      // Cleanup if role assignment fails
      console.error("[enterprise-create-org] Role insert failed:", roleError);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ctx.serviceSupabase as any).from("organizations").delete().eq("id", newOrg.id);
      return respond({ error: "Failed to assign admin role" }, 400);
    }

    // Create subscription record for enterprise-managed org
    // Uses pooled alumni quota, placeholder values for required fields
    // (billing is handled at enterprise level, alumni quota is pooled)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: subError } = await (ctx.serviceSupabase as any)
      .from("organization_subscriptions")
      .insert({
        organization_id: newOrg.id,
        status: "enterprise_managed",
        base_plan_interval: "month", // Placeholder - billing handled at enterprise level
        alumni_bucket: "none", // Enterprise quota is pooled
      }) as { error: Error | null };

    if (subError) {
      // Cleanup if subscription creation fails - org needs subscription to function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ctx.serviceSupabase as any).from("user_organization_roles").delete().eq("organization_id", newOrg.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (ctx.serviceSupabase as any).from("organizations").delete().eq("id", newOrg.id);
      return respond({ error: "Failed to create organization subscription" }, 500);
    }

    logEnterpriseAuditAction({
      actorUserId: ctx.userId,
      actorEmail: ctx.userEmail,
      action: "create_sub_org",
      enterpriseId: ctx.enterpriseId,
      targetType: "organization",
      targetId: newOrg.id as string,
      metadata: { name, slug },
      ...extractRequestContext(req),
    });

    return respond({ organization: newOrg }, 201);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
