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
  GRAPH_STALE_AFTER_SECONDS,
  normalizeConnectionText,
  sortSuggestedConnections,
  type CandidateQualificationCode,
  type ConnectionScoringContext,
  type SuggestConnectionsFreshness,
  type SuggestConnectionsResult,
} from "@/lib/falkordb/scoring";
import {
  FalkorQueryError,
  FalkorUnavailableError,
  falkorClient,
  type FalkorQueryClient,
} from "@/lib/falkordb/client";
import {
  getSuggestedCandidateExposureCounts,
  getSuggestionObservabilitySnapshot,
  recordSuggestedCandidates,
  recordSuggestionExecution,
  type GraphFallbackReason,
  type SuggestionResultStrength,
} from "@/lib/falkordb/telemetry";
import { MAX_GRAPH_SYNC_ATTEMPTS, readOptionalString } from "@/lib/falkordb/utils";
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

interface GraphSuggestionRow extends Record<string, unknown> {
  personKey: string;
  personType: "member" | "alumni";
  personId: string;
  memberId: string | null;
  alumniId: string | null;
  name: string;
  email: string | null;
  userId: string | null;
  role: string | null;
  major: string | null;
  currentCompany: string | null;
  industry: string | null;
  roleFamily: string | null;
  graduationYear: number | null;
  currentCity: string | null;
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

function buildFreshnessFromReason(
  state: SuggestConnectionsFreshness["state"],
  reason: string,
  existing?: SuggestConnectionsFreshness
): SuggestConnectionsFreshness {
  return {
    state,
    as_of: existing?.as_of ?? new Date().toISOString(),
    lag_seconds: existing?.lag_seconds,
    reason,
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
  if (!runnerUp || topMatch.score - runnerUp.score >= MIN_FUZZY_AUTORESOLVE_MARGIN) {
    return { state: "resolved", source: topMatch.person };
  }

  return {
    state: "ambiguous",
    options: fuzzyMatches.map((match) => match.person),
  };
}

async function fetchGraphFreshness(
  serviceSupabase: SupabaseClient,
  orgId: string
): Promise<SuggestConnectionsFreshness> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from("graph_sync_queue")
      .select("created_at")
      .eq("org_id", orgId)
      .is("processed_at", null)
      .lt("attempts", MAX_GRAPH_SYNC_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) {
      return buildFreshnessFromReason("degraded", "queue_lookup_failed");
    }

    const oldestPending = readOptionalString((data as Array<{ created_at?: unknown }> | null)?.[0]?.created_at);
    if (!oldestPending) {
      return buildFreshnessFromNow();
    }

    const lagSeconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(oldestPending).getTime()) / 1_000)
    );

    if (lagSeconds > GRAPH_STALE_AFTER_SECONDS) {
      return {
        state: "stale",
        as_of: oldestPending,
        lag_seconds: lagSeconds,
        reason: "pending_queue",
      };
    }

    return {
      state: "fresh",
      as_of: oldestPending,
      lag_seconds: lagSeconds,
    };
  } catch {
    return buildFreshnessFromReason("degraded", "queue_lookup_failed");
  }
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
    source_person: input.sourcePerson ? buildDisplayReadyConnectionPerson(input.sourcePerson) : null,
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

function graphRowToProjectedPerson(
  row: GraphSuggestionRow,
  orgId: string
): ProjectedPerson | null {
  if (!row.personKey || !row.personType || !row.personId || !row.name) {
    return null;
  }

  return {
    orgId,
    personKey: row.personKey,
    personType: row.personType,
    personId: row.personId,
    memberId: row.memberId ?? (row.personType === "member" ? row.personId : null),
    alumniId: row.alumniId ?? (row.personType === "alumni" ? row.personId : null),
    userId: row.userId ?? null,
    name: row.name,
    email: row.email ?? null,
    role: row.role ?? null,
    major: row.major ?? null,
    currentCompany: row.currentCompany ?? null,
    industry: row.industry ?? null,
    roleFamily: row.roleFamily ?? null,
    graduationYear: row.graduationYear ?? null,
    currentCity: row.currentCity ?? null,
  };
}

function candidateIdentityTokens(candidate: ProjectedPerson) {
  const tokens = new Set<string>();

  if (candidate.userId) {
    tokens.add(`user:${candidate.userId}`);
  }
  if (candidate.memberId) {
    tokens.add(`member:${candidate.memberId}`);
  }
  if (candidate.alumniId) {
    tokens.add(`alumni:${candidate.alumniId}`);
  }
  tokens.add(`person:${candidate.personKey}`);

  return tokens;
}

function isCanonicalCandidate(candidate: ProjectedPerson) {
  return candidate.personKey.startsWith("user:");
}

function candidateStrength(candidate: ProjectedPerson) {
  let score = 0;
  if (candidate.userId) score += 4;
  if (candidate.memberId) score += 2;
  if (candidate.alumniId) score += 2;
  if (isCanonicalCandidate(candidate)) score += 3;
  return score;
}

function preferredCandidate(left: ProjectedPerson, right: ProjectedPerson) {
  const leftScore = candidateStrength(left);
  const rightScore = candidateStrength(right);

  if (rightScore !== leftScore) {
    return rightScore > leftScore ? right : left;
  }

  if (right.personKey !== left.personKey) {
    return right.personKey.localeCompare(left.personKey) < 0 ? right : left;
  }

  return right.personId.localeCompare(left.personId) < 0 ? right : left;
}

function dedupeGraphCandidates(entries: ProjectedPerson[]) {
  const groups: Array<{
    candidate: ProjectedPerson;
    tokens: Set<string>;
  }> = [];

  for (const candidate of entries) {
    const entryTokens = candidateIdentityTokens(candidate);
    const matchingIndexes = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => [...entryTokens].some((token) => group.tokens.has(token)))
      .map(({ index }) => index);

    if (matchingIndexes.length === 0) {
      groups.push({
        candidate,
        tokens: entryTokens,
      });
      continue;
    }

    const baseIndex = matchingIndexes[0];
    const baseGroup = groups[baseIndex];
    baseGroup.candidate = preferredCandidate(baseGroup.candidate, candidate);
    for (const token of entryTokens) {
      baseGroup.tokens.add(token);
    }

    for (const index of matchingIndexes.slice(1).reverse()) {
      const group = groups[index];
      baseGroup.candidate = preferredCandidate(baseGroup.candidate, group.candidate);
      for (const token of group.tokens) {
        baseGroup.tokens.add(token);
      }
      groups.splice(index, 1);
    }
  }

  return groups.map(({ candidate }) => candidate);
}

function resolveUnavailableFallbackReason(graphClient: FalkorQueryClient): GraphFallbackReason {
  return graphClient.getUnavailableReason?.() ?? "unavailable";
}

async function fetchGraphSuggestions(input: {
  orgId: string;
  source: ProjectedPerson;
  allPeople: Iterable<ProjectedPerson>;
  limit: number;
  graphClient: FalkorQueryClient;
  scoringContext?: ConnectionScoringContext;
}) {
  const candidateRows = await input.graphClient.query<GraphSuggestionRow>(
    input.orgId,
    `
      MATCH (source:Person {personKey: $sourceKey})
      MATCH (candidate:Person)
      WHERE candidate.personKey <> source.personKey
      RETURN
        candidate.personKey AS personKey,
        candidate.personType AS personType,
        candidate.personId AS personId,
        candidate.memberId AS memberId,
        candidate.alumniId AS alumniId,
        candidate.name AS name,
        candidate.email AS email,
        candidate.userId AS userId,
        candidate.role AS role,
        candidate.major AS major,
        candidate.currentCompany AS currentCompany,
        candidate.industry AS industry,
        candidate.roleFamily AS roleFamily,
        candidate.graduationYear AS graduationYear,
        candidate.currentCity AS currentCity
    `,
    { sourceKey: input.source.personKey }
  );

  const candidates = dedupeGraphCandidates(
    candidateRows
      .map((row) => graphRowToProjectedPerson(row, input.orgId))
      .filter((candidate): candidate is ProjectedPerson => candidate !== null)
  );

  return scoreProjectedCandidates({
    source: input.source,
    allPeople: input.allPeople,
    candidates,
    limit: input.limit,
    scoringContext: input.scoringContext,
  });
}

export async function suggestConnections(input: {
  orgId: string;
  serviceSupabase: SupabaseClient;
  args: SuggestConnectionsArgs;
  graphClient?: FalkorQueryClient;
}): Promise<SuggestConnectionsResult> {
  const graphClient = input.graphClient ?? falkorClient;
  const limit = clampSuggestionsLimit(input.args.limit);
  const displayLimit = Math.min(limit, CHAT_CONNECTION_SUGGESTION_LIMIT);
  const { orgId, serviceSupabase } = input;
  let resolvedSource: ProjectedPerson | null = null;
  let projectedPeopleForLookup: Map<string, ProjectedPerson> | null = null;
  const organizationName = await loadOrganizationName(serviceSupabase, orgId);
  const scoringContext: ConnectionScoringContext = {
    genericCompanyValues: [
      "TeamNetwork",
      normalizeConnectionText(organizationName),
    ],
  };

  if (input.args.person_query) {
    projectedPeopleForLookup = await loadProjectedPeople(serviceSupabase, orgId);
    const resolution = resolveSourceFromQuery(
      projectedPeopleForLookup,
      input.args.person_query
    );

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
  const projectedSource = projectedPeople.get(`${orgId}:${resolvedSource.personKey}`) ?? resolvedSource;

  async function computeSqlFallback(
    fallbackReason: GraphFallbackReason,
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

  if (!graphClient.isAvailable()) {
    const fallbackReason = resolveUnavailableFallbackReason(graphClient);
    return finalizeResult(
      await computeSqlFallback(
        fallbackReason,
        buildFreshnessFromReason("unknown", fallbackReason)
      )
    );
  }

  const freshness = await fetchGraphFreshness(serviceSupabase, orgId);

  try {
    const graphResults = await fetchGraphSuggestions({
      orgId,
      source: projectedSource,
      allPeople: projectedPeople.values(),
      limit,
      graphClient,
      scoringContext,
    });

    return finalizeResult({
      mode: "falkor",
      fallback_reason: null,
      freshness,
      state: graphResults.length > 0 ? "resolved" : "no_suggestions",
      source_person: buildDisplayReadyConnectionPerson(projectedSource),
      suggestions: graphResults
        .slice(0, displayLimit)
        .map((suggestion) => buildDisplayReadySuggestedConnection(suggestion)),
    });
  } catch (error) {
    if (!(error instanceof FalkorUnavailableError) && !(error instanceof FalkorQueryError)) {
      console.warn("[suggest-connections] graph path failed:", error);
    }

    const fallbackReason: GraphFallbackReason =
      error instanceof FalkorUnavailableError ? "unavailable" : "query_failure";

    return finalizeResult(
      await computeSqlFallback(
        fallbackReason,
        buildFreshnessFromReason(
          fallbackReason === "query_failure" ? "degraded" : "unknown",
          fallbackReason,
          freshness
        )
      )
    );
  }
}

export function getSuggestionObservabilityByOrg(orgId: string) {
  return getSuggestionObservabilitySnapshot(orgId);
}
