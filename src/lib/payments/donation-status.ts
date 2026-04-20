export const SETTLED_DONATION_STATUSES = ["succeeded", "recorded"] as const;
export type SettledDonationStatus = (typeof SETTLED_DONATION_STATUSES)[number];

export function isSettledDonationStatus(
  status: string | null | undefined
): status is SettledDonationStatus {
  return (
    status != null &&
    (SETTLED_DONATION_STATUSES as readonly string[]).includes(status)
  );
}
