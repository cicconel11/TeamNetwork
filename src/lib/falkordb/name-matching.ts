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

// Damerau-Levenshtein distance (edit distance with adjacent transposition).
// 2-row DP, pure. Used for 1-2 char typo tolerance on name tokens.
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= m; i++) {
    d[i] = new Array(n + 1).fill(0);
    d[i][0] = i;
  }
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }

  return d[m][n];
}

// Fuzzy token match — short tokens require exact. Long tokens tolerate 1-2
// character edits. Returns true when tokens are "close enough" to consider
// the candidate as a near-miss (surfaces via disambiguation, not resolution).
function fuzzyTokenMatch(query: string, candidate: string): boolean {
  if (!query || !candidate) return false;
  const shorter = Math.min(query.length, candidate.length);
  if (shorter < 4) return false; // too short — false positives dominate
  const distance = damerauLevenshtein(query, candidate);
  if (shorter >= 7) return distance <= 2;
  return distance <= 1;
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

  // Fuzzy fallback — both tokens must be close. Scores land in the 30-60
  // disambiguation band, below the auto-resolve threshold so common typos
  // surface as ambiguous options instead of silent resolutions.
  const firstFuzzy = fuzzyTokenMatch(query.firstToken, candidate.firstToken);
  const lastFuzzy = fuzzyTokenMatch(query.lastToken, candidate.lastToken);
  if ((firstExact || firstAlias || firstPrefix || firstFuzzy) && lastFuzzy) {
    const longestToken = Math.max(query.lastToken.length, candidate.lastToken.length);
    return longestToken >= 7 ? 35 : 40;
  }
  if (firstFuzzy && lastExact) {
    return 40;
  }

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
