import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * The embedding worker maps each SourceTable to a Postgres column select string
 * in SOURCE_SELECTS, and validates incoming queue rows via `t in SOURCE_SELECTS`.
 * We assert (by reading the source, since the symbol is module-private) that the
 * knowledge_documents entry exists, is a valid comma-separated select string with
 * the columns the renderer + worker require, and that 'audience' is selected so it
 * can be carried into chunk metadata for audience gating.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_PATH = join(
  __dirname,
  "..",
  "src",
  "lib",
  "ai",
  "embedding-worker.ts"
);

describe("embedding-worker — knowledge_documents source select", () => {
  const source = readFileSync(WORKER_PATH, "utf-8");

  it("defines a knowledge_documents SOURCE_SELECTS entry", () => {
    assert.match(source, /knowledge_documents:\s*\n?\s*"[^"]+"/);
  });

  it("selects the columns the worker + renderer require", () => {
    const match = source.match(/knowledge_documents:\s*\n?\s*"([^"]+)"/);
    assert.ok(match, "expected a knowledge_documents select string");
    const cols = match![1].split(",").map((c) => c.trim());
    for (const required of [
      "id",
      "organization_id",
      "deleted_at",
      "title",
      "body",
      "audience",
      "type",
      "tags",
    ]) {
      assert.ok(
        cols.includes(required),
        `knowledge_documents select missing column: ${required}`
      );
    }
  });

  it("includes audience so chunk metadata can gate retrieval", () => {
    const match = source.match(/knowledge_documents:\s*\n?\s*"([^"]+)"/);
    assert.ok(match![1].includes("audience"));
  });
});
