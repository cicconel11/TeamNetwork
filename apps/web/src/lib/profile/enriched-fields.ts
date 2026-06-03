import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Flat + rich enrichment fields used to render a person's profile anywhere in
 * the app (mentorship directory cards, mentor/mentee matching inputs). These
 * mirror the columns populated by the LinkedIn enrichment writeback
 * (`sync_user_linkedin_enrichment` / `enrich_alumni_by_id`).
 *
 * `job_title` / `position_title` exist only on `alumni` and `parents` (not on
 * `members`), so they are `null` when a person's primary row is a member.
 */
export interface EnrichedProfileFields {
  current_company: string | null;
  industry: string | null;
  current_city: string | null;
  graduation_year: number | null;
  photo_url: string | null;
  job_title: string | null;
  position_title: string | null;
  work_history: unknown;
  education_history: unknown;
  skills: unknown;
}

type EnrichedRow = Partial<EnrichedProfileFields> & { user_id?: string | null };

/**
 * Resolve each user's enrichment fields from the row that backs *their own*
 * profile, keyed by `user_id` within one organization.
 *
 * A `user_id` maps to a single person per org (modeled by
 * `user_organization_roles`), and that person's enrichment lives on exactly one
 * of `members` / `alumni` / `parents`. We therefore pick a SINGLE primary row
 * per user_id in that priority order and return only that row's fields — we
 * never fall back field-by-field across tables.
 *
 * This is deliberate: members own profile (active members) takes precedence and
 * matches what the member profile page shows. Crucially, single-row selection
 * is collision-resistant — if a stray `alumni` row were ever stamped with a
 * member's `user_id` (a data-integrity bug we also guard against in the DB), a
 * sparse member row can never "fall through" and surface that other person's
 * company/industry on the member's card.
 *
 * Members are preferred over alumni/parents; alumni over parents.
 */
export async function resolveEnrichedProfiles(
  supabase: SupabaseClient<Database>,
  orgId: string,
  userIds: string[]
): Promise<Map<string, EnrichedProfileFields>> {
  const uniqueIds = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (uniqueIds.length === 0) return new Map();

  // Structural client cast: `members`/`parents` enriched columns may lag the
  // generated DB types, and we only need the loose select/eq/in/is chain.
  const sb = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          is: (col: string, val: null) => {
            in: (col: string, vals: string[]) => Promise<{ data: EnrichedRow[] | null }>;
          };
          in: (col: string, vals: string[]) => Promise<{ data: EnrichedRow[] | null }>;
        };
      };
    };
  };

  const [membersRes, alumniRes, parentsRes] = await Promise.all([
    sb
      .from("members")
      .select(
        "user_id, photo_url, graduation_year, current_company, current_city, industry, work_history, education_history, skills"
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .in("user_id", uniqueIds),
    sb
      .from("alumni")
      .select(
        "user_id, photo_url, graduation_year, current_company, current_city, industry, job_title, position_title, work_history, education_history, skills"
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .in("user_id", uniqueIds),
    sb
      .from("parents")
      .select(
        "user_id, photo_url, current_company, current_city, industry, job_title, position_title, work_history, education_history, skills"
      )
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .in("user_id", uniqueIds),
  ]);

  const indexByUser = (rows: EnrichedRow[] | null): Map<string, EnrichedRow> => {
    const map = new Map<string, EnrichedRow>();
    for (const row of rows ?? []) {
      if (row.user_id) map.set(row.user_id, row);
    }
    return map;
  };

  const membersByUser = indexByUser(membersRes.data);
  const alumniByUser = indexByUser(alumniRes.data);
  const parentsByUser = indexByUser(parentsRes.data);

  const resolved = new Map<string, EnrichedProfileFields>();
  for (const userId of uniqueIds) {
    const row =
      membersByUser.get(userId) ??
      alumniByUser.get(userId) ??
      parentsByUser.get(userId) ??
      null;
    resolved.set(userId, toFields(row));
  }
  return resolved;
}

function toFields(row: EnrichedRow | null): EnrichedProfileFields {
  return {
    current_company: (row?.current_company as string | null) ?? null,
    industry: (row?.industry as string | null) ?? null,
    current_city: (row?.current_city as string | null) ?? null,
    graduation_year: (row?.graduation_year as number | null) ?? null,
    photo_url: (row?.photo_url as string | null) ?? null,
    job_title: (row?.job_title as string | null) ?? null,
    position_title: (row?.position_title as string | null) ?? null,
    work_history: row?.work_history ?? null,
    education_history: row?.education_history ?? null,
    skills: row?.skills ?? null,
  };
}
