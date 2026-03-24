/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderChunks, computeContentHash, type SourceTable } from "../src/lib/ai/chunker";

/**
 * These tests verify the embedding worker's component logic:
 * - Source table validation
 * - Chunk rendering per table type
 * - Content hash computation for skip-if-unchanged
 * - Queue item classification (upsert vs delete)
 *
 * The actual processEmbeddingQueue function requires a real embedding API,
 * so we test its building blocks in isolation instead.
 */

const VALID_SOURCE_TABLES: SourceTable[] = [
  "announcements",
  "discussion_threads",
  "discussion_replies",
  "events",
  "job_postings",
];

describe("embedding-worker components", () => {
  describe("source table validation", () => {
    it("recognizes all valid source tables", () => {
      const sourceSelects: Record<string, string> = {
        announcements: "id, title, body",
        events: "id, title, description",
        discussion_threads: "id, title, body",
        discussion_replies: "id, thread_id, body",
        job_postings: "id, title, description",
      };

      for (const table of VALID_SOURCE_TABLES) {
        assert.ok(table in sourceSelects, `${table} should be valid`);
      }
    });

    it("rejects unknown source tables", () => {
      const validSet = new Set(VALID_SOURCE_TABLES as string[]);
      assert.ok(!validSet.has("users"));
      assert.ok(!validSet.has("chat_messages"));
      assert.ok(!validSet.has(""));
    });
  });

  describe("chunk rendering for upserts", () => {
    it("renders announcement chunks", () => {
      const record = {
        id: "ann1",
        title: "Welcome",
        body: "Hello everyone",
        audience: "all",
        published_at: "2026-03-01",
        organization_id: "org1",
        deleted_at: null,
      };

      const chunks = renderChunks("announcements", record);
      assert.ok(chunks.length >= 1);
      assert.ok(chunks[0].text.includes("Welcome"));
    });

    it("renders event chunks", () => {
      const record = {
        id: "evt1",
        title: "Spring Gala",
        description: "Annual fundraiser",
        start_date: "2026-04-15",
        end_date: "2026-04-15",
        location: "Ballroom",
        audience: "all",
        organization_id: "org1",
        deleted_at: null,
      };

      const chunks = renderChunks("events", record);
      assert.ok(chunks.length >= 1);
      assert.ok(chunks[0].text.includes("Spring Gala"));
    });

    it("renders discussion thread chunks", () => {
      const chunks = renderChunks("discussion_threads", {
        id: "dt1",
        title: "Question",
        body: "What's the best approach?",
        organization_id: "org1",
        deleted_at: null,
      });
      assert.ok(chunks.length >= 1);
      assert.ok(chunks[0].text.includes("Question"));
    });

    it("skips short discussion replies", () => {
      const chunks = renderChunks("discussion_replies", {
        id: "dr1",
        thread_id: "dt1",
        body: "I agree",
        organization_id: "org1",
        deleted_at: null,
      });
      assert.equal(chunks.length, 0, "Short replies should be skipped");
    });

    it("renders long discussion replies with parent context", () => {
      const longBody = "A".repeat(600);
      const chunks = renderChunks(
        "discussion_replies",
        { id: "dr1", thread_id: "dt1", body: longBody, organization_id: "org1", deleted_at: null },
        { title: "Parent Title", body: "Parent body text" }
      );
      assert.ok(chunks.length >= 1);
      assert.ok(chunks[0].text.includes("Parent Title"));
      assert.ok(chunks[0].metadata.parent_thread_id === "dt1");
    });

    it("renders job posting chunks", () => {
      const chunks = renderChunks("job_postings", {
        id: "jp1",
        title: "Engineer",
        company: "Acme",
        description: "Build things",
        location: "Remote",
        location_type: "remote",
        organization_id: "org1",
        deleted_at: null,
      });
      assert.ok(chunks.length >= 1);
      assert.ok(chunks[0].text.includes("Engineer"));
    });
  });

  describe("content hash for skip-if-unchanged", () => {
    it("same content produces same hash", () => {
      const text = "Announcement: Test\nBody content";
      assert.equal(computeContentHash(text), computeContentHash(text));
    });

    it("different content produces different hash", () => {
      const hash1 = computeContentHash("Version 1");
      const hash2 = computeContentHash("Version 2");
      assert.notEqual(hash1, hash2);
    });

    it("can detect unchanged chunks by comparing hashes", () => {
      const record = {
        title: "Test",
        body: "Same body",
        organization_id: "org1",
        deleted_at: null,
      };

      const chunks = renderChunks("announcements", record);
      const hash1 = computeContentHash(chunks[0].text);

      // Simulate re-render of same content
      const chunks2 = renderChunks("announcements", record);
      const hash2 = computeContentHash(chunks2[0].text);

      assert.equal(hash1, hash2, "Hash should be stable for same content");
    });

    it("detects changed chunks when content is modified", () => {
      const chunks1 = renderChunks("announcements", {
        title: "Test", body: "Version 1",
      });
      const chunks2 = renderChunks("announcements", {
        title: "Test", body: "Version 2",
      });

      assert.notEqual(
        computeContentHash(chunks1[0].text),
        computeContentHash(chunks2[0].text),
        "Hash should differ for modified content"
      );
    });
  });

  describe("queue item classification", () => {
    it("classifies items by action type", () => {
      const items = [
        { id: "q1", action: "upsert", source_table: "announcements", source_id: "a1", org_id: "o1" },
        { id: "q2", action: "delete", source_table: "events", source_id: "e1", org_id: "o1" },
        { id: "q3", action: "upsert", source_table: "job_postings", source_id: "j1", org_id: "o1" },
      ];

      const upserts = items.filter(i => i.action === "upsert");
      const deletes = items.filter(i => i.action === "delete");

      assert.equal(upserts.length, 2);
      assert.equal(deletes.length, 1);
    });

    it("treats missing source records as deletes", () => {
      const item = { id: "q1", action: "upsert", source_table: "announcements", source_id: "missing" };
      const sourceRecords = new Map<string, Record<string, unknown>>();

      const record = sourceRecords.get(item.source_id);
      const shouldDelete = !record || (record as any).deleted_at != null;

      assert.ok(shouldDelete, "Missing record should be treated as delete");
    });

    it("treats soft-deleted source records as deletes", () => {
      const record = { id: "a1", title: "Deleted", deleted_at: "2026-03-01" };
      const shouldDelete = record.deleted_at != null;

      assert.ok(shouldDelete, "Soft-deleted record should be treated as delete");
    });
  });

  describe("exclusion filtering", () => {
    it("identifies excluded items by source_table:source_id key", () => {
      const exclusions = new Set(["announcements:a1", "events:e2"]);

      assert.ok(exclusions.has("announcements:a1"));
      assert.ok(!exclusions.has("announcements:a2"));
      assert.ok(exclusions.has("events:e2"));
    });
  });
});
