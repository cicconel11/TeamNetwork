/**
 * Member profile enrichment resolution.
 *
 * Member experience/education/bio can come from two independent sources:
 *
 *  1. `user_linkedin_connections.linkedin_data.enrichment` — written only when
 *     the member personally OAuth-connects their own LinkedIn account.
 *  2. The `members` table columns (`work_history`, `education_history`,
 *     `summary`, `headline`) — written by the Apify admin enrichment pipeline
 *     (`sync_user_linkedin_enrichment`), independent of any self-connection.
 *
 * The detail page historically read only source #1, so members enriched solely
 * by the admin pipeline (no self-connection) rendered a degenerate single-job,
 * logo-less fallback even though their column data was fully populated. These
 * helpers coalesce blob → column with the same blob-first precedence already
 * used for skills/certs/languages (`enrichment?.skills ?? m.skills`). The two
 * sources share an identical JSON shape, so callers render them interchangeably.
 */

export interface EnrichmentExperience {
  title?: string | null;
  company?: string | null;
  company_id?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  description_html?: string | null;
  company_logo_url?: string | null;
}

export interface EnrichmentEducation {
  title?: string | null; // school name
  degree?: string | null;
  field_of_study?: string | null;
  start_year?: string | null;
  end_year?: string | null;
  description?: string | null;
  institute_logo_url?: string | null;
}

export interface MemberEnrichmentBlob {
  about?: string | null;
  summary?: string | null;
  experience?: unknown;
  education?: unknown;
}

export interface MemberEnrichmentColumns {
  work_history?: unknown;
  education_history?: unknown;
  summary?: string | null;
  headline?: string | null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Resolve a member's work experience, preferring the self-connection blob and
 * falling back to the `members.work_history` column.
 */
export function resolveMemberExperience(
  enrichment: MemberEnrichmentBlob | null | undefined,
  member: MemberEnrichmentColumns,
): EnrichmentExperience[] {
  const fromBlob = asArray<EnrichmentExperience>(enrichment?.experience);
  if (fromBlob.length > 0) return fromBlob;
  return asArray<EnrichmentExperience>(member.work_history);
}

/**
 * Resolve a member's education, preferring the self-connection blob and falling
 * back to the `members.education_history` column.
 */
export function resolveMemberEducation(
  enrichment: MemberEnrichmentBlob | null | undefined,
  member: MemberEnrichmentColumns,
): EnrichmentEducation[] {
  const fromBlob = asArray<EnrichmentEducation>(enrichment?.education);
  if (fromBlob.length > 0) return fromBlob;
  return asArray<EnrichmentEducation>(member.education_history);
}

/**
 * Resolve a member's LinkedIn bio/about text, preferring the self-connection
 * blob and falling back to the enriched `members.summary` / `headline` columns.
 */
export function resolveMemberBio(
  enrichment: MemberEnrichmentBlob | null | undefined,
  member: MemberEnrichmentColumns,
): string | null {
  return (
    enrichment?.about ||
    enrichment?.summary ||
    member.summary ||
    member.headline ||
    null
  );
}
