import type { SupabaseClient } from "@supabase/supabase-js";
import { falkorClient, type FalkorQueryClient } from "@/lib/falkordb/client";
import {
  ALUMNI_PERSON_SELECT,
  MEMBER_PERSON_SELECT,
  MENTORSHIP_PAIR_SELECT,
  buildProjectedPeople,
  isActiveMentorshipPairRow,
  type AlumniPersonRow,
  type MemberPersonRow,
  type MentorshipPairSyncRow,
} from "@/lib/falkordb/people";
import { toErrorMessage } from "@/lib/falkordb/utils";

/** Cap on how many offending identifiers we surface per category in a report. */
const SAMPLE_CAP = 50;
/** Page size for paging through Supabase source rows. */
const PAGE_SIZE = 1000;

export interface GraphDriftReport {
  orgId: string;
  /** ok = graph matches Supabase truth; drift = divergence found; degraded = could not compare. */
  state: "ok" | "drift" | "degraded";
  reason: string | null;
  nodes: {
    expected: number;
    actual: number;
    /** Expected person keys with no node in the graph. */
    missingKeys: string[];
    /** Graph nodes with no corresponding live Supabase row. */
    orphanKeys: string[];
    /**
     * Graph nodes keyed `member:`/`alumni:` whose underlying row actually has a
     * user_id — they should have collapsed to a `user:` node. This is the
     * userless-key signature that silently breaks edge formation.
     */
    misKeyedNodeKeys: string[];
  };
  edges: {
    expected: number;
    actual: number;
    /** Expected `mentor->mentee` edges absent from the graph. */
    missingEdges: string[];
    /** Graph edges with no corresponding active mentorship pair. */
    orphanEdges: string[];
  };
  /** True when source rows exceeded the scan budget and the comparison is partial. */
  truncated: boolean;
}

interface ActualGraph {
  nodeKeys: Set<string>;
  edges: Set<string>;
}

function sample(values: Iterable<string>): string[] {
  const out: string[] = [];
  for (const value of values) {
    out.push(value);
    if (out.length >= SAMPLE_CAP) break;
  }
  return out;
}

function edgeKey(mentorKey: string, menteeKey: string) {
  return `${mentorKey}->${menteeKey}`;
}

async function fetchAllRows<T>(
  serviceSupabase: SupabaseClient,
  table: "members" | "alumni" | "mentorship_pairs",
  select: string,
  orgId: string
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let from = 0;

  // Hard ceiling so a pathological org cannot make the checker unbounded.
  const MAX_ROWS = PAGE_SIZE * 20;

  while (from < MAX_ROWS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceSupabase as any)
      .from(table)
      .select(select)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to load ${table} for drift check: ${toErrorMessage(error)}`);
    }

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return { rows, truncated: false };
    }
    from += PAGE_SIZE;
  }

  return { rows, truncated: true };
}

async function loadActualGraph(
  graphClient: FalkorQueryClient,
  orgId: string
): Promise<ActualGraph> {
  const nodeRows = await graphClient.query<{ personKey: string }>(
    orgId,
    "MATCH (p:Person) RETURN p.personKey AS personKey"
  );
  const edgeRows = await graphClient.query<{ mentorKey: string; menteeKey: string }>(
    orgId,
    "MATCH (a:Person)-[:MENTORS]->(b:Person) RETURN a.personKey AS mentorKey, b.personKey AS menteeKey"
  );

  const nodeKeys = new Set<string>();
  for (const row of nodeRows) {
    if (typeof row.personKey === "string" && row.personKey.length > 0) {
      nodeKeys.add(row.personKey);
    }
  }

  const edges = new Set<string>();
  for (const row of edgeRows) {
    if (typeof row.mentorKey === "string" && typeof row.menteeKey === "string") {
      edges.add(edgeKey(row.mentorKey, row.menteeKey));
    }
  }

  return { nodeKeys, edges };
}

function degraded(orgId: string, reason: string): GraphDriftReport {
  return {
    orgId,
    state: "degraded",
    reason,
    nodes: { expected: 0, actual: 0, missingKeys: [], orphanKeys: [], misKeyedNodeKeys: [] },
    edges: { expected: 0, actual: 0, missingEdges: [], orphanEdges: [] },
    truncated: false,
  };
}

/**
 * Compare the FalkorDB people-graph for an org against Supabase truth and report
 * divergence: missing/orphan nodes, missing/orphan mentorship edges, and the
 * userless-key signature that drops edges. Read-only — never mutates the graph.
 */
export async function checkGraphDrift(
  serviceSupabase: SupabaseClient,
  orgId: string,
  graphClient: FalkorQueryClient = falkorClient
): Promise<GraphDriftReport> {
  if (!graphClient.isAvailable()) {
    return degraded(orgId, graphClient.getUnavailableReason?.() ?? "unavailable");
  }

  let members: MemberPersonRow[];
  let alumni: AlumniPersonRow[];
  let pairs: MentorshipPairSyncRow[];
  let truncated = false;

  try {
    const [memberResult, alumniResult, pairResult] = await Promise.all([
      fetchAllRows<MemberPersonRow>(serviceSupabase, "members", MEMBER_PERSON_SELECT, orgId),
      fetchAllRows<AlumniPersonRow>(serviceSupabase, "alumni", ALUMNI_PERSON_SELECT, orgId),
      fetchAllRows<MentorshipPairSyncRow>(
        serviceSupabase,
        "mentorship_pairs",
        MENTORSHIP_PAIR_SELECT,
        orgId
      ),
    ]);
    members = memberResult.rows;
    alumni = alumniResult.rows;
    pairs = pairResult.rows;
    truncated = memberResult.truncated || alumniResult.truncated || pairResult.truncated;
  } catch (error) {
    return degraded(orgId, toErrorMessage(error, "source_load_failed"));
  }

  let actual: ActualGraph;
  try {
    actual = await loadActualGraph(graphClient, orgId);
  } catch (error) {
    return degraded(orgId, toErrorMessage(error, "graph_query_failed"));
  }

  // Expected nodes: canonical projected people for this org.
  const projected = buildProjectedPeople({ members, alumni });
  const expectedNodeKeys = new Set<string>();
  for (const person of projected.values()) {
    expectedNodeKeys.add(person.personKey);
  }

  // user_ids that have at least one active profile row — used to detect
  // mis-keyed standalone nodes (member:/alumni: that should be user:).
  const memberIdsWithUser = new Map<string, string | null>();
  for (const member of members) {
    memberIdsWithUser.set(member.id, member.user_id);
  }
  const alumniIdsWithUser = new Map<string, string | null>();
  for (const row of alumni) {
    alumniIdsWithUser.set(row.id, row.user_id);
  }

  const missingKeys: string[] = [];
  for (const key of expectedNodeKeys) {
    if (!actual.nodeKeys.has(key)) missingKeys.push(key);
  }

  const orphanKeys: string[] = [];
  const misKeyedNodeKeys: string[] = [];
  for (const key of actual.nodeKeys) {
    if (!expectedNodeKeys.has(key)) {
      orphanKeys.push(key);
    }
    if (key.startsWith("member:")) {
      const userId = memberIdsWithUser.get(key.slice("member:".length));
      if (userId) misKeyedNodeKeys.push(key);
    } else if (key.startsWith("alumni:")) {
      const userId = alumniIdsWithUser.get(key.slice("alumni:".length));
      if (userId) misKeyedNodeKeys.push(key);
    }
  }

  // Expected edges: active pairs whose endpoints both resolve to a user node.
  const expectedEdges = new Set<string>();
  for (const pair of pairs.filter(isActiveMentorshipPairRow)) {
    if (!pair.mentor_user_id || !pair.mentee_user_id) continue;
    expectedEdges.add(edgeKey(`user:${pair.mentor_user_id}`, `user:${pair.mentee_user_id}`));
  }

  const missingEdges: string[] = [];
  for (const edge of expectedEdges) {
    if (!actual.edges.has(edge)) missingEdges.push(edge);
  }

  const orphanEdges: string[] = [];
  for (const edge of actual.edges) {
    if (!expectedEdges.has(edge)) orphanEdges.push(edge);
  }

  const hasDrift =
    missingKeys.length > 0 ||
    orphanKeys.length > 0 ||
    misKeyedNodeKeys.length > 0 ||
    missingEdges.length > 0 ||
    orphanEdges.length > 0;

  return {
    orgId,
    state: hasDrift ? "drift" : "ok",
    reason: truncated ? "partial_scan" : null,
    nodes: {
      expected: expectedNodeKeys.size,
      actual: actual.nodeKeys.size,
      missingKeys: sample(missingKeys),
      orphanKeys: sample(orphanKeys),
      misKeyedNodeKeys: sample(misKeyedNodeKeys),
    },
    edges: {
      expected: expectedEdges.size,
      actual: actual.edges.size,
      missingEdges: sample(missingEdges),
      orphanEdges: sample(orphanEdges),
    },
    truncated,
  };
}
