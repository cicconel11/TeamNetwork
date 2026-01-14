type StripeSubscriptionPeriodLike = {
  current_period_end?: number | null;
  items?: {
    data?: Array<{
      current_period_end?: number | null;
    }>;
  } | null;
};

export function extractSubscriptionPeriodEndEpoch(subscription: StripeSubscriptionPeriodLike): number | null {
  const subLevelPeriodEnd =
    typeof subscription.current_period_end === "number" ? subscription.current_period_end : null;
  if (subLevelPeriodEnd !== null) {
    return subLevelPeriodEnd;
  }

  const itemLevelPeriodEnd =
    subscription.items?.data
      ?.map((item) => item.current_period_end)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b)[0] ?? null;

  return itemLevelPeriodEnd;
}

export function extractSubscriptionPeriodEndIso(subscription: StripeSubscriptionPeriodLike): string | null {
  const epoch = extractSubscriptionPeriodEndEpoch(subscription);
  return epoch === null ? null : new Date(epoch * 1000).toISOString();
}
