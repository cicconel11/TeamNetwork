export function buildEnterpriseV2CheckoutFingerprintPayload(params: {
  userId: string;
  slug: string;
  billingInterval: "month" | "year";
  actives: number;
  alumni: number;
  subOrgs: number;
  monthlyCents: number;
  yearlyCents: number;
  billingContactEmail: string;
}): Record<string, unknown> {
  return {
    v: 1,
    flow: "enterprise_v2_checkout",
    userId: params.userId,
    slug: params.slug,
    billingInterval: params.billingInterval,
    actives: params.actives,
    alumni: params.alumni,
    subOrgs: params.subOrgs,
    monthlyCents: params.monthlyCents,
    yearlyCents: params.yearlyCents,
    billingContactEmail: params.billingContactEmail,
  };
}
