import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { EnterpriseContext, EnterpriseRole, Enterprise, EnterpriseSubscription } from "@/types/enterprise";

// Type aliases for queries (until types regenerated)
type EnterpriseRow = Enterprise;
interface EnterpriseRoleRow { role: string }
type SubscriptionRow = EnterpriseSubscription;
interface AlumniCountsRow { total_alumni_count: number; sub_org_count: number; enterprise_managed_org_count: number }

export const getEnterpriseContext = cache(async function getEnterpriseContext(enterpriseSlug: string): Promise<EnterpriseContext | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Get enterprise by slug
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enterprise } = await (supabase as any)
    .from("enterprises")
    .select("*")
    .eq("slug", enterpriseSlug)
    .single() as { data: EnterpriseRow | null };

  if (!enterprise) return null;

  // Run role, subscription, and alumni count queries in parallel
  // (all only depend on enterprise.id, not each other)
  const serviceSupabase = createServiceClient();

  const [
    { data: roleData },
    { data: subscription },
    { data: counts },
  ] = await Promise.all([
    // Get user's role
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("user_enterprise_roles")
      .select("role")
      .eq("enterprise_id", enterprise.id)
      .eq("user_id", user.id)
      .single() as Promise<{ data: EnterpriseRoleRow | null }>,
    // Get subscription (using service client for sensitive data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("enterprise_subscriptions")
      .select("*")
      .eq("enterprise_id", enterprise.id)
      .single() as Promise<{ data: SubscriptionRow | null }>,
    // Get alumni counts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("enterprise_alumni_counts")
      .select("total_alumni_count, sub_org_count, enterprise_managed_org_count")
      .eq("enterprise_id", enterprise.id)
      .single() as Promise<{ data: AlumniCountsRow | null }>,
  ]);

  if (!roleData) return null;

  return {
    enterprise,
    subscription,
    role: roleData.role as EnterpriseRole,
    alumniCount: counts?.total_alumni_count ?? 0,
    subOrgCount: counts?.sub_org_count ?? 0,
    enterpriseManagedOrgCount: counts?.enterprise_managed_org_count ?? 0,
  };
});

export async function getEnterpriseById(enterpriseId: string): Promise<Enterprise | null> {
  const serviceSupabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enterprise } = await (serviceSupabase as any)
    .from("enterprises")
    .select("*")
    .eq("id", enterpriseId)
    .single() as { data: EnterpriseRow | null };

  return enterprise;
}

export interface UserEnterpriseItem {
  role: EnterpriseRole;
  enterprise: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    primary_color: string | null;
    billing_contact_email: string | null;
    created_at: string;
    updated_at: string;
  } | null;
}

export async function getUserEnterprises(userId: string): Promise<UserEnterpriseItem[]> {
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("user_enterprise_roles")
    .select(`
      role,
      enterprise:enterprises(*)
    `)
    .eq("user_id", userId);

  return (data as UserEnterpriseItem[] | null) ?? [];
}
