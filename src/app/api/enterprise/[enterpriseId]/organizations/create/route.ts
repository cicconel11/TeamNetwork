import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  safeString,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { requireEnterpriseRole } from "@/lib/auth/enterprise-roles";
import { resolveEnterpriseParam } from "@/lib/enterprise/resolve-enterprise";

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
    primaryColor: baseSchemas.hexColor.optional(),
    billingType: z.enum(["enterprise_managed", "independent"]).default("enterprise_managed"),
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
      // Require owner or org_admin role to create sub-organizations
      await requireEnterpriseRole(resolvedEnterpriseId, ["owner", "org_admin"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forbidden";
      if (message === "Unauthorized") {
        return respond({ error: "Unauthorized" }, 401);
      }
      return respond({ error: "Forbidden" }, 403);
    }

    const body = await validateJson(req, createOrgSchema, { maxBodyBytes: 16_000 });
    const { name, slug, description, primary_color, primaryColor, billingType } = body;

    // Check slug uniqueness across both organizations and enterprises
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingOrg } = await (serviceSupabase as any)
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle() as { data: { id: string } | null };

    if (existingOrg) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingEnterprise } = await (serviceSupabase as any)
      .from("enterprises")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null };

    if (existingEnterprise) {
      return respond({ error: "Slug is already taken" }, 409);
    }

    // Check enterprise exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enterprise } = await (serviceSupabase as any)
      .from("enterprises")
      .select("id, primary_color")
      .eq("id", resolvedEnterpriseId)
      .single() as { data: EnterpriseRow | null };

    if (!enterprise) {
      return respond({ error: "Enterprise not found" }, 404);
    }

    // Create organization under enterprise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newOrg, error: orgError } = await (serviceSupabase as any)
      .from("organizations")
      .insert({
        name,
        slug,
        description: description ?? null,
        primary_color: primary_color ?? primaryColor ?? enterprise.primary_color ?? "#1e3a5f",
        enterprise_id: resolvedEnterpriseId,
        enterprise_relationship_type: "created",
      })
      .select()
      .single() as { data: Record<string, unknown> | null; error: Error | null };

    if (orgError || !newOrg) {
      return respond({ error: orgError?.message ?? "Unable to create organization" }, 400);
    }

    // Grant creator admin role on new organization
    const { error: roleError } = await serviceSupabase
      .from("user_organization_roles")
      .insert({
        user_id: user.id,
        organization_id: newOrg.id as string,
        role: "admin",
      });

    if (roleError) {
      // Cleanup if role assignment fails
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (serviceSupabase as any).from("organizations").delete().eq("id", newOrg.id);
      return respond({ error: roleError.message }, 400);
    }

    // Create subscription record based on billing type
    // enterprise_managed: Uses pooled alumni quota, placeholder values for required fields
    // independent (pending): Org pays separately, needs to set up own subscription via checkout
    const subscriptionStatus = billingType === "enterprise_managed" ? "enterprise_managed" : "pending";

    // For enterprise_managed: base_plan_interval and alumni_bucket are placeholders
    // (billing is handled at enterprise level, alumni quota is pooled)
    // For independent: these will be updated when org completes checkout
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: subError } = await (serviceSupabase as any)
      .from("organization_subscriptions")
      .insert({
        organization_id: newOrg.id,
        status: subscriptionStatus,
        base_plan_interval: "month", // Placeholder for enterprise_managed, updated on checkout for independent
        alumni_bucket: "none", // Enterprise quota is pooled, independent sets via checkout
      }) as { error: Error | null };

    if (subError) {
      // Cleanup if subscription creation fails - org needs subscription to function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (serviceSupabase as any).from("user_organization_roles").delete().eq("organization_id", newOrg.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (serviceSupabase as any).from("organizations").delete().eq("id", newOrg.id);
      return respond({ error: "Failed to create organization subscription" }, 500);
    }

    return respond({ organization: newOrg }, 201);
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }
    throw error;
  }
}
