// Per-tool grounding-data type contracts and reason-code extractors used by
// the per-tool coverage checks.

import { extractReasonCodesFromLine } from "@/lib/mentorship/presentation";

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

export interface SuggestMenteesGroundingData {
  state?: unknown;
  mentor?: { name?: unknown } | null;
  suggestions?: Array<{
    mentee?: { name?: unknown } | null;
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
    status_counts?: {
      succeeded?: unknown;
      pending?: unknown;
      failed?: unknown;
    } | null;
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

/**
 * Reason codes a single mentorship "why" line claims. Delegates to the single
 * label⇄code source of truth in presentation.ts (covers ALL engine codes, with
 * `past_employer_overlap` winning over `shared_company`) so the verifier never
 * flags a correct deterministic reason as unsupported. Shared by suggest_mentors
 * and suggest_mentees grounding.
 */
export function extractMentorReasonCodes(line: string): string[] {
  return extractReasonCodesFromLine(line);
}
