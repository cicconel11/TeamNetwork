import type { AlumniBucket, SubscriptionInterval } from "@/types/database";

export const ORG_TRIAL_DAYS = 30;

type TrialSelectionParams = {
  billingInterval: SubscriptionInterval;
  alumniBucket: AlumniBucket;
};

type TrialRequestParams = TrialSelectionParams & {
  withTrial: boolean;
};

type TrialMetadata = Record<string, string | null | undefined> | null | undefined;

export function isOrgFreeTrialSelectable({
  billingInterval,
  alumniBucket,
}: TrialSelectionParams) {
  return billingInterval === "month" && alumniBucket !== "5000+";
}

export function getOrgFreeTrialRequestError({
  withTrial,
  billingInterval,
  alumniBucket,
}: TrialRequestParams) {
  if (!withTrial) return null;
  if (billingInterval !== "month") {
    return "Free trial is only available on monthly plans.";
  }
  if (alumniBucket === "5000+") {
    return "Free trial is not available for custom alumni pricing.";
  }
  return null;
}

export function buildOrgCheckoutFingerprintPayload(params: {
  userId: string;
  name: string;
  slug: string;
  interval: SubscriptionInterval;
  bucket: AlumniBucket;
  primaryColor?: string | null;
  withTrial: boolean;
}) {
  return {
    userId: params.userId,
    name: params.name,
    slug: params.slug,
    interval: params.interval,
    bucket: params.bucket,
    primaryColor: params.primaryColor ?? null,
    withTrial: params.withTrial,
  };
}

export function getOrgTrialMetadataValue(withTrial: boolean) {
  return withTrial ? "true" : "false";
}

export function isOrgTrialMetadata(metadata: TrialMetadata) {
  return metadata?.is_trial === "true";
}

export function shouldProvisionOrgCheckoutOnCompletion(
  paymentStatus: string | null | undefined,
  metadata: TrialMetadata,
) {
  return paymentStatus === "paid" || (paymentStatus === "no_payment_required" && isOrgTrialMetadata(metadata));
}
