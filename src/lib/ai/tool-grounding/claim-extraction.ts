// Per-tool grounding-data type contracts and reason-code extractors used by
// the per-tool coverage checks.

export interface SuggestConnectionGroundingReason {
  code?: unknown;
  label?: unknown;
}

export interface SuggestConnectionGroundingRow {
  name?: unknown;
  reasons?: SuggestConnectionGroundingReason[];
}

export interface SuggestConnectionGroundingData {
  state?: unknown;
  source_person?: { name?: unknown } | null;
  suggestions?: unknown;
  disambiguation_options?: unknown;
}

export interface SuggestMentorsGroundingData {
  state?: unknown;
  mentee?: { name?: unknown } | null;
  suggestions?: Array<{
    mentor?: { name?: unknown } | null;
    reasons?: Array<{ code?: unknown; label?: unknown }>;
  }>;
}

export interface ListDonationsRow {
  donor_name?: unknown;
  donor_email?: unknown;
  amount_dollars?: unknown;
  purpose?: unknown;
}

export interface DonationAnalyticsVerifyPayload {
  totals?: {
    successful_donation_count?: unknown;
    successful_amount_cents?: unknown;
    average_successful_amount_cents?: unknown;
    largest_successful_amount_cents?: unknown;
  } | null;
  trend?: unknown;
  top_purposes?: unknown;
}

export interface StatRow {
  label: string;
  amount_cents: number;
  donation_count: number;
}

export function extractSuggestConnectionReasonCodes(line: string): string[] {
  const matches = new Set<string>();
  const normalized = line.toLowerCase();

  if (/(direct mentorship|second[- ]degree mentorship|second degree|two[- ]hop mentorship|two hop)/.test(normalized)) {
    matches.add("unsupported_mentorship");
  }
  if (/(shared company|same company)/.test(normalized)) {
    matches.add("shared_company");
  }
  if (/(shared industry|same industry)/.test(normalized)) {
    matches.add("shared_industry");
  }
  if (/(shared role family|same role family|similar role family)/.test(normalized)) {
    matches.add("shared_role_family");
  }
  if (/(graduation proximity|graduated within 3 years|within 3 years of graduating|similar graduation year)/.test(normalized)) {
    matches.add("graduation_proximity");
  }
  if (/(shared graduation year|same graduation year|class of)/.test(normalized)) {
    matches.add("graduation_proximity");
  }
  if (/(shared city|same city|both (?:live|based|located) in)/.test(normalized)) {
    matches.add("shared_city");
  }

  return [...matches];
}

export function extractMentorReasonCodes(line: string): string[] {
  const matches = new Set<string>();
  const normalized = line.toLowerCase();

  if (/(shared topics?)/.test(normalized)) matches.add("shared_topics");
  if (/(shared industry|same industry)/.test(normalized)) matches.add("shared_industry");
  if (/(shared role family|same role family|similar role)/.test(normalized)) matches.add("shared_role_family");
  if (/(graduation gap|years? ahead|graduation fit)/.test(normalized)) matches.add("graduation_gap_fit");
  if (/(shared city|same city|both (?:live|based) in)/.test(normalized)) matches.add("shared_city");
  if (/(shared company|same company)/.test(normalized)) matches.add("shared_company");

  return [...matches];
}
