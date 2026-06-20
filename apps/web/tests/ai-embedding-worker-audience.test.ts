import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isChunkChanged } from "../src/lib/ai/embedding-worker.ts";

/**
 * Regression: stale `audience` metadata in RAG chunks (security/data-integrity).
 *
 * Audience gates retrieval — the search RPC filters on `metadata->>'audience'`.
 * Audience lives in chunk metadata, NOT in the hashed chunk TEXT, so a doc that
 * flips public (`all`) → restricted (`admins`) WITHOUT changing its text yields
 * a byte-identical content_hash. `isChunkChanged` is the decision point the
 * worker uses to choose skip-vs-re-embed; it MUST report "changed" on an
 * audience flip even when the text hash is identical. Skipping such a chunk
 * would leave `audience:'all'` keyword/vector visible to non-admins — a leak.
 *
 * This unit suite targets that pure decision directly: it needs no mocks and
 * runs clean under the standard test runner (no --experimental flags).
 */

describe("isChunkChanged (audience gate)", () => {
  it("re-embeds when no stored chunk exists", () => {
    assert.equal(
      isChunkChanged(undefined, { contentHash: "h", audience: "all" }),
      true
    );
  });

  it("re-embeds when TEXT hash differs (audience unchanged)", () => {
    assert.equal(
      isChunkChanged(
        { contentHash: "old", audience: "all" },
        { contentHash: "new", audience: "all" }
      ),
      true
    );
  });

  it("re-embeds when audience flips all→admins with IDENTICAL text", () => {
    assert.equal(
      isChunkChanged(
        { contentHash: "same", audience: "all" },
        { contentHash: "same", audience: "admins" }
      ),
      true,
      "audience flip with identical text MUST be treated as changed"
    );
  });

  it("re-embeds when audience flips null→admins with identical text", () => {
    assert.equal(
      isChunkChanged(
        { contentHash: "same", audience: null },
        { contentHash: "same", audience: "admins" }
      ),
      true
    );
  });

  it("re-embeds when audience flips admins→all with identical text", () => {
    assert.equal(
      isChunkChanged(
        { contentHash: "same", audience: "admins" },
        { contentHash: "same", audience: "all" }
      ),
      true,
      "any audience change is a retrieval-gate change, in either direction"
    );
  });

  it("skips when both text hash AND audience are unchanged", () => {
    assert.equal(
      isChunkChanged(
        { contentHash: "same", audience: "all" },
        { contentHash: "same", audience: "all" }
      ),
      false
    );
  });
});
