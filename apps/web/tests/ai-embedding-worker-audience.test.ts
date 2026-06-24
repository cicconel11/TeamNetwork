import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isChunkChanged,
  chunkSetNeedsReplacement,
} from "../src/lib/ai/embedding-worker.ts";

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

/**
 * Regression: full-chunk-set replacement (data integrity).
 *
 * `replace_ai_chunks` soft-deletes ALL existing chunks for a source and
 * re-inserts only the payload it receives. So when ANY chunk of a multi-chunk
 * doc changes, the worker must resend the FULL rendered set — sending only the
 * changed chunk would silently drop the unchanged ones from retrieval.
 * `chunkSetNeedsReplacement` is the set-level decision that drives this: it must
 * report "replace" whenever any chunk changed or any stored chunk is orphaned,
 * and the worker then sends every rendered chunk (covered below + in the worker).
 */
describe("chunkSetNeedsReplacement (full-set contract)", () => {
  const stored = (contentHash: string, audience: string | null = "all") => ({
    contentHash,
    audience,
  });

  it("needs replacement when ONE chunk of a multi-chunk doc changed", () => {
    // 2-chunk doc; chunk 0 text changed, chunk 1 identical. Must replace the
    // whole set (the worker then resends BOTH so chunk 1 is not dropped).
    const existing = new Map([
      [0, stored("old0")],
      [1, stored("hash1")],
    ]);
    const rendered = [
      { chunkIndex: 0, contentHash: "new0", audience: "all" },
      { chunkIndex: 1, contentHash: "hash1", audience: "all" },
    ];
    assert.equal(chunkSetNeedsReplacement(rendered, existing), true);
  });

  it("needs replacement when only an audience flip changed (identical text)", () => {
    const existing = new Map([
      [0, stored("h0", "all")],
      [1, stored("h1", "all")],
    ]);
    const rendered = [
      { chunkIndex: 0, contentHash: "h0", audience: "admins" },
      { chunkIndex: 1, contentHash: "h1", audience: "admins" },
    ];
    assert.equal(chunkSetNeedsReplacement(rendered, existing), true);
  });

  it("needs replacement when content shrank (orphaned stored chunk)", () => {
    const existing = new Map([
      [0, stored("h0")],
      [1, stored("h1")],
    ]);
    const rendered = [{ chunkIndex: 0, contentHash: "h0", audience: "all" }];
    assert.equal(chunkSetNeedsReplacement(rendered, existing), true);
  });

  it("does NOT need replacement when every chunk matches and none orphaned", () => {
    const existing = new Map([
      [0, stored("h0")],
      [1, stored("h1")],
    ]);
    const rendered = [
      { chunkIndex: 0, contentHash: "h0", audience: "all" },
      { chunkIndex: 1, contentHash: "h1", audience: "all" },
    ];
    assert.equal(chunkSetNeedsReplacement(rendered, existing), false);
  });

  it("needs replacement for a brand-new source (no stored chunks)", () => {
    const rendered = [{ chunkIndex: 0, contentHash: "h0", audience: "all" }];
    assert.equal(chunkSetNeedsReplacement(rendered, new Map()), true);
  });
});
