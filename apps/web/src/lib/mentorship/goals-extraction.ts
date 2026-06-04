import {
  canonicalizeIndustry,
  matchRoleFamiliesFromText,
  normalizeCareerText,
} from "@/lib/falkordb/career-signals";

/**
 * Deterministic, zero-cost extraction of canonical matching signals from a
 * mentee's free-text `goals`. Students rarely fill the structured preference
 * fields, but they DO describe aspirations in prose ("I want to break into
 * investment banking"). This recovers the canonical industries / role families
 * the overlap-based matcher needs, BEFORE any LLM is involved.
 *
 * Topics/skills are intentionally NOT derived here: arbitrary goal tokens are
 * too noisy to feed into `shared_topics` / `aspirational_skill`. The LLM
 * backfill (signal-backfill.ts) produces clean skills/topics under a
 * constrained prompt; this module sticks to the high-precision canonical sets.
 */

export interface ExtractedGoalSignals {
  industries: string[]; // canonical
  roleFamilies: string[]; // canonical
  topics: string[]; // reserved for future use — always empty today
}

/** Maps a canonical role family to the industry it most strongly implies. */
const ROLE_FAMILY_TO_INDUSTRY: Record<string, string> = {
  Engineering: "Technology",
  Product: "Technology",
  Data: "Technology",
  Finance: "Finance",
  Consulting: "Consulting",
  Healthcare: "Healthcare",
  Law: "Law",
  Media: "Media",
  Sports: "Sports",
  Education: "Education",
};

/**
 * High-precision keyword → canonical industry vocabulary. Keys are matched as
 * whitespace-padded substrings against normalized text, so multi-word phrases
 * ("real estate") match exactly and short tokens never match inside words.
 */
const INDUSTRY_KEYWORDS: Array<{ industry: string; keywords: string[] }> = [
  {
    industry: "Technology",
    keywords: ["tech", "software", "startup", "engineering", "machine learning", "artificial intelligence"],
  },
  {
    industry: "Finance",
    keywords: [
      "finance",
      "financial",
      "banking",
      "investment banking",
      "investment",
      "private equity",
      "venture capital",
      "hedge fund",
      "trading",
      "asset management",
    ],
  },
  {
    industry: "Healthcare",
    keywords: ["healthcare", "health care", "medicine", "medical", "biotech", "pharma", "clinical"],
  },
  {
    industry: "Media",
    keywords: ["media", "journalism", "entertainment", "film", "publishing", "advertising"],
  },
  {
    industry: "Consulting",
    keywords: ["consulting", "consultant", "strategy"],
  },
  {
    industry: "Law",
    keywords: ["law", "legal", "attorney", "litigation"],
  },
  {
    industry: "Aerospace",
    keywords: ["aerospace", "aviation", "space"],
  },
  {
    industry: "Real Estate",
    keywords: ["real estate", "property"],
  },
  {
    industry: "Nonprofit",
    keywords: ["nonprofit", "non profit", "ngo", "social impact"],
  },
  {
    industry: "Sports",
    keywords: ["sports", "athletics", "athletic"],
  },
  {
    industry: "Education",
    keywords: ["education", "teaching", "edtech", "academia"],
  },
];

function pushUnique(out: string[], value: string | null | undefined): void {
  if (value && !out.includes(value)) out.push(value);
}

export function extractSignalsFromGoals(
  goals: string | null | undefined
): ExtractedGoalSignals {
  const normalized = normalizeCareerText(goals);
  if (!normalized) {
    return { industries: [], roleFamilies: [], topics: [] };
  }
  const padded = ` ${normalized} `;

  // Role families via the shared keyword vocabulary.
  const roleFamilies: string[] = [];
  for (const rf of matchRoleFamiliesFromText(goals)) pushUnique(roleFamilies, rf);

  const industries: string[] = [];
  // 1) Direct industry keyword hits.
  for (const entry of INDUSTRY_KEYWORDS) {
    const hit = entry.keywords.some((kw) => {
      const n = normalizeCareerText(kw);
      return n ? padded.includes(` ${n} `) : false;
    });
    if (hit) pushUnique(industries, entry.industry);
  }
  // 2) Industries implied by matched role families.
  for (const rf of roleFamilies) pushUnique(industries, ROLE_FAMILY_TO_INDUSTRY[rf] ?? null);
  // 3) Any token that canonicalizes directly (e.g. literally "Finance").
  for (const token of normalized.split(" ")) {
    pushUnique(industries, canonicalizeIndustry(token));
  }

  return { industries, roleFamilies, topics: [] };
}

/**
 * Best-effort canonical industry for a (normalized) field-of-study token, used
 * only by the zero-signal fallback ranker to bias toward mentors in the
 * student's likely field. Coarse by design.
 */
const FIELD_OF_STUDY_TO_INDUSTRY: Array<{ industry: string; terms: string[] }> = [
  { industry: "Technology", terms: ["computer", "data science", "information"] },
  { industry: "Finance", terms: ["finance", "economics", "accounting"] },
  { industry: "Consulting", terms: ["business", "management", "administration"] },
  { industry: "Healthcare", terms: ["nursing", "public health", "biology", "neuroscience", "biomedical"] },
  { industry: "Law", terms: ["legal studies", "political science", "international relations"] },
  { industry: "Media", terms: ["communications", "journalism"] },
  { industry: "Education", terms: ["education"] },
];

export function industryFromFieldOfStudy(fieldNorm: string | null | undefined): string | null {
  if (!fieldNorm) return null;
  const padded = ` ${fieldNorm} `;
  for (const entry of FIELD_OF_STUDY_TO_INDUSTRY) {
    if (entry.terms.some((t) => padded.includes(` ${t} `) || fieldNorm.includes(t))) {
      return entry.industry;
    }
  }
  return null;
}
