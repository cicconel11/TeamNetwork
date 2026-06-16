/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import {
  audienceFilterForRole,
  retrieveRelevantChunks,
} from "../../src/lib/ai/rag-retriever.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

// --- audienceFilterForRole: the policy heart of the audience fix ---

test("audienceFilterForRole returns undefined (unrestricted) for admins", () => {
  assert.equal(audienceFilterForRole("admin"), undefined);
});

test("audienceFilterForRole scopes active members to member audiences", () => {
  assert.deepEqual(audienceFilterForRole("active_member"), ["members", "active_members"]);
});

test("audienceFilterForRole scopes alumni and parents to alumni audiences", () => {
  assert.deepEqual(audienceFilterForRole("alumni"), ["alumni"]);
  assert.deepEqual(audienceFilterForRole("parent"), ["alumni"]);
});

// --- retrieval exclusion: a fake RPC mirrors the SQL audience predicate ---

const CHUNKS = [
  { id: "c-all", source_table: "announcements", source_id: "a-all", chunk_index: 0, content_text: "Open to everyone — welcome to the season kickoff celebration.", metadata: { audience: "all" }, similarity: 0.9 },
  { id: "c-alumni", source_table: "announcements", source_id: "a-alum", chunk_index: 0, content_text: "Alumni-only networking dinner details and RSVP instructions here.", metadata: { audience: "alumni" }, similarity: 0.92 },
  { id: "c-members", source_table: "announcements", source_id: "a-mem", chunk_index: 0, content_text: "Active members must complete the new practice waiver this week.", metadata: { audience: "members" }, similarity: 0.88 },
];

/** Supabase stand-in whose rpc applies the same WHERE clause the migration adds. */
function fakeSupabaseWithAudience() {
  return {
    rpc: async (_name: string, params: Record<string, unknown>) => {
      const filter = params.p_audience_filter as string[] | undefined;
      const data = CHUNKS.filter((chunk) => {
        const audience = (chunk.metadata.audience as string) ?? "all";
        if (!filter) return true; // NULL filter → unrestricted
        if (audience === "all" || audience === "both") return true;
        return filter.includes(audience);
      });
      return { data, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ in: () => ({ eq: () => ({ is: async () => ({ data: [], error: null }) }) }) }) }),
      }),
    }),
  };
}

const fakeEmbed = async () => new Array(768).fill(0);

test("a member does not retrieve an alumni-only chunk in the chat path", async () => {
  const results = await retrieveRelevantChunks({
    query: "networking dinner",
    orgId: ORG_ID,
    serviceSupabase: fakeSupabaseWithAudience() as any,
    audienceFilter: audienceFilterForRole("active_member"),
    generateEmbeddingFn: fakeEmbed as any,
  });

  const ids = results.map((r) => r.id).sort();
  assert.deepEqual(ids, ["c-all", "c-members"]);
  assert.equal(results.some((r) => r.id === "c-alumni"), false);
});

test("an alumni requester retrieves alumni and unrestricted chunks only", async () => {
  const results = await retrieveRelevantChunks({
    query: "season",
    orgId: ORG_ID,
    serviceSupabase: fakeSupabaseWithAudience() as any,
    audienceFilter: audienceFilterForRole("alumni"),
    generateEmbeddingFn: fakeEmbed as any,
  });

  assert.deepEqual(results.map((r) => r.id).sort(), ["c-all", "c-alumni"]);
});

test("an admin (no filter) retrieves every chunk including restricted ones", async () => {
  const results = await retrieveRelevantChunks({
    query: "season",
    orgId: ORG_ID,
    serviceSupabase: fakeSupabaseWithAudience() as any,
    audienceFilter: audienceFilterForRole("admin"),
    generateEmbeddingFn: fakeEmbed as any,
  });

  assert.deepEqual(results.map((r) => r.id).sort(), ["c-all", "c-alumni", "c-members"]);
});

test("the audience filter is forwarded to the search RPC only when set", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const capturingSupabase = {
    rpc: async (_name: string, params: Record<string, unknown>) => {
      calls.push(params);
      return { data: [], error: null };
    },
  };

  await retrieveRelevantChunks({
    query: "x",
    orgId: ORG_ID,
    serviceSupabase: capturingSupabase as any,
    audienceFilter: ["alumni"],
    generateEmbeddingFn: fakeEmbed as any,
  });
  await retrieveRelevantChunks({
    query: "x",
    orgId: ORG_ID,
    serviceSupabase: capturingSupabase as any,
    audienceFilter: undefined,
    generateEmbeddingFn: fakeEmbed as any,
  });

  assert.deepEqual(calls[0].p_audience_filter, ["alumni"]);
  assert.equal("p_audience_filter" in calls[1], false);
});
