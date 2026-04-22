export const SETTLED_DONATION_STATUSES = ["succeeded", "recorded"] as const;
export type SettledDonationStatus = (typeof SETTLED_DONATION_STATUSES)[number];
