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
  emails: BlackbaudEmail[] | undefined,
  phones: BlackbaudPhone[] | undefined,
  addresses: BlackbaudAddress[] | undefined
): NormalizedConstituent {
  // undefined sub-resource = fetch failed; propagate as undefined so storage
  // preserves the existing DB column. Empty array still maps to null.
  const primaryEmail = emails === undefined ? undefined : findPrimary(emails, (e) => e.do_not_email === true);
  const primaryPhone = phones === undefined ? undefined : findPrimary(phones, (p) => p.do_not_call === true);
  const primaryAddress = addresses === undefined ? undefined : findPrimary(addresses);

  const emailField: string | null | undefined =
    emails === undefined ? undefined : (primaryEmail?.address?.trim().toLowerCase() || null);
  const phoneField: string | null | undefined =
    phones === undefined ? undefined : (primaryPhone?.number ?? null);
  const addressField: string | null | undefined =
    addresses === undefined ? undefined : (primaryAddress ? formatAddress(primaryAddress) : null);

  return {
    external_id: constituent.id,
    first_name: constituent.first ?? "",
    last_name: constituent.last ?? "",
    email: emailField,
    phone_number: phoneField,
    address_summary: addressField,
    graduation_year: parseClassYear(constituent.class_of),
    source: "integration_sync",
  };
}
