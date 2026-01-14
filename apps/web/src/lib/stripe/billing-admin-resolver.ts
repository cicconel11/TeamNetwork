import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrgAdminEmails } from "@/lib/graduation/queries";

export interface BillingAdminInfo {
  entityType: "enterprise" | "org";
  entityName: string;
  adminEmails: string[];
}

export async function resolveAdminsForSubscription(
  supabase: SupabaseClient<Database>,
  subscriptionId: string
): Promise<BillingAdminInfo | null> {
  // Check enterprise subscriptions first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entSub } = await (supabase as any)
    .from("enterprise_subscriptions")
    .select("enterprise_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (entSub?.enterprise_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: enterprise }, { data: roles }] = await Promise.all([
      (supabase as any)
        .from("enterprises")
        .select("name")
        .eq("id", entSub.enterprise_id)
        .maybeSingle() as Promise<{ data: { name: string } | null }>,
      (supabase as any)
        .from("user_enterprise_roles")
        .select("user_id")
        .eq("enterprise_id", entSub.enterprise_id)
        .in("role", ["owner", "billing_admin"]) as Promise<{ data: { user_id: string }[] | null }>,
    ]);

    if (!enterprise?.name || !roles?.length) return null;

    const userIds = roles.map((r: { user_id: string }) => r.user_id);
    const { data: users } = await supabase
      .from("users")
      .select("email")
      .in("id", userIds);

    const adminEmails = (users || [])
      .map((u) => u.email)
      .filter((e): e is string => !!e);

    if (adminEmails.length === 0) return null;

    return {
      entityType: "enterprise",
      entityName: enterprise.name,
      adminEmails,
    };
  }

  // Fall back to organization subscriptions
  const { data: orgSub } = await supabase
    .from("organization_subscriptions")
    .select("organization_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (!orgSub?.organization_id) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgSub.organization_id)
    .maybeSingle();

  if (!org?.name) return null;

  const adminEmails = await getOrgAdminEmails(supabase, orgSub.organization_id);
  if (adminEmails.length === 0) return null;

  return {
    entityType: "org",
    entityName: org.name,
    adminEmails,
  };
}
