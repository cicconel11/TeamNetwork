export function buildDynamicQuoteCheckoutFingerprintPayload(params: {
  userId: string;
  tier: "single" | "enterprise";
  billingInterval: "month" | "year";
  actives: number;
  alumni: number;
  subOrgs: number;
  monthlyCents: number;
  yearlyCents: number;
}): Record<string, unknown> {
  return {
    v: 1,
    flow: "dynamic_quote_checkout",
    userId: params.userId,
    tier: params.tier,
    billingInterval: params.billingInterval,
    actives: params.actives,
    alumni: params.alumni,
    subOrgs: params.subOrgs,
    monthlyCents: params.monthlyCents,
    yearlyCents: params.yearlyCents,
  };
}
