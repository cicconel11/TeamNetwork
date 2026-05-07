import type {
  BlackbaudConstituent,
  BlackbaudEmail,
  BlackbaudPhone,
  BlackbaudAddress,
  NormalizedConstituent,
} from "./types";

function findPrimary<T extends { primary?: boolean; inactive?: boolean; do_not_email?: boolean }>(items: T[]): T | undefined {
  const active = items.filter((item) => !item.inactive && !item.do_not_email);
  return active.find((item) => item.primary) ?? active[0];
}

function formatAddress(address: BlackbaudAddress): string | null {
  const cityState = [address.city, address.state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, address.postal_code].filter(Boolean).join(" ");
  const parts = [address.address_lines, cityStateZip].filter(Boolean).join(", ");

  return parts || null;
}

function parseClassYear(classOf: string | undefined): number | null {
  if (!classOf) return null;
  const year = parseInt(classOf, 10);
  if (isNaN(year) || year < 1900 || year > 2100) return null;
  return year;
}

export function normalizeConstituent(
  constituent: BlackbaudConstituent,
  emails: BlackbaudEmail[],
  phones: BlackbaudPhone[],
  addresses: BlackbaudAddress[]
): NormalizedConstituent {
  const primaryEmail = findPrimary(emails);
  const primaryPhone = findPrimary(phones);
  const primaryAddress = findPrimary(addresses);

  return {
    external_id: constituent.id,
    first_name: constituent.first ?? "",
    last_name: constituent.last ?? "",
    email: primaryEmail?.address ?? null,
    phone_number: primaryPhone?.number ?? null,
    address_summary: primaryAddress ? formatAddress(primaryAddress) : null,
    graduation_year: parseClassYear(constituent.class_of),
    source: "integration_sync",
  };
}
