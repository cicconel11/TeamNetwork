import type { AlumniBucket } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import { ALUMNI_BUCKET_PRICING } from "@/types/enterprise";

export const ALUMNI_LIMITS: Record<AlumniBucket, number | null> = {
  none: 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

export function getAlumniLimit(bucket: AlumniBucket | null | undefined) {
  if (!bucket || !(bucket in ALUMNI_LIMITS)) return 0;
  return ALUMNI_LIMITS[bucket];
}

export function normalizeBucket(bucket: string | null | undefined): AlumniBucket {
  const allowed: AlumniBucket[] = ["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"];
  return allowed.includes(bucket as AlumniBucket) ? (bucket as AlumniBucket) : "none";
}

// Type for org with enterprise_id (until types are regenerated)
interface OrgWithEnterprise {
  enterprise_id: string | null;
}

interface OrgSubscriptionRow {
  alumni_bucket: string | null;
  status: string | null;
}

// Type for enterprise subscription (until types are regenerated)
interface EnterpriseSubscriptionRow {
  alumni_bucket_quantity: number;
}

export function shouldUseEnterpriseAlumniQuota(
  enterpriseId: string | null | undefined,
  subscriptionStatus: string | null | undefined,
) {
  return Boolean(enterpriseId && subscriptionStatus === "enterprise_managed");
}

/**
 * Checks if an organization belongs to an enterprise.
 * @param orgId - The organization ID to check
 * @returns true if the org has an enterprise_id, false otherwise
 */
export async function isOrgEnterpriseManaged(orgId: string): Promise<boolean> {
  const supabase = createServiceClient();

  const [{ data: org }, { data: orgSub }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("organizations")
      .select("enterprise_id")
      .eq("id", orgId)
      .single() as Promise<{ data: OrgWithEnterprise | null }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("organization_subscriptions")
      .select("status")
      .eq("organization_id", orgId)
      .maybeSingle() as Promise<{ data: Pick<OrgSubscriptionRow, "status"> | null }>,
  ]);

  return shouldUseEnterpriseAlumniQuota(
    org?.enterprise_id ?? null,
    orgSub?.status ?? null,
  );
}

/**
 * Gets the alumni limit for an organization, accounting for enterprise pooling.
 * If the org belongs to an enterprise, returns the enterprise's pooled limit.
 * Otherwise, returns the org's individual subscription limit.
 * @param orgId - The organization ID
 * @returns The alumni limit (null means unlimited), or 0 if no subscription found
 */
export async function getAlumniLimitForOrg(orgId: string): Promise<number | null> {
  const supabase = createServiceClient();

  const [{ data: org }, { data: orgSub }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("organizations")
      .select("enterprise_id")
      .eq("id", orgId)
      .single() as Promise<{ data: OrgWithEnterprise | null }>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("organization_subscriptions")
      .select("alumni_bucket, status")
      .eq("organization_id", orgId)
      .maybeSingle() as Promise<{ data: OrgSubscriptionRow | null }>,
  ]);

  if (!org) {
    return 0;
  }

  // If org is enterprise-managed, use enterprise pooled limit.
  if (shouldUseEnterpriseAlumniQuota(org.enterprise_id, orgSub?.status ?? null)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: subscription } = await (supabase as any)
      .from("enterprise_subscriptions")
      .select("alumni_bucket_quantity")
      .eq("enterprise_id", org.enterprise_id)
      .single() as { data: EnterpriseSubscriptionRow | null };

    if (!subscription) {
      return 0;
    }

    // Each bucket covers 2,500 alumni
    return subscription.alumni_bucket_quantity * ALUMNI_BUCKET_PRICING.capacityPerBucket;
  }

  // Otherwise, use org's individual subscription
  if (!orgSub) {
    return 0;
  }

  return getAlumniLimit(normalizeBucket(orgSub.alumni_bucket));
}
