import type {
  BlackbaudConstituent,
  BlackbaudEmail,
  BlackbaudPhone,
  BlackbaudAddress,
  NormalizedConstituent,
} from "./types";

function findPrimary<T extends { primary?: boolean; inactive?: boolean }>(
  items: T[],
  isExcluded?: (item: T) => boolean,
): T | undefined {
  const active = items.filter((item) => !item.inactive && !(isExcluded?.(item) ?? false));
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
  const primaryEmail = findPrimary(emails, (e) => e.do_not_email === true);
  const primaryPhone = findPrimary(phones, (p) => p.do_not_call === true);
  const primaryAddress = findPrimary(addresses);

  return {
    external_id: constituent.id,
    first_name: constituent.first ?? "",
    last_name: constituent.last ?? "",
    email: primaryEmail?.address?.trim().toLowerCase() || null,
    phone_number: primaryPhone?.number ?? null,
    address_summary: primaryAddress ? formatAddress(primaryAddress) : null,
    graduation_year: parseClassYear(constituent.class_of),
    source: "integration_sync",
  };
}
