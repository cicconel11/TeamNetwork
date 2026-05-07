/**
 * Single source of truth for the "headline" string rendered on
 * Members + Alumni directory cards and detail-page heroes.
 *
 * Precedence (deterministic): headline > role > position_title > job_title.
 * When a non-empty primary value is found AND current_company is non-empty,
 * append ` at ${current_company}`.
 *
 * Returns null when no primary value is present.
 *
 * Members callers pass `{ role, current_company }` (members table has none of
 * headline / position_title / job_title). Alumni callers pass
 * `{ headline, position_title, job_title, current_company }` (alumni table
 * has no `role`). The helper accepts the union shape so a single call site
 * works for both.
 */
export interface FormatPersonHeadlineInput {
  headline?: string | null;
  role?: string | null;
  position_title?: string | null;
  job_title?: string | null;
  current_company?: string | null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

export function formatPersonHeadline(input: FormatPersonHeadlineInput): string | null {
  const primary = firstNonEmpty(
    input.headline,
    input.role,
    input.position_title,
    input.job_title,
  );
  if (primary === null) return null;

  const company = input.current_company;
  if (typeof company === "string" && company.trim().length > 0) {
    return `${primary} at ${company}`;
  }
  return primary;
}
