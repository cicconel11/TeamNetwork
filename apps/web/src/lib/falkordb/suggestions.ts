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
  buildDisplayReadyConnectionPerson,
  buildDisplayReadySuggestedConnection,
  buildSuggestionForCandidate,
  clampSuggestionsLimit,
  GRAPH_STALE_AFTER_SECONDS,
  sortSuggestedConnections,
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
  getSuggestionObservabilitySnapshot,
  recordSuggestionExecution,
  type GraphFallbackReason,
} from "@/lib/falkordb/telemetry";
import { MAX_GRAPH_SYNC_ATTEMPTS, readOptionalString } from "@/lib/falkordb/utils";

export interface SuggestConnectionsArgs {
  person_type?: "member" | "alumni";
  person_id?: string;
  person_query?: string;
  limit?: number;
}

interface MentorshipDistanceRow {
  user_id: string;
  distance: number;
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
  graduationYear: number | null;
  currentCity: string | null;
  mentorshipDistance: number | null;
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

function normalizeLookupValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveSourceFromQuery(
  projectedPeople: Map<string, ProjectedPerson>,
  personQuery: string
):
  | { state: "resolved"; source: ProjectedPerson }
  | { state: "ambiguous"; options: ProjectedPerson[] }
  | { state: "not_found" } {
  const normalizedQuery = normalizeLookupValue(personQuery);
  const matches = [...projectedPeople.values()].filter((person) => {
    const normalizedName = normalizeLookupValue(person.name);
    const normalizedEmail = person.email ? normalizeLookupValue(person.email) : null;
    return normalizedName === normalizedQuery || normalizedEmail === normalizedQuery;
  });

  if (matches.length === 0) {
    return { state: "not_found" };
  }

  matches.sort((left, right) => {
    const leftName = left.name.localeCompare(right.name);
    if (leftName !== 0) return leftName;
    return left.personId.localeCompare(right.personId);
  });

  if (matches.length > 1) {
    return { state: "ambiguous", options: matches };
  }

  return { state: "resolved", source: matches[0] };
}

async function fetchMentorshipDistances(
  serviceSupabase: SupabaseClient,
  orgId: string,
  source: ProjectedPerson
) {
  if (!source.userId) {
    return new Map<string, number>();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (serviceSupabase as any).rpc("get_mentorship_distances", {
    p_org_id: orgId,
    p_user_id: source.userId,
  });

  if (error) {
    throw new Error("Failed to load mentorship distances");
  }

  const distances = new Map<string, number>();
  for (const row of (data ?? []) as MentorshipDistanceRow[]) {
    if (row.user_id && typeof row.distance === "number") {
      distances.set(row.user_id, row.distance);
    }
  }
  return distances;
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

function scoreProjectedCandidates(input: {
  source: ProjectedPerson;
  candidates: Iterable<ProjectedPerson>;
  mentorshipDistances: Map<string, number>;
  limit: number;
}) {
  const suggestions = [];

  for (const candidate of input.candidates) {
    const mentorshipDistance =
      candidate.userId ? input.mentorshipDistances.get(candidate.userId) ?? null : null;
    const suggestion = buildSuggestionForCandidate({
      source: input.source,
      candidate,
      mentorshipDistance,
    });
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  return sortSuggestedConnections(suggestions).slice(0, input.limit);
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

function mergeMentorshipDistance(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function dedupeGraphCandidates(
  entries: Array<{ candidate: ProjectedPerson; mentorshipDistance: number | null }>
) {
  const groups: Array<{
    candidate: ProjectedPerson;
    mentorshipDistance: number | null;
    tokens: Set<string>;
  }> = [];

  for (const entry of entries) {
    const entryTokens = candidateIdentityTokens(entry.candidate);
    const matchingIndexes = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => [...entryTokens].some((token) => group.tokens.has(token)))
      .map(({ index }) => index);

    if (matchingIndexes.length === 0) {
      groups.push({
        candidate: entry.candidate,
        mentorshipDistance: entry.mentorshipDistance,
        tokens: entryTokens,
      });
      continue;
    }

    const baseIndex = matchingIndexes[0];
    const baseGroup = groups[baseIndex];
    baseGroup.candidate = preferredCandidate(baseGroup.candidate, entry.candidate);
    baseGroup.mentorshipDistance = mergeMentorshipDistance(
      baseGroup.mentorshipDistance,
      entry.mentorshipDistance
    );
    for (const token of entryTokens) {
      baseGroup.tokens.add(token);
    }

    for (const index of matchingIndexes.slice(1).reverse()) {
      const group = groups[index];
      baseGroup.candidate = preferredCandidate(baseGroup.candidate, group.candidate);
      baseGroup.mentorshipDistance = mergeMentorshipDistance(
        baseGroup.mentorshipDistance,
        group.mentorshipDistance
      );
      for (const token of group.tokens) {
        baseGroup.tokens.add(token);
      }
      groups.splice(index, 1);
    }
  }

  return groups.map(({ candidate, mentorshipDistance }) => ({
    candidate,
    mentorshipDistance,
  }));
}

function resolveUnavailableFallbackReason(graphClient: FalkorQueryClient): GraphFallbackReason {
  return graphClient.getUnavailableReason?.() ?? "unavailable";
}

const MENTORSHIP_DISTANCE_PATTERNS: ReadonlyArray<{ matchClause: string; distance: number }> = [
  { matchClause: "(source:Person {personKey: $sourceKey})-[:MENTORS]->(candidate:Person)", distance: 1 },
  { matchClause: "(source:Person {personKey: $sourceKey})<-[:MENTORS]-(candidate:Person)", distance: 1 },
  { matchClause: "(source:Person {personKey: $sourceKey})-[:MENTORS]->(:Person)-[:MENTORS]->(candidate:Person)", distance: 2 },
  { matchClause: "(source:Person {personKey: $sourceKey})<-[:MENTORS]-(:Person)<-[:MENTORS]-(candidate:Person)", distance: 2 },
  { matchClause: "(source:Person {personKey: $sourceKey})<-[:MENTORS]-(:Person)-[:MENTORS]->(candidate:Person)", distance: 2 },
  { matchClause: "(source:Person {personKey: $sourceKey})-[:MENTORS]->(:Person)<-[:MENTORS]-(candidate:Person)", distance: 2 },
];

async function fetchGraphSuggestions(input: {
  orgId: string;
  source: ProjectedPerson;
  limit: number;
  graphClient: FalkorQueryClient;
}) {
  // FalkorDB has partial shortestPath support, and the SQL fallback treats
  // mentorship edges as undirected up to depth 2. Query the direct and
  // second-degree shapes explicitly so Falkor mode preserves the same
  // semantics without relying on unsupported Cypher forms.
  const [candidateRows, distanceRows] = await Promise.all([
    input.graphClient.query<GraphSuggestionRow>(
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
          candidate.graduationYear AS graduationYear,
          candidate.currentCity AS currentCity
      `,
      { sourceKey: input.source.personKey }
    ),
    (async () => {
      const distanceQueryResults = await Promise.all(
        MENTORSHIP_DISTANCE_PATTERNS.map(({ matchClause, distance }) =>
          input.graphClient.query<{ personKey: string; distance: number }>(
            input.orgId,
            `
              MATCH ${matchClause}
              WHERE candidate.personKey <> $sourceKey
              RETURN candidate.personKey AS personKey, ${distance} AS distance
            `,
            { sourceKey: input.source.personKey }
          )
        )
      );
      return distanceQueryResults.flat();
    })(),
  ]);

  const distanceMap = new Map<string, number>();
  for (const row of distanceRows) {
    if (row.personKey && typeof row.distance === "number") {
      const existing = distanceMap.get(row.personKey);
      if (existing === undefined || row.distance < existing) {
        distanceMap.set(row.personKey, row.distance);
      }
    }
  }

  const candidatesWithDistance = candidateRows
    .map((row) => ({
      candidate: graphRowToProjectedPerson(row, input.orgId),
      mentorshipDistance: distanceMap.get(row.personKey) ?? null,
    }))
    .filter(
      (entry): entry is { candidate: ProjectedPerson; mentorshipDistance: number | null } =>
        entry.candidate !== null
    );

  const suggestions = dedupeGraphCandidates(candidatesWithDistance)
    .map(({ candidate, mentorshipDistance }) =>
      buildSuggestionForCandidate({
        source: input.source,
        candidate,
        mentorshipDistance,
      })
    )
    .filter((suggestion): suggestion is NonNullable<typeof suggestion> => suggestion !== null);

  return sortSuggestedConnections(suggestions).slice(0, input.limit);
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

  async function computeSqlFallback(
    fallbackReason: GraphFallbackReason,
    freshness: SuggestConnectionsFreshness
  ): Promise<SuggestConnectionsResult> {
    const source = resolvedSource;
    if (!source) {
      throw new SuggestConnectionsLookupError("Person not found");
    }

    const [projectedPeople, mentorshipDistances] = await Promise.all([
      projectedPeopleForLookup
        ? Promise.resolve(projectedPeopleForLookup)
        : loadProjectedPeople(serviceSupabase, orgId),
      fetchMentorshipDistances(serviceSupabase, orgId, source),
    ]);
    const results = scoreProjectedCandidates({
      source: projectedPeople.get(`${orgId}:${source.personKey}`) ?? source,
      candidates: projectedPeople.values(),
      mentorshipDistances,
      limit,
    });
    return buildResolvedResult({
      mode: "sql_fallback",
      fallbackReason,
      freshness,
      source: projectedPeople.get(`${orgId}:${source.personKey}`) ?? source,
      results,
      displayLimit,
    });
  }

  function finalizeResult(result: SuggestConnectionsResult) {
    recordSuggestionExecution({
      orgId,
      mode: result.mode,
      fallbackReason: result.fallback_reason,
      freshnessState: result.freshness.state,
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
      source: resolvedSource,
      limit,
      graphClient,
    });

    return finalizeResult({
      mode: "falkor",
      fallback_reason: null,
      freshness,
      state: graphResults.length > 0 ? "resolved" : "no_suggestions",
      source_person: buildDisplayReadyConnectionPerson(resolvedSource),
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
