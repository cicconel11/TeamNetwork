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
  };
}

export function intersectNormalized(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const set = new Set(b);
  const out: string[] = [];
  for (const v of a) if (set.has(v)) out.push(v);
  return out;
}

