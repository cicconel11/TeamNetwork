/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../utils/supabaseStub.ts";
import { checkGraphDrift } from "../../src/lib/falkordb/drift.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

/** In-memory graph client seeded with explicit node keys and edges. */
function createGraphFixture(seed: { nodeKeys?: string[]; edges?: Array<[string, string]> } = {}) {
  const nodeKeys = new Set(seed.nodeKeys ?? []);
  const edges = new Set((seed.edges ?? []).map(([a, b]) => `${a}->${b}`));
  return {
    isAvailable: () => true,
    async query(_orgId: string, cypher: string) {
      if (cypher.includes("RETURN p.personKey AS personKey")) {
        return [...nodeKeys].map((personKey) => ({ personKey }));
      }
      if (cypher.includes("RETURN a.personKey AS mentorKey")) {
        return [...edges].map((entry) => {
          const [mentorKey, menteeKey] = entry.split("->");
          return { mentorKey, menteeKey };
        });
      }
      return [];
    },
  };
}

function seedMember(stub: ReturnType<typeof createSupabaseStub>, overrides: Record<string, unknown>) {
  stub.seed("members", [
    {
      organization_id: ORG_ID,
      status: "active",
      first_name: "First",
      last_name: "Last",
      email: "person@example.com",
      role: null,
      current_company: null,
      graduation_year: null,
      created_at: "2026-01-01T00:00:00.000Z",
      deleted_at: null,
      ...overrides,
    },
  ]);
}

test("checkGraphDrift reports ok when graph matches Supabase truth", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    { id: "m1", organization_id: ORG_ID, user_id: "u-mentor", status: "active", first_name: "Mo", last_name: "Mentor", email: "mo@x.com", role: null, current_company: null, graduation_year: null, created_at: "2026-01-01T00:00:00.000Z", deleted_at: null },
    { id: "m2", organization_id: ORG_ID, user_id: "u-mentee", status: "active", first_name: "Ty", last_name: "Mentee", email: "ty@x.com", role: null, current_company: null, graduation_year: null, created_at: "2026-01-01T00:00:00.000Z", deleted_at: null },
  ]);
  stub.seed("mentorship_pairs", [
    { id: "p1", organization_id: ORG_ID, mentor_user_id: "u-mentor", mentee_user_id: "u-mentee", status: "active", deleted_at: null },
  ]);

  const graphClient = createGraphFixture({
    nodeKeys: ["user:u-mentor", "user:u-mentee"],
    edges: [["user:u-mentor", "user:u-mentee"]],
  });

  const report = await checkGraphDrift(stub as any, ORG_ID, graphClient as any);

  assert.equal(report.state, "ok");
  assert.equal(report.nodes.expected, 2);
  assert.equal(report.nodes.actual, 2);
  assert.equal(report.edges.expected, 1);
  assert.equal(report.edges.actual, 1);
  assert.deepEqual(report.nodes.missingKeys, []);
  assert.deepEqual(report.edges.missingEdges, []);
});

test("checkGraphDrift flags a missing edge whose endpoint node is absent", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [
    { id: "m1", organization_id: ORG_ID, user_id: "u-mentor", status: "active", first_name: "Mo", last_name: "Mentor", email: "mo@x.com", role: null, current_company: null, graduation_year: null, created_at: "2026-01-01T00:00:00.000Z", deleted_at: null },
    { id: "m2", organization_id: ORG_ID, user_id: "u-mentee", status: "active", first_name: "Ty", last_name: "Mentee", email: "ty@x.com", role: null, current_company: null, graduation_year: null, created_at: "2026-01-01T00:00:00.000Z", deleted_at: null },
  ]);
  stub.seed("mentorship_pairs", [
    { id: "p1", organization_id: ORG_ID, mentor_user_id: "u-mentor", mentee_user_id: "u-mentee", status: "active", deleted_at: null },
  ]);

  // Mentee node never synced; edge missing.
  const graphClient = createGraphFixture({ nodeKeys: ["user:u-mentor"], edges: [] });

  const report = await checkGraphDrift(stub as any, ORG_ID, graphClient as any);

  assert.equal(report.state, "drift");
  assert.deepEqual(report.nodes.missingKeys, ["user:u-mentee"]);
  assert.deepEqual(report.edges.missingEdges, ["user:u-mentor->user:u-mentee"]);
});

test("checkGraphDrift flags a userless mis-keyed node (G1 signature)", async () => {
  const stub = createSupabaseStub();
  // Member row HAS a user_id, so its canonical key is user:u-x — but the graph
  // holds a stale member: node, the signature that breaks edge formation.
  seedMember(stub, { id: "m-x", user_id: "u-x" });

  const graphClient = createGraphFixture({ nodeKeys: ["member:m-x"] });

  const report = await checkGraphDrift(stub as any, ORG_ID, graphClient as any);

  assert.equal(report.state, "drift");
  assert.deepEqual(report.nodes.misKeyedNodeKeys, ["member:m-x"]);
  assert.deepEqual(report.nodes.missingKeys, ["user:u-x"]);
  assert.deepEqual(report.nodes.orphanKeys, ["member:m-x"]);
});

test("checkGraphDrift flags orphan nodes and orphan edges with no live source row", async () => {
  const stub = createSupabaseStub();
  seedMember(stub, { id: "m1", user_id: "u-live" });

  const graphClient = createGraphFixture({
    nodeKeys: ["user:u-live", "user:u-ghost"],
    edges: [["user:u-live", "user:u-ghost"]],
  });

  const report = await checkGraphDrift(stub as any, ORG_ID, graphClient as any);

  assert.equal(report.state, "drift");
  assert.deepEqual(report.nodes.orphanKeys, ["user:u-ghost"]);
  assert.deepEqual(report.edges.orphanEdges, ["user:u-live->user:u-ghost"]);
  assert.equal(report.edges.expected, 0);
});

test("checkGraphDrift returns degraded when the graph is unavailable", async () => {
  const stub = createSupabaseStub();
  const report = await checkGraphDrift(stub as any, ORG_ID, {
    isAvailable: () => false,
    getUnavailableReason: () => "disabled",
    query: async () => [],
  } as any);

  assert.equal(report.state, "degraded");
  assert.equal(report.reason, "disabled");
});

test("checkGraphDrift returns degraded when graph queries throw", async () => {
  const stub = createSupabaseStub();
  seedMember(stub, { id: "m1", user_id: "u-1" });
  const report = await checkGraphDrift(stub as any, ORG_ID, {
    isAvailable: () => true,
    query: async () => {
      throw new Error("connection reset");
    },
  } as any);

  assert.equal(report.state, "degraded");
  assert.equal(report.reason, "connection reset");
});
