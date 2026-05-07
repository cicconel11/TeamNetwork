/**
 * Stable request fingerprint for the enterprise checkout flow.
 *
 * Excludes mutable display fields (name, description) so that cosmetic
 * edits between retries don't trip the fingerprint conflict guard.
 * userId is included to prevent cross-user key reuse.
 */
export function buildEnterpriseCheckoutFingerprintPayload(params: {
  userId: string;
  slug: string;
  billingInterval: "month" | "year";
  alumniBucketQuantity: number;
  subOrgQuantity: number;
  billingContactEmail: string;
}): Record<string, unknown> {
  return {
    v: 1,
    flow: "enterprise_checkout",
    userId: params.userId,
    slug: params.slug,
    billingInterval: params.billingInterval,
    alumniBucketQuantity: params.alumniBucketQuantity,
    subOrgQuantity: params.subOrgQuantity,
    billingContactEmail: params.billingContactEmail.trim().toLowerCase(),
  };
}
