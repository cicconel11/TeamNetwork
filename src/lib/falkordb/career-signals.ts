const CANONICAL_INDUSTRIES = new Set([
  "Technology",
  "Finance",
  "Healthcare",
  "Media",
  "Consulting",
  "Law",
  "Aerospace",
  "Real Estate",
  "Nonprofit",
  "Sports",
  "Education",
]);

const CANONICAL_ROLE_FAMILIES = new Set([
  "Engineering",
  "Product",
  "Data",
  "Finance",
  "Consulting",
  "Healthcare",
  "Law",
  "Media",
  "Operations",
  "Research",
  "Sports",
  "Education",
]);

const RAW_INDUSTRY_TO_CANONICAL = new Map<string, string>([
  ["banking", "Finance"],
  ["private equity", "Finance"],
  ["media and entertainment", "Media"],
]);

const EMPLOYER_TO_CANONICAL_INDUSTRY = new Map<string, string>([
  ["google", "Technology"],
  ["stripe", "Technology"],
  ["meta", "Technology"],
  ["databricks", "Technology"],
  ["microsoft", "Technology"],
  ["amazon", "Technology"],
  ["tesla", "Technology"],
  ["jpmorgan chase", "Finance"],
  ["goldman sachs", "Finance"],
  ["blackstone", "Finance"],
  ["citadel", "Finance"],
  ["pfizer", "Healthcare"],
  ["moderna", "Healthcare"],
  ["mount sinai health system", "Healthcare"],
  ["penn medicine", "Healthcare"],
  ["netflix", "Media"],
  ["the new york times", "Media"],
  ["penn daily pennsylvanian", "Media"],
  ["bain and company", "Consulting"],
  ["mckinsey and company", "Consulting"],
  ["deloitte", "Consulting"],
  ["kirkland and ellis", "Law"],
  ["spacex", "Aerospace"],
  ["gensler", "Real Estate"],
  ["cbre", "Real Estate"],
  ["united nations", "Nonprofit"],
  ["teach for america", "Nonprofit"],
  ["penn civic house", "Nonprofit"],
  ["penn athletics", "Sports"],
  ["wharton undergraduate sports business group", "Sports"],
  ["penn sprint football", "Sports"],
  ["penn admissions", "Education"],
]);

const EMPLOYER_TO_ROLE_FAMILY = new Map<string, string>([
  ["citadel", "Finance"],
  ["jpmorgan chase", "Finance"],
  ["goldman sachs", "Finance"],
  ["blackstone", "Finance"],
  ["bain and company", "Consulting"],
  ["mckinsey and company", "Consulting"],
  ["deloitte", "Consulting"],
  ["penn admissions", "Education"],
  ["penn medicine", "Healthcare"],
  ["mount sinai health system", "Healthcare"],
  ["pfizer", "Healthcare"],
  ["moderna", "Healthcare"],
  ["penn daily pennsylvanian", "Media"],
  ["the new york times", "Media"],
  ["netflix", "Media"],
]);

const INDUSTRY_TO_ROLE_FAMILY = new Map<string, string>([
  ["Finance", "Finance"],
  ["Consulting", "Consulting"],
  ["Healthcare", "Healthcare"],
  ["Law", "Law"],
  ["Media", "Media"],
  ["Sports", "Sports"],
  ["Education", "Education"],
]);

const ROLE_FAMILY_KEYWORDS: Array<{ family: string; keywords: string[] }> = [
  {
    family: "Engineering",
    keywords: ["engineer", "swe", "sde", "developer", "backend", "frontend", "full stack"],
  },
  {
    family: "Product",
    keywords: ["product manager", "pm"],
  },
  {
    family: "Data",
    keywords: ["data scientist", "data analyst", "machine learning", " ml ", "analytics"],
  },
  {
    family: "Finance",
    keywords: [
      "financial analyst",
      "investment banking analyst",
      "investment",
      "banking",
      "private equity",
      "trader",
    ],
  },
  {
    family: "Consulting",
    keywords: ["consultant", "consulting"],
  },
  {
    family: "Healthcare",
    keywords: ["nurse", "clinical", "medical", "physician", "pharma"],
  },
  {
    family: "Law",
    keywords: ["lawyer", "attorney", "counsel", "legal"],
  },
  {
    family: "Media",
    keywords: ["writer", "journalist", "editor", "communications", "content"],
  },
  {
    family: "Operations",
    keywords: ["operations", " ops ", "coordinator", "program manager"],
  },
  {
    family: "Research",
    keywords: ["research", "scientist", "research assistant"],
  },
  {
    family: "Sports",
    keywords: ["athlete", "football", "cornerback", "coach", "sports"],
  },
  {
    family: "Education",
    keywords: ["teacher", "tutor", "admissions", "educator"],
  },
];

const ROLE_FAMILY_ADJACENCY = new Map<string, Set<string>>([
  ["Engineering", new Set(["Data", "Product"])],
  ["Data", new Set(["Engineering", "Product"])],
  ["Product", new Set(["Engineering", "Data", "Operations"])],
  ["Finance", new Set(["Consulting"])],
  ["Consulting", new Set(["Finance", "Operations"])],
  ["Healthcare", new Set(["Research"])],
  ["Research", new Set(["Healthcare", "Data"])],
]);

function trimOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function normalizeCareerText(value: string | null | undefined): string | null {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

export function canonicalizeIndustry(value: string | null | undefined): string | null {
  const trimmed = trimOptionalText(value);
  if (!trimmed) {
    return null;
  }

  if (CANONICAL_INDUSTRIES.has(trimmed)) {
    return trimmed;
  }

  const normalized = normalizeCareerText(trimmed);
  if (!normalized) {
    return null;
  }

  return RAW_INDUSTRY_TO_CANONICAL.get(normalized) ?? null;
}

function parseEmployerText(value: string): string {
  const trimmed = value.trim();

  const parentheticalIndex = trimmed.indexOf("(");
  if (parentheticalIndex > 0) {
    return trimmed.slice(0, parentheticalIndex).trim();
  }

  const separatorMatch = trimmed.match(/^(.+?)\s(?:—|-)\s.+$/);
  if (separatorMatch?.[1]) {
    return separatorMatch[1].trim();
  }

  return trimmed;
}

function parseRoleFragment(value: string): string | null {
  const trimmed = value.trim();

  const parentheticalMatch = trimmed.match(/\(([^)]+)\)\s*$/);
  if (parentheticalMatch?.[1]) {
    return trimOptionalText(parentheticalMatch[1]);
  }

  const separatorMatch = trimmed.match(/^.+?\s(?:—|-)\s(.+)$/);
  if (separatorMatch?.[1]) {
    return trimOptionalText(separatorMatch[1]);
  }

  return null;
}

function matchRoleFamilyFromText(value: string | null | undefined): string | null {
  const normalized = normalizeCareerText(value);
  if (!normalized) {
    return null;
  }

  const padded = ` ${normalized} `;
  for (const entry of ROLE_FAMILY_KEYWORDS) {
    if (
      entry.keywords.some((keyword) => {
        const normalizedKeyword = normalizeCareerText(keyword);
        return normalizedKeyword ? padded.includes(` ${normalizedKeyword} `) : false;
      })
    ) {
      return entry.family;
    }
  }

  return null;
}

export function canonicalizeRoleFamily(
  value: string | null | undefined,
  employer?: string | null | undefined,
  canonicalIndustry?: string | null | undefined
): string | null {
  const trimmed = trimOptionalText(value);
  if (trimmed && CANONICAL_ROLE_FAMILIES.has(trimmed)) {
    return trimmed;
  }

  const directMatch = matchRoleFamilyFromText(trimmed);
  if (directMatch) {
    return directMatch;
  }

  const normalizedEmployer = normalizeCareerText(employer);
  if (normalizedEmployer) {
    const employerMatch = EMPLOYER_TO_ROLE_FAMILY.get(normalizedEmployer);
    if (employerMatch) {
      return employerMatch;
    }
  }

  const industryMatch = canonicalIndustry
    ? INDUSTRY_TO_ROLE_FAMILY.get(canonicalIndustry)
    : null;

  return industryMatch ?? null;
}

export function areAdjacentRoleFamilies(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right || left === right) {
    return false;
  }

  return ROLE_FAMILY_ADJACENCY.get(left)?.has(right) === true;
}

export function parseMemberCareerString(value: string | null | undefined): {
  employer: string | null;
  roleFragment: string | null;
  canonicalIndustry: string | null;
  roleFamily: string | null;
} {
  const trimmed = trimOptionalText(value);
  if (!trimmed) {
    return { employer: null, roleFragment: null, canonicalIndustry: null, roleFamily: null };
  }

  const employer = trimOptionalText(parseEmployerText(trimmed));
  const roleFragment = parseRoleFragment(trimmed);
  const normalizedEmployer = normalizeCareerText(employer);
  const canonicalIndustry = normalizedEmployer
    ? EMPLOYER_TO_CANONICAL_INDUSTRY.get(normalizedEmployer) ?? null
    : null;

  return {
    employer,
    roleFragment,
    canonicalIndustry,
    roleFamily: canonicalizeRoleFamily(roleFragment, employer, canonicalIndustry),
  };
}
