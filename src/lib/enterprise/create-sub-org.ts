/**
 * Shared helper for creating an enterprise sub-organization.
 *
 * Used by both:
 *   - POST /api/enterprise/[enterpriseId]/organizations/create
 *   - POST /api/enterprise/[enterpriseId]/organizations/create-with-upgrade
 *
 * Handles: parallel slug uniqueness checks, org insert, role assignment,
 * subscription creation, and full rollback on any step failure.
 */

// Type for enterprise row (until types are regenerated)
interface EnterpriseRow {
  id: string;
  primary_color: string | null;
}

export interface CreateSubOrgParams {
  serviceSupabase: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  enterpriseId: string;
  userId: string;
  name: string;
  slug: string;
  description?: string | null;
  primaryColor?: string | null;
  enterprisePrimaryColor: string | null;
}

export type CreateSubOrgResult =
  | { ok: true; org: Record<string, unknown> }
  | { ok: false; error: string; status: number };

export async function createEnterpriseSubOrg(
  params: CreateSubOrgParams
): Promise<CreateSubOrgResult> {
  const {
    serviceSupabase,
    enterpriseId,
    userId,
    name,
    slug,
    description,
    primaryColor,
    enterprisePrimaryColor,
  } = params;

  // Parallel slug uniqueness check across orgs and enterprises
  const [{ data: existingOrg }, { data: existingEnterprise }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as Promise<{ data: { id: string } | null }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("enterprises")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as Promise<{ data: { id: string } | null }>,
  ]);

  if (existingOrg || existingEnterprise) {
    return { ok: false, error: "Slug is already taken", status: 409 };
  }

  // Create organization under enterprise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newOrg, error: orgError } = await (serviceSupabase as any)
    .from("organizations")
    .insert({
      name,
      slug,
      description: description ?? null,
      primary_color: primaryColor ?? enterprisePrimaryColor ?? "#1e3a5f",
      enterprise_id: enterpriseId,
      enterprise_relationship_type: "created",
    })
    .select()
    .single() as { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null };

  if (orgError || !newOrg) {
    // Catch unique constraint violation (e.g., race condition on slug)
    if (orgError?.code === "23505") {
      return { ok: false, error: "Slug is already taken", status: 409 };
    }
    if (orgError) console.error("[createEnterpriseSubOrg] org insert failed:", orgError);
    return { ok: false, error: "Unable to create organization", status: 400 };
  }

  // Grant creator admin role on new organization
  const { error: roleError } = await serviceSupabase
    .from("user_organization_roles")
    .insert({
      user_id: userId,
      organization_id: newOrg.id as string,
      role: "admin",
    });

  if (roleError) {
    console.error("[createEnterpriseSubOrg] role insert failed:", roleError);
    // Rollback: delete the org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceSupabase as any).from("organizations").delete().eq("id", newOrg.id);
    return { ok: false, error: "Failed to assign admin role", status: 400 };
  }

  // Create subscription record for enterprise-managed org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: subError } = await (serviceSupabase as any)
    .from("organization_subscriptions")
    .insert({
      organization_id: newOrg.id,
      status: "enterprise_managed",
      base_plan_interval: "month",
      alumni_bucket: "none",
    }) as { error: Error | null };

  if (subError) {
    console.error("[createEnterpriseSubOrg] subscription insert failed:", subError);
    // Rollback: delete role + org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceSupabase as any).from("user_organization_roles").delete().eq("organization_id", newOrg.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceSupabase as any).from("organizations").delete().eq("id", newOrg.id);
    return { ok: false, error: "Failed to create organization subscription", status: 500 };
  }

  return { ok: true, org: newOrg };
}
