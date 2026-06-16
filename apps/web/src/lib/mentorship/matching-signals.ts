import {
  canonicalizeIndustry,
  canonicalizeRoleFamily,
  normalizeCareerText,
  parseMemberCareerString,
} from "@/lib/falkordb/career-signals";
import { extractSignalsFromGoals } from "@/lib/mentorship/goals-extraction";

/**
 * Shape of a single `work_history` jsonb entry (LinkedIn/Apify enrichment).
 * Only the fields the matcher reads are declared; everything is optional/dirty.
 */
export interface EnrichedWorkEntry {
  title?: string | null;
  company?: string | null;
}

/**
 * Shape of a single `education_history` jsonb entry. `title` holds the school
 * name in the Apify payload. `field_of_study` is almost always null on real
 * data (the dev_fusion actor packs the field into the noisy `degree` line), so
 * the matcher falls back to keyword-extracting the field from `degree`.
 */
export interface EnrichedEducationEntry {
  title?: string | null;
  field_of_study?: string | null;
  degree?: string | null;
}

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
  /** Skills the mentee wants to develop. Proxied from focusAreas until a
   * dedicated `skills_to_develop` field exists. Normalized. */
  desiredSkillsNorm: string[];
  /** Schools attended (from education_history). Normalized. */
  schoolsNorm: string[];
  /** Fields of study (from education_history). Normalized. */
  fieldsOfStudyNorm: string[];
  /** All employers (work_history + current). Normalized. */
  companiesNorm: string[];
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
  /** Canonical industries spanning the FULL work history (past + current). */
  trajectoryIndustries: string[];
  /** Canonical role families spanning the FULL work history (past + current). */
  trajectoryRoleFamilies: string[];
  /** Schools attended (from education_history). Normalized. */
  schoolsNorm: string[];
  /** Fields of study (from education_history). Normalized. */
  fieldsOfStudyNorm: string[];
  /** All employers (work_history + current). Normalized. */
  allCompaniesNorm: string[];
  /** LinkedIn-derived skills. Normalized. */
  skillsNorm: string[];
  maxMentees: number;
  currentMenteeCount: number;
  acceptingNew: boolean;
  isActive: boolean;
  customAttributes: Record<string, string[]>; // always string[], normalized
}

export interface MenteeInput {
  userId: string;
  orgId: string;
  /** Free-text aspirations. Deterministically mined into canonical industries /
   * role families to enrich (never override) the structured fields below. */
  goals?: string | null;
  focusAreas?: string[] | null;
  preferredIndustries?: string[] | null;
  preferredRoleFamilies?: string[] | null;
  preferredSports?: string[] | null;
  preferredPositions?: string[] | null;
  requiredMentorAttributes?: string[] | null;
  currentCity?: string | null;
  graduationYear?: number | null;
  currentCompany?: string | null;
  /** Raw `work_history` jsonb (members/alumni). */
  workHistory?: EnrichedWorkEntry[] | null;
  /** Raw `education_history` jsonb (members/alumni). */
  educationHistory?: EnrichedEducationEntry[] | null;
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
  /** Raw `work_history` jsonb (alumni). */
  workHistory?: EnrichedWorkEntry[] | null;
  /** Raw `education_history` jsonb (alumni). */
  educationHistory?: EnrichedEducationEntry[] | null;
  /** Raw `skills` jsonb (alumni) — array of strings. */
  skills?: string[] | null;
  maxMentees?: number | null;
  currentMenteeCount?: number | null;
  acceptingNew?: boolean | null;
  isActive?: boolean | null;
  customAttributes?: Record<string, string | string[]> | null;
}

function uniqueNormalizedList(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v != null && typeof v !== "string") continue; // tolerate dirty jsonb
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

/**
 * School-name normalization. LinkedIn appends the sub-school after a " - "
 * separator ("University of Pennsylvania - The Wharton School"), which would
 * otherwise prevent a match against the bare institution. Split on that
 * separator FIRST (before `normalizeCareerText` strips the hyphen), keep the
 * institution, then normalize and drop a leading "the ".
 */
function normalizeSchool(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const institution = value.split(/\s[-–—]\s/)[0];
  const base = normalizeCareerText(institution);
  if (!base) return null;
  return base.replace(/^the\s+/, "") || base;
}

/**
 * Curated academic fields. The matcher keyword-matches these against the noisy
 * `degree` line, which avoids false matches on the extracurricular text the
 * scraper dumps there (club names, sports captaincies, honor societies).
 * More specific terms precede the generic ones they contain.
 */
const FIELD_OF_STUDY_TERMS: readonly string[] = [
  "computer engineering",
  "computer science",
  "data science",
  "data analysis",
  "electrical engineering",
  "mechanical engineering",
  "chemical engineering",
  "biomedical engineering",
  "civil engineering",
  "industrial engineering",
  "systems engineering",
  "bioengineering",
  "engineering",
  "applied mathematics",
  "mathematics",
  "statistics",
  "physics",
  "chemistry",
  "biology",
  "neuroscience",
  "economics",
  "finance",
  "accounting",
  "business administration",
  "marketing",
  "management",
  "business",
  "political science",
  "international relations",
  "philosophy",
  "psychology",
  "sociology",
  "history",
  "communications",
  "legal studies",
  "nursing",
  "public health",
];

/**
 * Extract normalized field-of-study tokens from an education entry: prefer the
 * structured `field_of_study`, fall back to keyword-matching the `degree` line.
 */
function extractFieldsOfStudy(entry: EnrichedEducationEntry): string[] {
  const direct = normalizeCareerText(
    typeof entry?.field_of_study === "string" ? entry.field_of_study : null
  );
  if (direct) return [direct];

  const degreeNorm = normalizeCareerText(typeof entry?.degree === "string" ? entry.degree : null);
  if (!degreeNorm) return [];
  const padded = ` ${degreeNorm} `;
  const fields: string[] = [];
  for (const term of FIELD_OF_STUDY_TERMS) {
    if (!padded.includes(` ${term} `)) continue;
    // Specific terms come first; skip a generic term already covered by a more
    // specific match (e.g. don't add "engineering" after "computer engineering").
    if (fields.some((f) => f !== term && f.includes(term))) continue;
    if (!fields.includes(term)) fields.push(term);
  }
  return fields;
}

/**
 * Derive canonical career-trajectory sets from a full work history, reusing the
 * same employer/title canonicalization the people-graph uses. Companies cover
 * every role; industries/role-families are resolved per entry and unioned.
 */
function deriveTrajectory(
  work: EnrichedWorkEntry[] | null | undefined,
  currentCompanyNorm: string | null
): { industries: string[]; roleFamilies: string[]; companies: string[] } {
  const industries = new Set<string>();
  const roleFamilies = new Set<string>();
  const companies = new Set<string>();
  if (currentCompanyNorm) companies.add(currentCompanyNorm);

  for (const entry of Array.isArray(work) ? work : []) {
    const company = typeof entry?.company === "string" ? entry.company : null;
    const title = typeof entry?.title === "string" ? entry.title : null;

    const companyNorm = normalizeCareerText(company);
    if (companyNorm) companies.add(companyNorm);

    const composed = company
      ? title
        ? `${company} — ${title}`
        : company
      : title ?? "";
    const parsed = parseMemberCareerString(composed);
    if (parsed.canonicalIndustry) industries.add(parsed.canonicalIndustry);
    const roleFamily =
      parsed.roleFamily ?? canonicalizeRoleFamily(title, company, parsed.canonicalIndustry);
    if (roleFamily) roleFamilies.add(roleFamily);
  }

  return {
    industries: Array.from(industries),
    roleFamilies: Array.from(roleFamilies),
    companies: Array.from(companies),
  };
}

function deriveEducation(
  education: EnrichedEducationEntry[] | null | undefined
): { schools: string[]; fields: string[] } {
  const schools = new Set<string>();
  const fields = new Set<string>();
  for (const entry of Array.isArray(education) ? education : []) {
    const school = normalizeSchool(typeof entry?.title === "string" ? entry.title : null);
    if (school) schools.add(school);
    for (const field of extractFieldsOfStudy(entry ?? {})) fields.add(field);
  }
  return { schools: Array.from(schools), fields: Array.from(fields) };
}

function unionUnique(base: string[], extra: string[]): string[] {
  if (extra.length === 0) return base;
  const seen = new Set(base);
  const out = [...base];
  for (const v of extra) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function extractMenteeSignals(input: MenteeInput): MenteeSignals {
  const focusAreas = uniqueNormalizedList(input.focusAreas);
  const currentCompanyNorm = normalizeCareerText(input.currentCompany);
  const { companies } = deriveTrajectory(input.workHistory, currentCompanyNorm);
  const { schools, fields } = deriveEducation(input.educationHistory);

  // Free-text goals enrich (never override) the canonical structured fields.
  const goalSignals = extractSignalsFromGoals(input.goals);

  return {
    userId: input.userId,
    orgId: input.orgId,
    focusAreas,
    preferredIndustries: unionUnique(
      canonicalIndustryList(input.preferredIndustries),
      goalSignals.industries
    ),
    preferredRoleFamilies: unionUnique(
      canonicalRoleFamilyList(input.preferredRoleFamilies),
      goalSignals.roleFamilies
    ),
    preferredSports: uniqueNormalizedList(input.preferredSports),
    preferredPositions: uniqueNormalizedList(input.preferredPositions),
    requiredMentorAttributes: normalizedAttributeKeyList(input.requiredMentorAttributes),
    currentCity: input.currentCity?.trim() || null,
    currentCityNorm: normalizeCareerText(input.currentCity),
    graduationYear: input.graduationYear ?? null,
    currentCompany: input.currentCompany?.trim() || null,
    currentCompanyNorm,
    // No dedicated "skills to develop" field yet — focus areas are the proxy.
    desiredSkillsNorm: focusAreas,
    schoolsNorm: schools,
    fieldsOfStudyNorm: fields,
    companiesNorm: companies,
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
  const currentCompanyNorm = normalizeCareerText(input.currentCompany);
  const trajectory = deriveTrajectory(input.workHistory, currentCompanyNorm);
  const { schools, fields } = deriveEducation(input.educationHistory);

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
    currentCompanyNorm,
    trajectoryIndustries: trajectory.industries,
    trajectoryRoleFamilies: trajectory.roleFamilies,
    schoolsNorm: schools,
    fieldsOfStudyNorm: fields,
    allCompaniesNorm: trajectory.companies,
    skillsNorm: uniqueNormalizedList(input.skills),
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
