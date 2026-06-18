/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../utils/supabaseStub.ts";
import { checkRagHealth } from "../../src/lib/ai/rag-health.ts";
import { computeContentHash, renderChunks, type SourceTable } from "../../src/lib/ai/chunker.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

/** Render an announcement the same way the embedding worker does, to derive
 * the canonical chunk rows (index + hash + metadata) for that source. */
function chunkRowsFor(record: Record<string, unknown>, table: SourceTable = "announcements") {
  return renderChunks(table, record).map((chunk) => ({
    org_id: ORG_ID,
    source_table: table,
    source_id: String(record.id),
    chunk_index: chunk.chunkIndex,
    content_text: chunk.text,
    content_hash: computeContentHash(chunk.text),
    metadata: chunk.metadata,
    deleted_at: null,
  }));
}

const FRESH_ANNOUNCEMENT = {
  id: "ann-fresh",
  organization_id: ORG_ID,
  title: "Welcome",
  body: "Welcome to the club. Practice starts Monday.",
  audience: null,
  published_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
};

test("checkRagHealth reports ok when every eligible source has a current chunk", async () => {
  const stub = createSupabaseStub();
  stub.seed("announcements", [FRESH_ANNOUNCEMENT]);
  stub.seed("ai_document_chunks", chunkRowsFor(FRESH_ANNOUNCEMENT));

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "ok");
  assert.deepEqual(report.counts, {
    missingCoverage: 0,
    orphanChunks: 0,
    staleSources: 0,
    untaggedAudience: 0,
  });
});

test("checkRagHealth includes mentor profiles and treats inactive mentors as orphans", async () => {
  const stub = createSupabaseStub();
  const activeMentor = {
    id: "mentor-active",
    organization_id: ORG_ID,
    user_id: "user-1",
    bio: "I help students prepare for careers in finance.",
    topics: ["finance"],
    industries: ["finance"],
    is_active: true,
  };
  const inactiveMentor = {
    ...activeMentor,
    id: "mentor-inactive",
    is_active: false,
  };
  stub.seed("mentor_profiles", [activeMentor, inactiveMentor]);
  stub.seed("ai_document_chunks", [
    ...chunkRowsFor(activeMentor, "mentor_profiles"),
    ...chunkRowsFor(inactiveMentor, "mentor_profiles"),
  ]);

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "gaps");
  assert.equal(report.counts.orphanChunks, 1);
  assert.deepEqual(report.orphanChunks, [
    { sourceTable: "mentor_profiles", sourceId: "mentor-inactive" },
  ]);
});

test("checkRagHealth includes form submissions in coverage checks", async () => {
  const stub = createSupabaseStub();
  stub.seed("form_submissions", [
    {
      id: "submission-missing",
      organization_id: ORG_ID,
      form_id: "form-1",
      user_id: "user-1",
      data: { goals: "Find a mentor in healthcare." },
      deleted_at: null,
    },
  ]);

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "gaps");
  assert.equal(report.counts.missingCoverage, 1);
  assert.deepEqual(report.missingCoverage, [
    { sourceTable: "form_submissions", sourceId: "submission-missing" },
  ]);
});

test("checkRagHealth flags a source with no chunk as missing coverage", async () => {
  const stub = createSupabaseStub();
  stub.seed("announcements", [FRESH_ANNOUNCEMENT]);
  // No chunks seeded.

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "gaps");
  assert.equal(report.counts.missingCoverage, 1);
  assert.deepEqual(report.missingCoverage, [
    { sourceTable: "announcements", sourceId: "ann-fresh" },
  ]);
});

test("checkRagHealth does not flag an excluded source as missing coverage", async () => {
  const stub = createSupabaseStub();
  stub.seed("announcements", [FRESH_ANNOUNCEMENT]);
  stub.seed("ai_indexing_exclusions", [
    { org_id: ORG_ID, source_table: "announcements", source_id: "ann-fresh" },
  ]);

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "ok");
  assert.equal(report.counts.missingCoverage, 0);
});

test("checkRagHealth flags chunks for a soft-deleted source as orphans", async () => {
  const stub = createSupabaseStub();
  const deleted = { ...FRESH_ANNOUNCEMENT, id: "ann-deleted", deleted_at: "2026-02-01T00:00:00.000Z" };
  stub.seed("announcements", [deleted]);
  stub.seed("ai_document_chunks", chunkRowsFor({ ...deleted, deleted_at: null }));

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "gaps");
  assert.equal(report.counts.orphanChunks, 1);
  assert.deepEqual(report.orphanChunks, [
    { sourceTable: "announcements", sourceId: "ann-deleted" },
  ]);
});

test("checkRagHealth flags a source whose content changed after embedding as stale", async () => {
  const stub = createSupabaseStub();
  // Chunk stored for the original body; source body has since changed.
  const original = { ...FRESH_ANNOUNCEMENT, id: "ann-stale", body: "Original body text here." };
  stub.seed("ai_document_chunks", chunkRowsFor(original));
  stub.seed("announcements", [{ ...original, body: "Completely rewritten body now." }]);

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "gaps");
  assert.equal(report.counts.staleSources, 1);
  assert.deepEqual(report.staleSources, [
    { sourceTable: "announcements", sourceId: "ann-stale" },
  ]);
});

test("checkRagHealth flags an audience-restricted source whose chunk dropped the audience tag", async () => {
  const stub = createSupabaseStub();
  // Source is alumni-restricted, but the stored chunk metadata has no audience
  // (e.g. embedded before the restriction was applied).
  const restricted = { ...FRESH_ANNOUNCEMENT, id: "ann-aud", audience: "alumni" };
  const staleChunks = chunkRowsFor({ ...restricted, audience: null }).map((chunk) => ({
    ...chunk,
    metadata: { title: "Welcome", audience: null },
  }));
  stub.seed("announcements", [restricted]);
  stub.seed("ai_document_chunks", staleChunks);

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "gaps");
  assert.equal(report.counts.untaggedAudience, 1);
  assert.deepEqual(report.untaggedAudience, [
    { sourceTable: "announcements", sourceId: "ann-aud" },
  ]);
});

test("checkRagHealth degrades when the exclusions lookup fails", async () => {
  const stub = createSupabaseStub();
  stub.simulateError("ai_indexing_exclusions", { message: "boom" });

  const report = await checkRagHealth(stub as any, ORG_ID);

  assert.equal(report.state, "degraded");
  assert.equal(report.reason, "boom");
});
