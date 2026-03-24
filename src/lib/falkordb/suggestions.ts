import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALUMNI_PERSON_SELECT,
  buildPersonKey,
  buildProjectedPeople,
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

export interface SuggestConnectionsArgs {
  person_type: "member" | "alumni";
  person_id: string;
  limit?: number;
}

interface MentorshipDistanceRow {
  user_id: string;
  distance: number;
}

interface GraphSuggestionRow {
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

function normalizePayloadDate(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
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
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) {
      return buildFreshnessFromNow();
    }

    const oldestPending = normalizePayloadDate((data as Array<{ created_at?: unknown }> | null)?.[0]?.created_at);
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

function graphRowToProjectedPerson(row: GraphSuggestionRow): ProjectedPerson | null {
  if (!row.personKey || !row.personType || !row.personId || !row.name) {
    return null;
  }

  return {
    orgId: "",
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
  const sourceRows = await input.graphClient.query<{ personKey: string }>(
    input.orgId,
    "MATCH (source:Person {personKey: $sourceKey}) RETURN source.personKey AS personKey LIMIT 1",
    { sourceKey: input.source.personKey }
  );

  if (sourceRows.length === 0) {
    throw new FalkorQueryError("Source person is not present in Falkor");
  }

  const rows = await input.graphClient.query<GraphSuggestionRow>(
    input.orgId,
    `
      MATCH (source:Person {personKey: $sourceKey})
      MATCH (candidate:Person)
      WHERE candidate.personKey <> source.personKey
      OPTIONAL MATCH p = shortestPath((source)-[:MENTORS*1..2]-(candidate))
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
        candidate.currentCity AS currentCity,
        CASE WHEN p IS NULL THEN NULL ELSE length(p) END AS mentorshipDistance
    `,
    {
      sourceKey: input.source.personKey,
    }
  );

  const candidatesWithDistance = rows
    .map((row) => ({
      candidate: graphRowToProjectedPerson(row),
      mentorshipDistance:
        typeof row.mentorshipDistance === "number" ? row.mentorshipDistance : null,
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

  const [sourceRow, projectedPeople] = await Promise.all([
    fetchSourceRow(input.serviceSupabase, input.orgId, input.args),
    loadProjectedPeople(input.serviceSupabase, input.orgId),
  ]);

  if (!sourceRow) {
    throw new SuggestConnectionsLookupError("Person not found");
  }

  const sourceKey =
    input.args.person_type === "member"
      ? buildPersonKey("members", sourceRow.id, sourceRow.user_id)
      : buildPersonKey("alumni", sourceRow.id, sourceRow.user_id);

  const source = projectedPeople.get(sourceKey);
  if (!source) {
    throw new SuggestConnectionsLookupError("Person is not eligible for suggestions");
  }

  const mentorshipDistances = await fetchMentorshipDistances(
    input.serviceSupabase,
    input.orgId,
    source
  );

  const sqlFallbackResults = scoreProjectedCandidates({
    source,
    candidates: projectedPeople.values(),
    mentorshipDistances,
    limit,
  });

  if (!graphClient.isAvailable()) {
    return {
      mode: "sql_fallback",
      freshness: buildFreshnessFromNow(),
      results: sqlFallbackResults,
    };
  }

  try {
    const [freshness, graphResults] = await Promise.all([
      fetchGraphFreshness(input.serviceSupabase, input.orgId),
      fetchGraphSuggestions({
        orgId: input.orgId,
        source,
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

    return {
      mode: "sql_fallback",
      freshness: buildFreshnessFromNow(),
      results: sqlFallbackResults,
    };
  }
}
