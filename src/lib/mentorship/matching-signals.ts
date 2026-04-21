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
  preferredSports: string[]; // normalized athletic tags
  preferredPositions: string[]; // normalized athletic tags
  requiredMentorAttributes: string[]; // stored form keys
  currentCity: string | null; // raw display
  currentCityNorm: string | null;
  graduationYear: number | null;
  currentCompany: string | null;
  currentCompanyNorm: string | null;
  customAttributes: Record<string, string[]>; // always string[], normalized
}

export interface MentorSignals {
  userId: string;
  orgId: string;
  topics: string[]; // normalized
  industries: string[]; // canonical
  roleFamilies: string[]; // canonical
  industry: string | null; // canonical
  roleFamily: string | null; // canonical
  sports: string[];
  positions: string[];
  currentCity: string | null;
  currentCityNorm: string | null;
  graduationYear: number | null;
  currentCompany: string | null;
  currentCompanyNorm: string | null;
  maxMentees: number;
  currentMenteeCount: number;
  acceptingNew: boolean;
  isActive: boolean;
  customAttributes: Record<string, string[]>; // always string[], normalized
}

export interface MenteeInput {
  userId: string;
  orgId: string;
  focusAreas?: string[] | null;
  preferredIndustries?: string[] | null;
  preferredRoleFamilies?: string[] | null;
  preferredSports?: string[] | null;
  preferredPositions?: string[] | null;
  requiredMentorAttributes?: string[] | null;
  currentCity?: string | null;
  graduationYear?: number | null;
  currentCompany?: string | null;
  customAttributes?: Record<string, string | string[]> | null;
}

export interface MentorInput {
  userId: string;
  orgId: string;
  topics?: string[] | null;
  expertiseAreas?: string[] | null;
  /** Native canonical arrays from mentor_profiles (authoritative when present). */
  nativeSports?: string[] | null;
  nativePositions?: string[] | null;
  nativeIndustries?: string[] | null;
  nativeRoleFamilies?: string[] | null;
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
  customAttributes?: Record<string, string | string[]> | null;
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

function normalizedAttributeKeyList(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const normalized = raw
      ?.trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function normalizeCustomAttributes(
  raw: Record<string, string | string[]> | null | undefined
): Record<string, string[]> {
  if (!raw) return {};
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      const norm = normalizeCareerText(value);
      if (norm) result[key] = [norm];
    } else if (Array.isArray(value)) {
      result[key] = uniqueNormalizedList(value);
    }
  }
  return result;
}

export function extractMenteeSignals(input: MenteeInput): MenteeSignals {
  return {
    userId: input.userId,
    orgId: input.orgId,
    focusAreas: uniqueNormalizedList(input.focusAreas),
    preferredIndustries: canonicalIndustryList(input.preferredIndustries),
    preferredRoleFamilies: canonicalRoleFamilyList(input.preferredRoleFamilies),
    preferredSports: uniqueNormalizedList(input.preferredSports),
    preferredPositions: uniqueNormalizedList(input.preferredPositions),
    requiredMentorAttributes: normalizedAttributeKeyList(input.requiredMentorAttributes),
    currentCity: input.currentCity?.trim() || null,
    currentCityNorm: normalizeCareerText(input.currentCity),
    graduationYear: input.graduationYear ?? null,
    currentCompany: input.currentCompany?.trim() || null,
    currentCompanyNorm: normalizeCareerText(input.currentCompany),
    customAttributes: normalizeCustomAttributes(input.customAttributes),
  };
}

export function extractMentorSignals(input: MentorInput): MentorSignals {
  const topicSource = [
    ...(input.topics ?? []),
    ...(input.expertiseAreas ?? []),
  ];
  const industries = canonicalIndustryList(input.nativeIndustries);
  const roleFamilies = canonicalRoleFamilyList(input.nativeRoleFamilies);

  return {
    userId: input.userId,
    orgId: input.orgId,
    topics: uniqueNormalizedList(topicSource),
    industries,
    roleFamilies,
    industry: industries[0] ?? null,
    roleFamily: roleFamilies[0] ?? null,
    sports: uniqueNormalizedList(input.nativeSports),
    positions: uniqueNormalizedList(input.nativePositions),
    currentCity: input.currentCity?.trim() || null,
    currentCityNorm: normalizeCareerText(input.currentCity),
    graduationYear: input.graduationYear ?? null,
    currentCompany: input.currentCompany?.trim() || null,
    currentCompanyNorm: normalizeCareerText(input.currentCompany),
    maxMentees: input.maxMentees ?? 3,
    currentMenteeCount: input.currentMenteeCount ?? 0,
    acceptingNew: input.acceptingNew ?? true,
    isActive: input.isActive ?? true,
    customAttributes: normalizeCustomAttributes(input.customAttributes),
  };
}

export function intersectNormalized(
  a: string[] | null | undefined,
  b: string[] | null | undefined
): string[] {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length === 0 || bb.length === 0) return [];
  const set = new Set(bb);
  const out: string[] = [];
  for (const v of aa) if (set.has(v)) out.push(v);
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

  // Extract custom attributes from intake data — any key not in the built-in
  // field set is treated as a potential custom attribute value
  const BUILT_IN_INTAKE_KEYS = new Set([
    "preferred_topics", "preferred_industry", "preferred_role_families",
    "goals", "time_availability", "communication_prefs", "geographic_pref",
    "mentor_attributes_required", "mentor_attributes_nice_to_have",
  ]);
  const customAttrs: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (BUILT_IN_INTAKE_KEYS.has(k)) continue;
    if (typeof v === "string" && v.trim()) {
      customAttrs[k] = v.trim();
    } else if (Array.isArray(v)) {
      const arr = v.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (arr.length > 0) customAttrs[k] = arr;
    }
  }

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
    customAttributes: Object.keys(customAttrs).length > 0 ? customAttrs : null,
  };
}
