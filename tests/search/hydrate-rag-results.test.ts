import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hydrateRagSearchResults } from "@/lib/search/hydrate-rag-results";
import type { RetrievedChunk } from "@/lib/ai/rag-retriever";

function createStubSupabase(rowsByTable: Record<string, { id: string; title: string | null }[]>) {
  return {
    from(table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in(_col: string, ids: string[]) {
          const rows = rowsByTable[table]?.filter((r) => ids.includes(r.id)) ?? [];
          return Promise.resolve({ data: rows });
        },
      };
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("hydrateRagSearchResults", () => {
  it("dedupes by source and drops announcements", async () => {
    const chunks: RetrievedChunk[] = [
      {
        id: "1",
        sourceTable: "announcements",
        sourceId: "a1",
        chunkIndex: 0,
        contentText: "ann",
        metadata: {},
        similarity: 0.9,
      },
      {
        id: "2",
        sourceTable: "job_postings",
        sourceId: "j1",
        chunkIndex: 0,
        contentText: "desc",
        metadata: {},
        similarity: 0.8,
      },
      {
        id: "3",
        sourceTable: "job_postings",
        sourceId: "j1",
        chunkIndex: 1,
        contentText: "dup",
        metadata: {},
        similarity: 0.5,
      },
    ];
    const service = createStubSupabase({
      job_postings: [{ id: "j1", title: "Engineer" }],
    });
    const hits = await hydrateRagSearchResults({
      chunks,
      orgSlug: "acme",
      orgId: "org-1",
      serviceSupabase: service,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sourceTable, "job_postings");
    assert.equal(hits[0].title, "Engineer");
    assert.ok(hits[0].url.includes("/acme/jobs/j1"));
  });

  it("collapses discussion_replies into parent thread", async () => {
    const chunks: RetrievedChunk[] = [
      {
        id: "r1",
        sourceTable: "discussion_replies",
        sourceId: "rep-1",
        chunkIndex: 0,
        contentText: "reply body",
        metadata: { parent_thread_id: "thr-1" },
        similarity: 0.95,
      },
    ];
    const service = createStubSupabase({
      discussion_threads: [{ id: "thr-1", title: "Parent title" }],
    });
    const hits = await hydrateRagSearchResults({
      chunks,
      orgSlug: "acme",
      orgId: "org-1",
      serviceSupabase: service,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].sourceTable, "discussion_threads");
    assert.equal(hits[0].sourceId, "thr-1");
    assert.match(hits[0].snippet, /Reply match/);
  });
});
