/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../utils/supabaseStub.ts";
import { processGraphSyncQueue } from "../../src/lib/falkordb/sync.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

/**
 * Minimal in-memory FalkorDB stand-in that mirrors the real engine's MATCH
 * semantics: a MENTORS edge is only created when BOTH endpoint nodes already
 * exist (MATCH … MATCH … MERGE). This is what makes the "edge silently dropped"
 * failure mode reproducible in a unit test.
 */
function createInMemoryGraphClient() {
  const graphs = new Map<string, { nodes: Map<string, Record<string, unknown>>; edges: Set<string> }>();

  function ensureGraph(orgId: string) {
    const existing = graphs.get(orgId);
    if (existing) return existing;
    const created = { nodes: new Map<string, Record<string, unknown>>(), edges: new Set<string>() };
    graphs.set(orgId, created);
    return created;
  }

  const edgeKey = (from: string, to: string) => `${from}->${to}`;

  return {
    isAvailable: () => true,
    snapshot(orgId: string) {
      const graph = ensureGraph(orgId);
      return {
        nodes: [...graph.nodes.keys()].sort(),
        edges: [...graph.edges.values()].sort(),
      };
    },
    async query(orgId: string, cypher: string, params?: Record<string, unknown>) {
      const graph = ensureGraph(orgId);

      if (cypher.includes("DETACH DELETE person")) {
        const personKey = String(params?.personKey);
        graph.nodes.delete(personKey);
        for (const edge of [...graph.edges]) {
          if (edge.startsWith(`${personKey}->`) || edge.endsWith(`->${personKey}`)) {
            graph.edges.delete(edge);
          }
        }
        return [];
      }

      if (cypher.includes("SET person = $props")) {
        graph.nodes.set(String(params?.personKey), { ...(params?.props as Record<string, unknown>) });
        return [];
      }

      if (cypher.includes("MERGE (mentor)-[:MENTORS]->(mentee)")) {
        const mentorKey = String(params?.mentorKey);
        const menteeKey = String(params?.menteeKey);
        // Real engine: MATCH fails (and the edge is not created) unless both nodes exist.
        if (graph.nodes.has(mentorKey) && graph.nodes.has(menteeKey)) {
          graph.edges.add(edgeKey(mentorKey, menteeKey));
        }
        return [];
      }

      if (cypher.includes("DELETE edge")) {
        graph.edges.delete(edgeKey(String(params?.mentorKey), String(params?.menteeKey)));
        return [];
      }

      return [];
    },
  };
}

function seedPair(stub: ReturnType<typeof createSupabaseStub>) {
  stub.seed("members", [
    {
      id: "member-mentor",
      organization_id: ORG_ID,
      user_id: "mentor-user",
      status: "active",
      first_name: "Morgan",
      last_name: "Mentor",
      email: "mentor@example.com",
      role: "Captain",
      current_company: "Acme",
      graduation_year: 2020,
      deleted_at: null,
    },
    {
      id: "member-mentee",
      organization_id: ORG_ID,
      user_id: "mentee-user",
      status: "active",
      first_name: "Taylor",
      last_name: "Mentee",
      email: "mentee@example.com",
      role: "Member",
      current_company: "Beta",
      graduation_year: 2026,
      deleted_at: null,
    },
  ]);
  stub.seed("mentorship_pairs", [
    {
      id: "pair-1",
      organization_id: ORG_ID,
      mentor_user_id: "mentor-user",
      mentee_user_id: "mentee-user",
      status: "active",
      deleted_at: null,
    },
  ]);
  stub.registerRpc("increment_graph_sync_attempts", () => null);
}

// G2: the pair queue item is processed with NO preceding person items — the
// person nodes were never synced. The pre-fix code MATCHed `user:{id}` nodes
// that did not exist, so the edge was permanently dropped. The fix ensures the
// endpoint nodes exist before MERGE.
test("processGraphSyncQueue forms the edge when the pair item is processed before its person nodes exist", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();
  seedPair(stub);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    {
      id: "queue-pair-only",
      org_id: ORG_ID,
      source_table: "mentorship_pairs",
      source_id: "pair-1",
      action: "upsert",
      payload: {},
      attempts: 0,
    },
  ]);

  const stats = await processGraphSyncQueue(stub as any, { graphClient });

  assert.equal(stats.failed, 0);
  const snapshot = graphClient.snapshot(ORG_ID);
  assert.deepEqual(snapshot.nodes, ["user:mentee-user", "user:mentor-user"]);
  assert.deepEqual(snapshot.edges, ["user:mentor-user->user:mentee-user"]);
});

// Regression guard: the canonical in-order path still forms exactly one edge.
test("processGraphSyncQueue still forms the edge when person items precede the pair item", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();
  seedPair(stub);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    { id: "q-mentor", org_id: ORG_ID, source_table: "members", source_id: "member-mentor", action: "upsert", payload: {}, attempts: 0 },
    { id: "q-mentee", org_id: ORG_ID, source_table: "members", source_id: "member-mentee", action: "upsert", payload: {}, attempts: 0 },
    { id: "q-pair", org_id: ORG_ID, source_table: "mentorship_pairs", source_id: "pair-1", action: "upsert", payload: {}, attempts: 0 },
  ]);

  await processGraphSyncQueue(stub as any, { graphClient });

  const snapshot = graphClient.snapshot(ORG_ID);
  assert.deepEqual(snapshot.edges, ["user:mentor-user->user:mentee-user"]);
});

// Idempotency: re-processing the same pair item never duplicates the edge.
test("processGraphSyncQueue edge reconciliation is idempotent across repeated pair items", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();
  seedPair(stub);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    { id: "q-pair", org_id: ORG_ID, source_table: "mentorship_pairs", source_id: "pair-1", action: "upsert", payload: {}, attempts: 0 },
  ]);

  await processGraphSyncQueue(stub as any, { graphClient });
  await processGraphSyncQueue(stub as any, { graphClient });

  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, ["user:mentor-user->user:mentee-user"]);
});

// When a pair goes inactive, the edge is removed.
test("processGraphSyncQueue removes the edge when the pair is no longer active", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();
  seedPair(stub);

  stub.registerRpc("dequeue_graph_sync_queue", () => [
    { id: "q-pair", org_id: ORG_ID, source_table: "mentorship_pairs", source_id: "pair-1", action: "upsert", payload: {}, attempts: 0 },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });
  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, ["user:mentor-user->user:mentee-user"]);

  await (stub as any).from("mentorship_pairs").update({ status: "completed" }).eq("id", "pair-1");
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    { id: "q-pair-2", org_id: ORG_ID, source_table: "mentorship_pairs", source_id: "pair-1", action: "upsert", payload: {}, attempts: 0 },
  ]);
  await processGraphSyncQueue(stub as any, { graphClient });

  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, []);
});

// Endpoint with no profile row in the org: edge cannot form, no crash, no edge.
test("processGraphSyncQueue skips the edge when an endpoint has no profile row", async () => {
  const stub = createSupabaseStub();
  const graphClient = createInMemoryGraphClient();

  // Only the mentor has a member row; the mentee user has no profile row at all.
  stub.seed("members", [
    {
      id: "member-mentor",
      organization_id: ORG_ID,
      user_id: "mentor-user",
      status: "active",
      first_name: "Morgan",
      last_name: "Mentor",
      email: "mentor@example.com",
      role: "Captain",
      current_company: "Acme",
      graduation_year: 2020,
      deleted_at: null,
    },
  ]);
  stub.seed("mentorship_pairs", [
    {
      id: "pair-1",
      organization_id: ORG_ID,
      mentor_user_id: "mentor-user",
      mentee_user_id: "ghost-user",
      status: "active",
      deleted_at: null,
    },
  ]);
  stub.registerRpc("increment_graph_sync_attempts", () => null);
  stub.registerRpc("dequeue_graph_sync_queue", () => [
    { id: "q-pair", org_id: ORG_ID, source_table: "mentorship_pairs", source_id: "pair-1", action: "upsert", payload: {}, attempts: 0 },
  ]);

  const stats = await processGraphSyncQueue(stub as any, { graphClient });

  assert.equal(stats.failed, 0);
  assert.deepEqual(graphClient.snapshot(ORG_ID).edges, []);
});
