import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { EnterpriseContext, EnterpriseRole, Enterprise, EnterpriseSubscription } from "@/types/enterprise";

// Type aliases for queries (until types regenerated)
interface EnterpriseRow extends Enterprise {}
interface EnterpriseRoleRow { role: string }
interface SubscriptionRow extends EnterpriseSubscription {}
interface AlumniCountsRow { total_alumni_count: number; sub_org_count: number }

export async function getEnterpriseContext(enterpriseSlug: string): Promise<EnterpriseContext | null> {
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

  // Get user's role
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roleData } = await (supabase as any)
    .from("user_enterprise_roles")
    .select("role")
    .eq("enterprise_id", enterprise.id)
    .eq("user_id", user.id)
    .single() as { data: EnterpriseRoleRow | null };

  if (!roleData) return null;

  // Get subscription (using service client for sensitive data)
  const serviceSupabase = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscription } = await (serviceSupabase as any)
    .from("enterprise_subscriptions")
    .select("*")
    .eq("enterprise_id", enterprise.id)
    .single() as { data: SubscriptionRow | null };

  // Get alumni counts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: counts } = await (serviceSupabase as any)
    .from("enterprise_alumni_counts")
    .select("total_alumni_count, sub_org_count")
    .eq("enterprise_id", enterprise.id)
    .single() as { data: AlumniCountsRow | null };

  // Get count of enterprise-managed organizations
  const { count: enterpriseManagedCount } = await serviceSupabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .eq("enterprise_id", enterprise.id)
    .eq("enterprise_relationship_type", "created")
    .is("deleted_at", null);

  return {
    enterprise,
    subscription,
    role: roleData.role as EnterpriseRole,
    alumniCount: counts?.total_alumni_count ?? 0,
    subOrgCount: counts?.sub_org_count ?? 0,
    enterpriseManagedOrgCount: enterpriseManagedCount ?? 0,
  };
}

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
