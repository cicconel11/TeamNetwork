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

export function parseMemberCareerString(value: string | null | undefined): {
  employer: string | null;
  canonicalIndustry: string | null;
} {
  const trimmed = trimOptionalText(value);
  if (!trimmed) {
    return { employer: null, canonicalIndustry: null };
  }

  const employer = trimOptionalText(parseEmployerText(trimmed));
  const normalizedEmployer = normalizeCareerText(employer);

  return {
    employer,
    canonicalIndustry: normalizedEmployer
      ? EMPLOYER_TO_CANONICAL_INDUSTRY.get(normalizedEmployer) ?? null
      : null,
  };
}
