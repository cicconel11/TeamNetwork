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
import { MAX_GRAPH_SYNC_ATTEMPTS, readOptionalString } from "@/lib/falkordb/utils";

export interface SuggestConnectionsArgs {
  person_type: "member" | "alumni";
  person_id: string;
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
  name: string;
  userId: string | null;
  role: string | null;
  major: string | null;
  currentCompany: string | null;
  industry: string | null;
  graduationYear: number | null;
  currentCity: string | null;
  mentorshipDistance: number | null;
}

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
      return buildFreshnessFromNow();
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
      };
    }

    return buildFreshnessFromNow();
  } catch {
    return buildFreshnessFromNow();
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
    memberId: row.personType === "member" ? row.personId : null,
    alumniId: row.personType === "alumni" ? row.personId : null,
    userId: row.userId ?? null,
    name: row.name,
    role: row.role ?? null,
    major: row.major ?? null,
    currentCompany: row.currentCompany ?? null,
    industry: row.industry ?? null,
    graduationYear: row.graduationYear ?? null,
    currentCity: row.currentCity ?? null,
  };
}

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
          candidate.name AS name,
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
      const distanceQueryResults = await Promise.all([
        input.graphClient.query<{ personKey: string; distance: number }>(
          input.orgId,
          `
            MATCH (source:Person {personKey: $sourceKey})-[:MENTORS]->(candidate:Person)
            WHERE candidate.personKey <> $sourceKey
            RETURN candidate.personKey AS personKey, 1 AS distance
          `,
          { sourceKey: input.source.personKey }
        ),
        input.graphClient.query<{ personKey: string; distance: number }>(
          input.orgId,
          `
            MATCH (source:Person {personKey: $sourceKey})<-[:MENTORS]-(candidate:Person)
            WHERE candidate.personKey <> $sourceKey
            RETURN candidate.personKey AS personKey, 1 AS distance
          `,
          { sourceKey: input.source.personKey }
        ),
        input.graphClient.query<{ personKey: string; distance: number }>(
          input.orgId,
          `
            MATCH (source:Person {personKey: $sourceKey})-[:MENTORS]->(:Person)-[:MENTORS]->(candidate:Person)
            WHERE candidate.personKey <> $sourceKey
            RETURN candidate.personKey AS personKey, 2 AS distance
          `,
          { sourceKey: input.source.personKey }
        ),
        input.graphClient.query<{ personKey: string; distance: number }>(
          input.orgId,
          `
            MATCH (source:Person {personKey: $sourceKey})<-[:MENTORS]-(:Person)<-[:MENTORS]-(candidate:Person)
            WHERE candidate.personKey <> $sourceKey
            RETURN candidate.personKey AS personKey, 2 AS distance
          `,
          { sourceKey: input.source.personKey }
        ),
        input.graphClient.query<{ personKey: string; distance: number }>(
          input.orgId,
          `
            MATCH (source:Person {personKey: $sourceKey})<-[:MENTORS]-(:Person)-[:MENTORS]->(candidate:Person)
            WHERE candidate.personKey <> $sourceKey
            RETURN candidate.personKey AS personKey, 2 AS distance
          `,
          { sourceKey: input.source.personKey }
        ),
        input.graphClient.query<{ personKey: string; distance: number }>(
          input.orgId,
          `
            MATCH (source:Person {personKey: $sourceKey})-[:MENTORS]->(:Person)<-[:MENTORS]-(candidate:Person)
            WHERE candidate.personKey <> $sourceKey
            RETURN candidate.personKey AS personKey, 2 AS distance
          `,
          { sourceKey: input.source.personKey }
        ),
      ]);
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

  const suggestions = candidatesWithDistance
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
  const { orgId, serviceSupabase } = input;

  const { memberRows, alumniRows } = await fetchSourceWithComplement(
    serviceSupabase,
    orgId,
    input.args
  );

  const source = buildSourcePerson({ memberRows, alumniRows });
  if (!source) {
    throw new SuggestConnectionsLookupError("Person not found");
  }

  const resolvedSource: ProjectedPerson = source;

  async function computeSqlFallback(): Promise<SuggestConnectionsResult> {
    const [projectedPeople, mentorshipDistances] = await Promise.all([
      loadProjectedPeople(serviceSupabase, orgId),
      fetchMentorshipDistances(serviceSupabase, orgId, resolvedSource),
    ]);
    const results = scoreProjectedCandidates({
      source: projectedPeople.get(`${orgId}:${resolvedSource.personKey}`) ?? resolvedSource,
      candidates: projectedPeople.values(),
      mentorshipDistances,
      limit,
    });
    return { mode: "sql_fallback", freshness: buildFreshnessFromNow(), results };
  }

  if (!graphClient.isAvailable()) {
    return computeSqlFallback();
  }

  try {
    const [freshness, graphResults] = await Promise.all([
      fetchGraphFreshness(serviceSupabase, orgId),
      fetchGraphSuggestions({
        orgId,
        source: resolvedSource,
        limit,
        graphClient,
      }),
    ]);

    return {
      mode: "falkor",
      freshness,
      results: graphResults,
    };
  } catch (error) {
    if (!(error instanceof FalkorUnavailableError) && !(error instanceof FalkorQueryError)) {
      console.warn("[suggest-connections] graph path failed:", error);
    }

    return computeSqlFallback();
  }
}
