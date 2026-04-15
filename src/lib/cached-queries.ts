import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Typed wrapper around unstable_cache that preserves return types.
 * Uses the service client internally since cached functions may execute
 * outside a request context during background revalidation.
 *
 * IMPORTANT — Multi-tenant safety:
 * Always include the tenant identifier (orgId) in both keyParts and tags
 * to prevent cross-tenant cache contamination.
 */
function typedCache<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  keyParts: string[],
  options?: { revalidate?: number; tags?: string[] }
): (...args: TArgs) => Promise<TReturn> {
  return unstable_cache(fn, keyParts, options) as (...args: TArgs) => Promise<TReturn>;
}

/**
 * Cached nav config for an organization. Revalidate on nav config write.
 * Tag: `nav-config-${orgId}`
 */
export function getCachedNavConfig(orgId: string) {
  return typedCache(
    async (id: string) => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("organizations")
        .select("nav_config")
        .eq("id", id)
        .single();
      if (error) throw new Error(`Nav config query failed: ${error.message}`);
      return data?.nav_config ?? null;
    },
    ["nav-config", orgId],
    { revalidate: 300, tags: [`nav-config-${orgId}`] }
  )(orgId);
}

/**
 * Cached organization settings. Revalidate on settings write.
 * Tag: `org-settings-${orgId}`
 */
export function getCachedOrgSettings(orgId: string) {
  return typedCache(
    async (id: string) => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, primary_color, secondary_color, logo_url, org_type, nav_config, stripe_connect_account_id")
        .eq("id", id)
        .single();
      if (error) throw new Error(`Org settings query failed: ${error.message}`);
      return data;
    },
    ["org-settings", orgId],
    { revalidate: 300, tags: [`org-settings-${orgId}`] }
  )(orgId);
}

/**
 * Cached donation stats for an organization. Revalidate on donation webhook.
 * Tag: `donation-stats-${orgId}`
 */
export function getCachedDonationStats(orgId: string) {
  return typedCache(
    async (id: string) => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("organization_donation_stats")
        .select("total_amount_cents, donation_count, last_donation_at")
        .eq("organization_id", id)
        .maybeSingle();
      if (error) throw new Error(`Donation stats query failed: ${error.message}`);
      return data;
    },
    ["donation-stats", orgId],
    { revalidate: 300, tags: [`donation-stats-${orgId}`] }
  )(orgId);
}

interface EnterpriseAlumniStatsRpc {
  total_count: number;
  org_stats: Array<{ name: string; slug: string; count: number }>;
  top_industries: Array<{ name: string; count: number }>;
  filter_options: {
    years: number[];
    birthYears: number[];
    industries: string[];
    companies: string[];
    cities: string[];
    positions: string[];
  };
}

/**
 * Cached enterprise alumni stats via RPC. Revalidate on alumni data changes.
 * Tag: `enterprise-alumni-stats-${enterpriseId}`
 */
export function getCachedEnterpriseAlumniStats(enterpriseId: string) {
  return typedCache(
    async (id: string) => {
      const supabase = createServiceClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc(
        "get_enterprise_alumni_stats",
        { p_enterprise_id: id }
      ) as { data: EnterpriseAlumniStatsRpc | null; error: unknown };
      if (error) throw new Error(`Enterprise alumni stats RPC failed`);
      return data;
    },
    ["enterprise-alumni-stats", enterpriseId],
    { revalidate: 300, tags: [`enterprise-alumni-stats-${enterpriseId}`] }
  )(enterpriseId);
}
