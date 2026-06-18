import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderChunks } from "../src/lib/ai/chunker";

describe("chunker — knowledge_documents", () => {
  it("renders title, type, tags, and body into chunk text", () => {
    const chunks = renderChunks("knowledge_documents", {
      title: "Refund Policy",
      type: "policy",
      tags: ["billing", "refunds"],
      description: "How refunds work",
      body: "Refunds are processed within 30 days of request.",
      audience: "all",
    });

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkIndex, 0);
    assert.ok(chunks[0].text.includes("Knowledge: Refund Policy"));
    assert.ok(chunks[0].text.includes("Type: policy"));
    assert.ok(chunks[0].text.includes("Tags: billing, refunds"));
    assert.ok(chunks[0].text.includes("Refunds are processed within 30 days"));
  });

  it("carries type, title, tags, and audience into chunk metadata", () => {
    const chunks = renderChunks("knowledge_documents", {
      title: "Admin Runbook",
      type: "runbook",
      tags: ["ops"],
      body: "Internal operational steps for admins only.",
      audience: "admins",
    });

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].metadata.title, "Admin Runbook");
    assert.equal(chunks[0].metadata.type, "runbook");
    assert.deepEqual(chunks[0].metadata.tags, ["ops"]);
    // Audience MUST be in metadata so the search RPC can gate retrieval.
    assert.equal(chunks[0].metadata.audience, "admins");
  });

  it("defaults audience to 'all' when unset", () => {
    const chunks = renderChunks("knowledge_documents", {
      title: "General Info",
      body: "Open to everyone.",
    });

    assert.equal(chunks[0].metadata.audience, "all");
  });

  it("handles missing optional fields gracefully", () => {
    const chunks = renderChunks("knowledge_documents", {
      title: "Bare Doc",
      body: "Just a body.",
    });

    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].text.includes("Knowledge: Bare Doc"));
    assert.ok(!chunks[0].text.includes("Type:"));
    assert.ok(!chunks[0].text.includes("Tags:"));
  });
});
