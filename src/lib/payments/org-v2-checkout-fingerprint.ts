export function buildOrgV2CheckoutFingerprintPayload(params: {
  userId: string;
  slug: string;
  billingInterval: "month" | "year";
  actives: number;
  alumni: number;
  monthlyCents: number;
  yearlyCents: number;
  primaryColor: string;
}): Record<string, unknown> {
  return {
    v: 1,
    flow: "org_v2_checkout",
    userId: params.userId,
    slug: params.slug,
    billingInterval: params.billingInterval,
    actives: params.actives,
    alumni: params.alumni,
    monthlyCents: params.monthlyCents,
    yearlyCents: params.yearlyCents,
    primaryColor: params.primaryColor,
  };
}
