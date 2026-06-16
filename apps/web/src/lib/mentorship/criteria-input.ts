import type { MenteeInput, MentorInput } from "@/lib/mentorship/matching";

export interface MentorshipCriteriaInput {
  topics?: string[] | null;
  industries?: string[] | null;
  roleFamilies?: string[] | null;
  goals?: string | null;
}

export interface SyntheticCriteriaEntity<TInput extends MenteeInput | MentorInput> {
  input: TInput;
  label: string;
}

function cleanString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const cleaned = cleanString(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }

  return out;
}

export function hasMentorshipCriteria(criteria: MentorshipCriteriaInput): boolean {
  return (
    cleanList(criteria.topics).length > 0 ||
    cleanList(criteria.industries).length > 0 ||
    cleanList(criteria.roleFamilies).length > 0 ||
    cleanString(criteria.goals) !== null
  );
}

function stableHash(input: unknown): string {
  const json = JSON.stringify(input);
  let hash = 0x811c9dc5;

  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

function normalizeCriteria(criteria: MentorshipCriteriaInput) {
  return {
    topics: cleanList(criteria.topics),
    industries: cleanList(criteria.industries),
    roleFamilies: cleanList(criteria.roleFamilies),
    goals: cleanString(criteria.goals),
  };
}

function buildCriteriaLabel(criteria: ReturnType<typeof normalizeCriteria>): string {
  const parts = [
    ...criteria.topics,
    ...criteria.industries,
    ...criteria.roleFamilies,
  ];

  if (parts.length > 0) {
    return parts.join(", ");
  }

  return criteria.goals ?? "these criteria";
}

export function buildSyntheticMenteeFromCriteria(
  orgId: string,
  criteria: MentorshipCriteriaInput
): SyntheticCriteriaEntity<MenteeInput> | null {
  const normalized = normalizeCriteria(criteria);
  if (!hasMentorshipCriteria(normalized)) return null;

  const id = `criteria-mentee-${stableHash({ orgId, ...normalized })}`;

  return {
    label: buildCriteriaLabel(normalized),
    input: {
      userId: id,
      orgId,
      goals: normalized.goals,
      focusAreas: normalized.topics,
      preferredIndustries: normalized.industries,
      preferredRoleFamilies: normalized.roleFamilies,
      currentCity: null,
      graduationYear: null,
      currentCompany: null,
    },
  };
}

export function buildSyntheticMentorFromCriteria(
  orgId: string,
  criteria: MentorshipCriteriaInput
): SyntheticCriteriaEntity<MentorInput> | null {
  const normalized = normalizeCriteria(criteria);
  if (!hasMentorshipCriteria(normalized)) return null;

  const id = `criteria-mentor-${stableHash({ orgId, ...normalized })}`;

  return {
    label: buildCriteriaLabel(normalized),
    input: {
      userId: id,
      orgId,
      topics: normalized.topics,
      expertiseAreas: normalized.goals ? [normalized.goals] : [],
      nativeIndustries: normalized.industries,
      nativeRoleFamilies: normalized.roleFamilies,
      industry: normalized.industries[0] ?? null,
      jobTitle: null,
      positionTitle: null,
      currentCompany: null,
      currentCity: null,
      graduationYear: null,
      maxMentees: 999,
      currentMenteeCount: 0,
      acceptingNew: true,
      isActive: true,
    },
  };
}
