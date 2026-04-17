import {
  canonicalizeIndustry,
  canonicalizeRoleFamily,
  normalizeCareerText,
} from "@/lib/falkordb/career-signals";

export interface MenteeSignals {
  userId: string;
  orgId: string;
  focusAreas: string[]; // normalized
  preferredIndustries: string[]; // canonical
  preferredRoleFamilies: string[]; // canonical
  currentCity: string | null; // raw display
  currentCityNorm: string | null;
  graduationYear: number | null;
  currentCompany: string | null;
  currentCompanyNorm: string | null;
}

export interface MentorSignals {
  userId: string;
  orgId: string;
  topics: string[]; // normalized
  industry: string | null; // canonical
  roleFamily: string | null; // canonical
  currentCity: string | null;
  currentCityNorm: string | null;
  graduationYear: number | null;
  currentCompany: string | null;
  currentCompanyNorm: string | null;
  maxMentees: number;
  currentMenteeCount: number;
  acceptingNew: boolean;
  isActive: boolean;
}

export interface MenteeInput {
  userId: string;
  orgId: string;
  focusAreas?: string[] | null;
  preferredIndustries?: string[] | null;
  preferredRoleFamilies?: string[] | null;
  currentCity?: string | null;
  graduationYear?: number | null;
  currentCompany?: string | null;
}

export interface MentorInput {
  userId: string;
  orgId: string;
  topics?: string[] | null;
  expertiseAreas?: string[] | null;
  industry?: string | null;
  jobTitle?: string | null;
  positionTitle?: string | null;
  currentCompany?: string | null;
  currentCity?: string | null;
  graduationYear?: number | null;
  maxMentees?: number | null;
  currentMenteeCount?: number | null;
  acceptingNew?: boolean | null;
  isActive?: boolean | null;
}

function uniqueNormalizedList(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const n = normalizeCareerText(v);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function canonicalIndustryList(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const c = canonicalizeIndustry(v);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

function canonicalRoleFamilyList(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const c = canonicalizeRoleFamily(v);
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export function extractMenteeSignals(input: MenteeInput): MenteeSignals {
  return {
    userId: input.userId,
    orgId: input.orgId,
    focusAreas: uniqueNormalizedList(input.focusAreas),
    preferredIndustries: canonicalIndustryList(input.preferredIndustries),
    preferredRoleFamilies: canonicalRoleFamilyList(input.preferredRoleFamilies),
    currentCity: input.currentCity?.trim() || null,
    currentCityNorm: normalizeCareerText(input.currentCity),
    graduationYear: input.graduationYear ?? null,
    currentCompany: input.currentCompany?.trim() || null,
    currentCompanyNorm: normalizeCareerText(input.currentCompany),
  };
}

export function extractMentorSignals(input: MentorInput): MentorSignals {
  const topicSource = [
    ...(input.topics ?? []),
    ...(input.expertiseAreas ?? []),
  ];
  const industry = canonicalizeIndustry(input.industry);
  const roleFamily = canonicalizeRoleFamily(
    input.jobTitle ?? input.positionTitle ?? null,
    input.currentCompany ?? null,
    industry
  );

  return {
    userId: input.userId,
    orgId: input.orgId,
    topics: uniqueNormalizedList(topicSource),
    industry,
    roleFamily,
    currentCity: input.currentCity?.trim() || null,
    currentCityNorm: normalizeCareerText(input.currentCity),
    graduationYear: input.graduationYear ?? null,
    currentCompany: input.currentCompany?.trim() || null,
    currentCompanyNorm: normalizeCareerText(input.currentCompany),
    maxMentees: input.maxMentees ?? 3,
    currentMenteeCount: input.currentMenteeCount ?? 0,
    acceptingNew: input.acceptingNew ?? true,
    isActive: input.isActive ?? true,
  };
}

export function intersectNormalized(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const set = new Set(b);
  const out: string[] = [];
  for (const v of a) if (set.has(v)) out.push(v);
  return out;
}

interface MenteeIntakeRow {
  user_id: string | null;
  organization_id: string | null;
  data: Record<string, unknown> | null;
}

interface AlumniRow {
  current_city: string | null;
  current_company: string | null;
  graduation_year: number | null;
}

type LoadMenteeIntakeSupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Read the latest mentee_intake submission for a user and compose a MenteeInput
 * enriched with alumni profile facts (city, company, graduation year).
 *
 * Deterministic — latest submission wins via `mentee_latest_intake` view.
 * If no intake row, returns {userId, orgId} only so callers can still rank.
 */
export async function loadMenteeIntakeInput(
  supabase: LoadMenteeIntakeSupabase,
  menteeUserId: string,
  orgId: string
): Promise<MenteeInput> {
  const [{ data: intakeData }, { data: alumniData }] = await Promise.all([
    supabase
      .from("mentee_latest_intake")
      .select("user_id, organization_id, data")
      .eq("user_id", menteeUserId)
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("alumni")
      .select("current_city, current_company, graduation_year")
      .eq("user_id", menteeUserId)
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);

  const intake = (intakeData as MenteeIntakeRow | null) ?? null;
  const alumni = (alumniData as AlumniRow | null) ?? null;

  const data = intake?.data ?? {};

  return {
    userId: menteeUserId,
    orgId,
    focusAreas: stringArray((data as Record<string, unknown>).preferred_topics),
    preferredIndustries: stringArray((data as Record<string, unknown>).preferred_industry),
    preferredRoleFamilies: stringArray(
      (data as Record<string, unknown>).preferred_role_families
    ),
    currentCity: alumni?.current_city ?? null,
    graduationYear: alumni?.graduation_year ?? null,
    currentCompany: alumni?.current_company ?? null,
  };
}
