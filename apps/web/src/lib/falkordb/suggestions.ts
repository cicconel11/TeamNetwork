import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALUMNI_PERSON_SELECT,
  buildProjectedPeople,
  buildSourcePerson,
  MEMBER_PERSON_SELECT,
  type AlumniPersonRow,
  type MemberPersonRow,
  type ProjectedPerson,
} from "@/lib/falkordb/people";
import {
  buildConnectionRarityStats,
  getCandidateQualificationCodes,
  hasProfessionalStrengthQualification,
  hasProfessionalStrengthReason,
  inspectCandidateSignals,
  buildDisplayReadyConnectionPerson,
  buildDisplayReadySuggestedConnection,
  buildSuggestionForCandidate,
  clampSuggestionsLimit,
  normalizeConnectionText,
  sortSuggestedConnections,
  type CandidateQualificationCode,
  type ConnectionScoringContext,
  type SuggestConnectionsFreshness,
  type SuggestConnectionsResult,
} from "@/lib/falkordb/scoring";
import {
  getSuggestedCandidateExposureCounts,
  getSuggestionObservabilitySnapshot,
  recordSuggestedCandidates,
  recordSuggestionExecution,
  type GraphFallbackReason,
  type SuggestionResultStrength,
} from "@/lib/falkordb/telemetry";
import {
  findBestProjectedPersonNameMatches,
  normalizeHumanNameText,
} from "@/lib/falkordb/name-matching";

export interface SuggestConnectionsArgs {
  person_type?: "member" | "alumni";
  person_id?: string;
  person_query?: string;
  limit?: number;
}

const CHAT_CONNECTION_SUGGESTION_LIMIT = 3;

export class SuggestConnectionsLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuggestConnectionsLookupError";
  }
}

function buildFreshnessFromNow(): SuggestConnectionsFreshness {
  return {
    state: "fresh",
    as_of: new Date().toISOString(),
  };
}

async function loadProjectedPeople(
  serviceSupabase: SupabaseClient,
  orgId: string
): Promise<Map<string, ProjectedPerson>> {
  const [membersResponse, alumniResponse] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("members")
      .select(MEMBER_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .is("deleted_at", null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (serviceSupabase as any)
      .from("alumni")
      .select(ALUMNI_PERSON_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);

  if (membersResponse.error) {
    throw new Error("Failed to load members for suggestions");
  }

  if (alumniResponse.error) {
    throw new Error("Failed to load alumni for suggestions");
  }

  return buildProjectedPeople({
    members: (membersResponse.data ?? []) as MemberPersonRow[],
    alumni: (alumniResponse.data ?? []) as AlumniPersonRow[],
  });
}

async function fetchSourceRow(
  serviceSupabase: SupabaseClient,
  orgId: string,
  args: SuggestConnectionsArgs
) {
  if (!args.person_type || !args.person_id) {
    return null;
  }

  if (args.person_type === "member") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from("members")
      .select(MEMBER_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("id", args.person_id)
      .eq("status", "active")
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error("Failed to load source member");
    }

    return data as MemberPersonRow | null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("alumni")
    .select(ALUMNI_PERSON_SELECT)
    .eq("organization_id", orgId)
    .eq("id", args.person_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load source alumni");
  }

  return data as AlumniPersonRow | null;
}

async function fetchSourceWithComplement(
  serviceSupabase: SupabaseClient,
  orgId: string,
  args: SuggestConnectionsArgs
): Promise<{ memberRows: MemberPersonRow[]; alumniRows: AlumniPersonRow[] }> {
  const sourceRow = await fetchSourceRow(serviceSupabase, orgId, args);

  if (!sourceRow) {
    return { memberRows: [], alumniRows: [] };
  }

  if (args.person_type === "member") {
    const memberRow = sourceRow as MemberPersonRow;
    if (!memberRow.user_id) {
      return { memberRows: [memberRow], alumniRows: [] };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from("alumni")
      .select(ALUMNI_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("user_id", memberRow.user_id)
      .is("deleted_at", null);

    if (error) {
      throw new Error("Failed to load source alumni complement");
    }

    return {
      memberRows: [memberRow],
      alumniRows: (data as AlumniPersonRow[] | null) ?? [],
    };
  }

  const alumniRow = sourceRow as AlumniPersonRow;
  if (!alumniRow.user_id) {
    return { memberRows: [], alumniRows: [alumniRow] };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any)
    .from("members")
    .select(MEMBER_PERSON_SELECT)
    .eq("organization_id", orgId)
    .eq("user_id", alumniRow.user_id)
    .eq("status", "active")
    .is("deleted_at", null);

  if (error) {
    throw new Error("Failed to load source member complement");
  }

  return {
    memberRows: (data as MemberPersonRow[] | null) ?? [],
    alumniRows: [alumniRow],
  };
}

const MIN_FUZZY_AUTORESOLVE_MARGIN = 15;
// Below this threshold a single fuzzy hit stays "ambiguous" — a lone typo
// suggestion is a near-miss the user should confirm, not an auto-resolution.
const MIN_FUZZY_AUTORESOLVE_SCORE = 50;

function resolveSourceFromQuery(
  projectedPeople: Map<string, ProjectedPerson>,
  personQuery: string
):
  | { state: "resolved"; source: ProjectedPerson }
  | { state: "ambiguous"; options: ProjectedPerson[] }
  | { state: "not_found" } {
  const normalizedQuery = normalizeHumanNameText(personQuery);

  const emailMatches = [...projectedPeople.values()].filter((person) => {
    const normalizedEmail = person.email ? normalizeHumanNameText(person.email) : "";
    return normalizedEmail.length > 0 && normalizedEmail === normalizedQuery;
  });

  if (emailMatches.length === 1) {
    return { state: "resolved", source: emailMatches[0] };
  }

  if (emailMatches.length > 1) {
    emailMatches.sort((left, right) => {
      const leftName = left.name.localeCompare(right.name);
      if (leftName !== 0) return leftName;
      return left.personId.localeCompare(right.personId);
    });
    return { state: "ambiguous", options: emailMatches };
  }

  const exactNameMatches = [...projectedPeople.values()].filter((person) => {
    const normalizedName = normalizeHumanNameText(person.name);
    return normalizedName.length > 0 && normalizedName === normalizedQuery;
  });

  if (exactNameMatches.length === 1) {
    return { state: "resolved", source: exactNameMatches[0] };
  }

  if (exactNameMatches.length > 1) {
    exactNameMatches.sort((left, right) => {
      const leftName = left.name.localeCompare(right.name);
      if (leftName !== 0) return leftName;
      return left.personId.localeCompare(right.personId);
    });
    return { state: "ambiguous", options: exactNameMatches };
  }

  const fuzzyMatches = findBestProjectedPersonNameMatches(projectedPeople.values(), personQuery);
  if (fuzzyMatches.length === 0) {
    return { state: "not_found" };
  }

  const topMatch = fuzzyMatches[0];
  const runnerUp = fuzzyMatches[1] ?? null;
  const clearWinner = !runnerUp || topMatch.score - runnerUp.score >= MIN_FUZZY_AUTORESOLVE_MARGIN;

  if (clearWinner && topMatch.score >= MIN_FUZZY_AUTORESOLVE_SCORE) {
    return { state: "resolved", source: topMatch.person };
  }

  return {
    state: "ambiguous",
    options: fuzzyMatches.slice(0, 3).map((match) => match.person),
  };
}

async function loadOrganizationName(
  serviceSupabase: SupabaseClient,
  orgId: string
): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();

    if (error) {
      return null;
    }

    const name =
      data && typeof data === "object" && typeof (data as { name?: unknown }).name === "string"
        ? (data as { name: string }).name
        : null;

    return name?.trim() || null;
  } catch {
    return null;
  }
}

function buildExposurePenaltyByPersonId(orgId: string) {
  const counts = getSuggestedCandidateExposureCounts(orgId);
  const penalties = new Map<string, number>();

  for (const [personId, appearances] of counts.entries()) {
    let penalty = 0;
    if (appearances >= 10) {
      penalty = 15;
    } else if (appearances >= 6) {
      penalty = 10;
    } else if (appearances >= 3) {
      penalty = 5;
    }

    if (penalty > 0) {
      penalties.set(personId, penalty);
    }
  }

  return penalties;
}

export interface CandidatePoolEntry {
  candidate: ProjectedPerson;
  qualificationCodes: CandidateQualificationCode[];
}

export function buildCandidatePool(input: {
  source: ProjectedPerson;
  candidates: Iterable<ProjectedPerson>;
  limit: number;
  scoringContext?: ConnectionScoringContext;
}) {
  const professionalEntries: CandidatePoolEntry[] = [];
  const weakSupportEntries: CandidatePoolEntry[] = [];

  for (const candidate of input.candidates) {
    if (candidate.personKey === input.source.personKey) {
      continue;
    }

    const signals = inspectCandidateSignals({
      source: input.source,
      candidate,
      scoringContext: input.scoringContext,
    });
    const qualificationCodes = getCandidateQualificationCodes(signals);
    if (qualificationCodes.length === 0) {
      continue;
    }

    const entry = { candidate, qualificationCodes };
    if (hasProfessionalStrengthQualification(qualificationCodes)) {
      professionalEntries.push(entry);
    } else {
      weakSupportEntries.push(entry);
    }
  }

  if (professionalEntries.length >= input.limit * 5) {
    return professionalEntries;
  }

  return [
    ...professionalEntries,
    ...weakSupportEntries.slice(0, Math.max(0, input.limit * 5 - professionalEntries.length)),
  ];
}

export function scoreProjectedCandidates(input: {
  source: ProjectedPerson;
  allPeople: Iterable<ProjectedPerson>;
  candidates: Iterable<ProjectedPerson>;
  limit: number;
  scoringContext?: ConnectionScoringContext;
}) {
  const rarityStats = buildConnectionRarityStats({
    people: input.allPeople,
    scoringContext: input.scoringContext,
  });
  const exposurePenaltyByPersonId = buildExposurePenaltyByPersonId(input.source.orgId);
  const strongSuggestions = [];
  const weakSuggestions = [];
  const candidatePool = buildCandidatePool({
    source: input.source,
    candidates: input.candidates,
    limit: input.limit,
    scoringContext: input.scoringContext,
  });

  for (const { candidate } of candidatePool) {
    const suggestion = buildSuggestionForCandidate({
      source: input.source,
      candidate,
      scoringContext: {
        ...input.scoringContext,
        rarityStats,
        exposurePenaltyByPersonId,
      },
    });
    if (!suggestion) {
      continue;
    }

    if (hasProfessionalStrengthReason(suggestion)) {
      strongSuggestions.push(suggestion);
    } else {
      weakSuggestions.push(suggestion);
    }
  }

  const results = strongSuggestions.length > 0 ? strongSuggestions : weakSuggestions;
  return sortSuggestedConnections(results).slice(0, input.limit);
}

function classifySuggestionResultStrength(
  suggestions: SuggestConnectionsResult["suggestions"]
): SuggestionResultStrength {
  if (suggestions.length === 0) {
    return "none";
  }

  return suggestions.some((suggestion) =>
    suggestion.reasons.some((reason) =>
      ["shared_industry", "shared_company", "shared_role_family"].includes(reason.code)
    )
  )
    ? "strong"
    : "weak_fallback";
}

function buildLookupOnlyResult(input: {
  state: "ambiguous" | "not_found";
  sourcePerson?: ProjectedPerson | null;
  options?: ProjectedPerson[];
}): SuggestConnectionsResult {
  return {
    mode: "sql_fallback",
    fallback_reason: null,
    freshness: {
      state: "unknown",
      as_of: new Date().toISOString(),
    },
    state: input.state,
    source_person: input.sourcePerson
      ? buildDisplayReadyConnectionPerson(input.sourcePerson)
      : null,
    suggestions: [],
    ...(input.options
      ? {
          disambiguation_options: input.options.map((person) =>
            buildDisplayReadyConnectionPerson(person)
          ),
        }
      : {}),
  };
}

function buildResolvedResult(input: {
  mode: "falkor" | "sql_fallback";
  fallbackReason: GraphFallbackReason | null;
  freshness: SuggestConnectionsFreshness;
  source: ProjectedPerson;
  results: ReturnType<typeof sortSuggestedConnections>;
  displayLimit: number;
}): SuggestConnectionsResult {
  const displaySuggestions = input.results
    .slice(0, input.displayLimit)
    .map((suggestion) => buildDisplayReadySuggestedConnection(suggestion));

  return {
    mode: input.mode,
    fallback_reason: input.fallbackReason,
    freshness: input.freshness,
    state: displaySuggestions.length > 0 ? "resolved" : "no_suggestions",
    source_person: buildDisplayReadyConnectionPerson(input.source),
    suggestions: displaySuggestions,
  };
}

export async function suggestConnections(input: {
  orgId: string;
  serviceSupabase: SupabaseClient;
  args: SuggestConnectionsArgs;
}): Promise<SuggestConnectionsResult> {
  const limit = clampSuggestionsLimit(input.args.limit);
  const displayLimit = Math.min(limit, CHAT_CONNECTION_SUGGESTION_LIMIT);
  const { orgId, serviceSupabase } = input;
  let resolvedSource: ProjectedPerson | null = null;
  let projectedPeopleForLookup: Map<string, ProjectedPerson> | null = null;
  const organizationName = await loadOrganizationName(serviceSupabase, orgId);
  const scoringContext: ConnectionScoringContext = {
    genericCompanyValues: ["TeamNetwork", normalizeConnectionText(organizationName)],
  };

  if (input.args.person_query) {
    projectedPeopleForLookup = await loadProjectedPeople(serviceSupabase, orgId);
    const resolution = resolveSourceFromQuery(projectedPeopleForLookup, input.args.person_query);

    if (resolution.state === "not_found") {
      return buildLookupOnlyResult({ state: "not_found" });
    }

    if (resolution.state === "ambiguous") {
      return buildLookupOnlyResult({
        state: "ambiguous",
        options: resolution.options,
      });
    }

    resolvedSource = resolution.source;
  } else {
    const { memberRows, alumniRows } = await fetchSourceWithComplement(
      serviceSupabase,
      orgId,
      input.args
    );

    const source = buildSourcePerson({ memberRows, alumniRows });
    if (!source) {
      throw new SuggestConnectionsLookupError("Person not found");
    }

    resolvedSource = source;
  }

  if (!resolvedSource) {
    throw new SuggestConnectionsLookupError("Person not found");
  }

  const projectedPeople = projectedPeopleForLookup
    ? projectedPeopleForLookup
    : await loadProjectedPeople(serviceSupabase, orgId);
  const projectedSource =
    projectedPeople.get(`${orgId}:${resolvedSource.personKey}`) ?? resolvedSource;

  async function computeSqlResult(
    fallbackReason: GraphFallbackReason | null,
    freshness: SuggestConnectionsFreshness
  ): Promise<SuggestConnectionsResult> {
    const results = scoreProjectedCandidates({
      source: projectedSource,
      allPeople: projectedPeople.values(),
      candidates: projectedPeople.values(),
      limit,
      scoringContext,
    });
    return buildResolvedResult({
      mode: "sql_fallback",
      fallbackReason,
      freshness,
      source: projectedSource,
      results,
      displayLimit,
    });
  }

  function finalizeResult(result: SuggestConnectionsResult) {
    if (result.state === "resolved") {
      recordSuggestedCandidates({
        orgId,
        personIds: result.suggestions.slice(0, 3).map((suggestion) => suggestion.person_id),
      });
    }
    recordSuggestionExecution({
      orgId,
      mode: result.mode,
      fallbackReason: result.fallback_reason,
      freshnessState: result.freshness.state,
      resultStrength: classifySuggestionResultStrength(result.suggestions),
    });
    return result;
  }

  // The people-graph is served from Postgres (mentorship_pairs + member/alumni
  // projections), not a separate graph store, so suggestions always read live
  // SQL — the result is therefore always current.
  return finalizeResult(await computeSqlResult(null, buildFreshnessFromNow()));
}

export function getSuggestionObservabilityByOrg(orgId: string) {
  return getSuggestionObservabilitySnapshot(orgId);
}
