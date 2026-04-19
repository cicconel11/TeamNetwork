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
}

export interface MentorSignals {
  userId: string;
  orgId: string;
  topics: string[]; // normalized
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
}

const ATHLETIC_SPORT_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "basketball", pattern: /\bbasketball\b/ },
  { tag: "football", pattern: /\bfootball\b/ },
  { tag: "baseball", pattern: /\bbaseball\b/ },
  { tag: "softball", pattern: /\bsoftball\b/ },
  { tag: "soccer", pattern: /\bsoccer\b/ },
  { tag: "volleyball", pattern: /\bvolleyball\b/ },
  { tag: "lacrosse", pattern: /\blacrosse\b/ },
  { tag: "track-and-field", pattern: /\b(track|track and field|cross country)\b/ },
  { tag: "swimming", pattern: /\b(swim|swimming|diving)\b/ },
  { tag: "tennis", pattern: /\btennis\b/ },
  { tag: "golf", pattern: /\bgolf\b/ },
  { tag: "wrestling", pattern: /\bwrestling\b/ },
  { tag: "rowing", pattern: /\b(rowing|crew|coxswain)\b/ },
  { tag: "field-hockey", pattern: /\bfield hockey\b/ },
  { tag: "ice-hockey", pattern: /\b(ice hockey|hockey)\b/ },
  { tag: "gymnastics", pattern: /\bgymnastics\b/ },
];

const ATHLETIC_POSITION_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "quarterback", pattern: /\bquarterback\b|\bqb\b/ },
  { tag: "running-back", pattern: /\brunning back\b|\brb\b/ },
  { tag: "wide-receiver", pattern: /\bwide receiver\b|\bwr\b/ },
  { tag: "tight-end", pattern: /\btight end\b|\bte\b/ },
  { tag: "linebacker", pattern: /\blinebacker\b|\blb\b/ },
  { tag: "defensive-back", pattern: /\b(defensive back|cornerback|safety)\b/ },
  { tag: "lineman", pattern: /\b(offensive lineman|defensive lineman|lineman|left tackle|right tackle)\b/ },
  { tag: "pitcher", pattern: /\bpitcher\b/ },
  { tag: "catcher", pattern: /\bcatcher\b/ },
  { tag: "infield", pattern: /\b(shortstop|second baseman|third baseman|first baseman|infielder)\b/ },
  { tag: "outfield", pattern: /\b(outfielder|left field|center field|right field)\b/ },
  { tag: "goalkeeper", pattern: /\b(goalkeeper|goalie|keeper)\b/ },
  { tag: "defender", pattern: /\b(defender|fullback|center back)\b/ },
  { tag: "midfielder", pattern: /\bmidfielder\b/ },
  { tag: "forward", pattern: /\bforward\b/ },
  { tag: "point-guard", pattern: /\bpoint guard\b/ },
  { tag: "shooting-guard", pattern: /\bshooting guard\b/ },
  { tag: "small-forward", pattern: /\bsmall forward\b/ },
  { tag: "power-forward", pattern: /\bpower forward\b/ },
  { tag: "center", pattern: /^center$|\bbasketball center\b/ },
  { tag: "setter", pattern: /\bsetter\b/ },
  { tag: "libero", pattern: /\blibero\b/ },
  { tag: "outside-hitter", pattern: /\boutside hitter\b/ },
  { tag: "middle-blocker", pattern: /\bmiddle blocker\b/ },
  { tag: "coach", pattern: /\bcoach\b/ },
];

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

function athleticTagList(
  values: Array<string | null | undefined> | null | undefined,
  patterns: Array<{ tag: string; pattern: RegExp }>
): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const normalized = normalizeCareerText(raw);
    if (!normalized) continue;
    for (const { tag, pattern } of patterns) {
      if (pattern.test(normalized) && !seen.has(tag)) {
        seen.add(tag);
        out.push(tag);
      }
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

export function extractMenteeSignals(input: MenteeInput): MenteeSignals {
  return {
    userId: input.userId,
    orgId: input.orgId,
    focusAreas: uniqueNormalizedList(input.focusAreas),
    preferredIndustries: canonicalIndustryList(input.preferredIndustries),
    preferredRoleFamilies: canonicalRoleFamilyList(input.preferredRoleFamilies),
    preferredSports: athleticTagList(input.preferredSports, ATHLETIC_SPORT_PATTERNS),
    preferredPositions: athleticTagList(input.preferredPositions, ATHLETIC_POSITION_PATTERNS),
    requiredMentorAttributes: normalizedAttributeKeyList(input.requiredMentorAttributes),
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
  const athleticSource = [
    ...topicSource,
    input.jobTitle ?? null,
    input.positionTitle ?? null,
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
    sports: athleticTagList(athleticSource, ATHLETIC_SPORT_PATTERNS),
    positions: athleticTagList(athleticSource, ATHLETIC_POSITION_PATTERNS),
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
  position_title: string | null;
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
      .select("current_city, current_company, graduation_year, position_title")
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
    preferredSports: stringArray((data as Record<string, unknown>).preferred_sports),
    preferredPositions: (() => {
      const explicit = stringArray((data as Record<string, unknown>).preferred_positions);
      return explicit.length > 0 ? explicit : stringArray([alumni?.position_title ?? null]);
    })(),
    requiredMentorAttributes: stringArray(
      (data as Record<string, unknown>).mentor_attributes_required
    ),
    currentCity: alumni?.current_city ?? null,
    graduationYear: alumni?.graduation_year ?? null,
    currentCompany: alumni?.current_company ?? null,
  };
}
