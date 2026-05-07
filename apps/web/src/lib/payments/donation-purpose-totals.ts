import type { OrganizationDonation } from "@/types/database";

type DonationPurposeRow = Pick<OrganizationDonation, "purpose" | "amount_cents">;

export function buildDonationPurposeTotals(
  donationRows: DonationPurposeRow[],
  fallbackLabel: string,
) {
  return donationRows.reduce<Record<string, number>>((acc, donation) => {
    const label = donation.purpose || fallbackLabel;
    acc[label] = (acc[label] || 0) + (donation.amount_cents || 0);
    return acc;
  }, {});
}
