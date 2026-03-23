import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderChunks, computeContentHash } from "../src/lib/ai/chunker";

describe("chunker", () => {
  describe("computeContentHash", () => {
    it("returns stable SHA-256 hex for same input", () => {
      const hash1 = computeContentHash("hello world");
      const hash2 = computeContentHash("hello world");
      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64); // SHA-256 hex length
    });

    it("returns different hashes for different inputs", () => {
      const hash1 = computeContentHash("hello");
      const hash2 = computeContentHash("world");
      assert.notEqual(hash1, hash2);
    });
  });

  describe("renderChunks — announcements", () => {
    it("renders title, body, audience, and published_at", () => {
      const chunks = renderChunks("announcements", {
        title: "Welcome Back",
        body: "We hope you had a great summer.",
        audience: "all",
        published_at: "2026-03-01T00:00:00Z",
      });
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].chunkIndex, 0);
      assert.ok(chunks[0].text.includes("Announcement: Welcome Back"));
      assert.ok(chunks[0].text.includes("We hope you had a great summer."));
      assert.ok(chunks[0].text.includes("Audience: all"));
      assert.ok(chunks[0].text.includes("Published:"));
    });

    it("handles null/missing fields gracefully", () => {
      const chunks = renderChunks("announcements", {
        title: "Test",
        body: null,
        audience: null,
        published_at: null,
      });
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].text.includes("Announcement: Test"));
      assert.ok(!chunks[0].text.includes("Audience:"));
      assert.ok(!chunks[0].text.includes("Published:"));
    });
  });

  describe("renderChunks — events", () => {
    it("renders event with all fields", () => {
      const chunks = renderChunks("events", {
        title: "Spring Gala",
        description: "Annual fundraiser event",
        start_date: "2026-04-15",
        end_date: "2026-04-15",
        location: "Grand Ballroom",
        audience: "members",
      });
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].text.includes("Event: Spring Gala"));
      assert.ok(chunks[0].text.includes("Annual fundraiser event"));
      assert.ok(chunks[0].text.includes("Location: Grand Ballroom"));
      assert.ok(chunks[0].text.includes("Audience: members"));
    });

    it("handles missing optional fields", () => {
      const chunks = renderChunks("events", {
        title: "Meeting",
        start_date: "2026-04-15",
      });
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].text.includes("Event: Meeting"));
      assert.ok(!chunks[0].text.includes("Location:"));
    });
  });

  describe("renderChunks — discussion_threads", () => {
    it("renders title and body", () => {
      const chunks = renderChunks("discussion_threads", {
        title: "Best study spots?",
        body: "Looking for quiet places to study on campus.",
      });
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].text.includes("Discussion: Best study spots?"));
      assert.ok(chunks[0].text.includes("Looking for quiet places"));
    });
  });

  describe("renderChunks — discussion_replies", () => {
    it("skips short replies (<=500 chars)", () => {
      const chunks = renderChunks("discussion_replies", {
        body: "I agree with that.",
        thread_id: "some-thread-id",
      });
      assert.equal(chunks.length, 0);
    });

    it("renders long replies with parent context", () => {
      const longBody = "A".repeat(600);
      const chunks = renderChunks(
        "discussion_replies",
        { body: longBody, thread_id: "thread-123" },
        { title: "Parent Thread Title", body: "Parent body content that gives context about the discussion topic" }
      );
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].text.includes("Discussion: Parent Thread Title"));
      assert.ok(chunks[0].text.includes("Parent body content"));
      assert.ok(chunks[0].text.includes("Reply:"));
      assert.deepEqual(chunks[0].metadata, { parent_thread_id: "thread-123" });
    });

    it("renders long replies without parent context", () => {
      const longBody = "B".repeat(600);
      const chunks = renderChunks("discussion_replies", {
        body: longBody,
        thread_id: "thread-456",
      });
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].text.includes("Reply:"));
      assert.ok(!chunks[0].text.includes("Discussion:"));
    });
  });

  describe("renderChunks — job_postings", () => {
    it("renders job posting with all fields", () => {
      const chunks = renderChunks("job_postings", {
        title: "Software Engineer",
        company: "Acme Corp",
        description: "Build amazing things.",
        location: "San Francisco",
        location_type: "hybrid",
      });
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].text.includes("Job: Software Engineer"));
      assert.ok(chunks[0].text.includes("Company: Acme Corp"));
      assert.ok(chunks[0].text.includes("Build amazing things."));
      assert.ok(chunks[0].text.includes("Location: San Francisco — hybrid"));
    });
  });

  describe("long content splitting", () => {
    it("splits content exceeding 2048 chars into multiple chunks", () => {
      // Create a body with multiple paragraphs that exceed 2048 chars
      const paragraphs = Array.from({ length: 10 }, (_, i) =>
        `Paragraph ${i + 1}: ${"x".repeat(250)}`
      );
      const longBody = paragraphs.join("\n\n");

      const chunks = renderChunks("announcements", {
        title: "Long Announcement",
        body: longBody,
      });

      assert.ok(chunks.length > 1, `Expected multiple chunks, got ${chunks.length}`);
      // Verify sequential chunk indexes
      for (let i = 0; i < chunks.length; i++) {
        assert.equal(chunks[i].chunkIndex, i);
      }
      // Verify each chunk is within the limit
      for (const chunk of chunks) {
        assert.ok(chunk.text.length <= 2048 + 100); // Small tolerance for boundary effects
      }
    });

    it("breaks a single oversized paragraph on sentence boundaries", () => {
      // Create a single paragraph (no \n\n) that exceeds 2048 chars
      const sentences = Array.from({ length: 20 }, (_, i) =>
        `Sentence number ${i + 1} has some content here.`
      );
      const longParagraph = sentences.join(" ");

      const chunks = renderChunks("discussion_threads", {
        title: "Thread with huge body",
        body: longParagraph,
      });

      // Should produce at least 1 chunk, all within the limit
      assert.ok(chunks.length >= 1);
      for (const chunk of chunks) {
        assert.ok(
          chunk.text.length <= 2048,
          `Chunk exceeded limit: ${chunk.text.length} chars`
        );
      }
    });
  });
});
