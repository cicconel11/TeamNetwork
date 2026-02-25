import type { ParentsBucket } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";

export const PARENTS_LIMITS: Record<ParentsBucket, number | null> = {
  none: 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

export function getParentsLimit(bucket: ParentsBucket | null | undefined) {
  if (!bucket || !(bucket in PARENTS_LIMITS)) return 0;
  return PARENTS_LIMITS[bucket];
}

export function normalizeParentsBucket(bucket: string | null | undefined): ParentsBucket {
  const allowed: ParentsBucket[] = ["none", "0-250", "251-500", "501-1000", "1001-2500", "2500-5000", "5000+"];
  return allowed.includes(bucket as ParentsBucket) ? (bucket as ParentsBucket) : "none";
}

/**
 * Gets the parents limit for an organization from its individual subscription.
 * @param orgId - The organization ID
 * @returns The parents limit (null means unlimited), or 0 if no subscription found
 */
export async function getParentsLimitForOrg(orgId: string): Promise<number | null> {
  const supabase = createServiceClient();

  const { data: orgSub } = await supabase
    .from("organization_subscriptions")
    .select("parents_bucket")
    .eq("organization_id", orgId)
    .maybeSingle() as { data: { parents_bucket: string | null } | null };

  if (!orgSub) {
    return 0;
  }

  return getParentsLimit(normalizeParentsBucket(orgSub.parents_bucket));
}
