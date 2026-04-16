import type { ProjectedPerson } from "@/lib/falkordb/people";

const MATT_FAMILY_ALIASES = new Set(["mat", "matt", "matthew"]);

interface ParsedHumanName {
  normalized: string;
  tokens: string[];
  firstToken: string | null;
  lastToken: string | null;
  aliasFirstToken: string | null;
}

export interface FuzzyNameMatch {
  person: ProjectedPerson;
  score: number;
}

function canonicalizeAliasToken(token: string | null): string | null {
  if (!token) {
    return null;
  }

  if (MATT_FAMILY_ALIASES.has(token)) {
    return "matt";
  }

  return token;
}

function prefixMatches(queryToken: string | null, candidateToken: string | null): boolean {
  if (!queryToken || !candidateToken) {
    return false;
  }

  return candidateToken.startsWith(queryToken);
}

function parseHumanName(value: string | null | undefined): ParsedHumanName {
  const normalized = normalizeHumanNameText(value);
  const tokens = normalized ? normalized.split(" ").filter(Boolean) : [];
  const firstToken = tokens[0] ?? null;
  const lastToken = tokens.length > 0 ? tokens[tokens.length - 1] : null;

  return {
    normalized,
    tokens,
    firstToken,
    lastToken,
    aliasFirstToken: canonicalizeAliasToken(firstToken),
  };
}

export function normalizeHumanNameText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreProjectedPersonNameMatch(
  personQuery: string,
  person: ProjectedPerson
): number {
  const query = parseHumanName(personQuery);
  if (query.tokens.length < 2 || !query.firstToken || !query.lastToken) {
    return 0;
  }

  const candidate = parseHumanName(person.name);
  if (!candidate.firstToken || !candidate.lastToken) {
    return 0;
  }

  const firstExact = query.firstToken === candidate.firstToken;
  const firstAlias = query.aliasFirstToken !== null && query.aliasFirstToken === candidate.aliasFirstToken;
  const firstPrefix = prefixMatches(query.firstToken, candidate.firstToken);
  const lastExact = query.lastToken === candidate.lastToken;
  const lastPrefix = prefixMatches(query.lastToken, candidate.lastToken);

  if (firstExact && lastExact) return 100;
  if (firstAlias && lastExact) return 85;
  if (firstExact && lastPrefix) return 75;
  if (firstAlias && lastPrefix) return 65;
  if (firstPrefix && lastPrefix) return 50;

  return 0;
}

export function findBestProjectedPersonNameMatches(
  projectedPeople: Iterable<ProjectedPerson>,
  personQuery: string
): FuzzyNameMatch[] {
  const matches: FuzzyNameMatch[] = [];

  for (const person of projectedPeople) {
    const score = scoreProjectedPersonNameMatch(personQuery, person);
    if (score > 0) {
      matches.push({ person, score });
    }
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const nameComparison = left.person.name.localeCompare(right.person.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.person.personId.localeCompare(right.person.personId);
  });

  return matches;
}
