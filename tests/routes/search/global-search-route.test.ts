import test from "node:test";
import assert from "node:assert/strict";
import { globalSearchApiParamsSchema } from "@/lib/schemas";
import { normalizeRepeatedTitle } from "@/lib/search/normalize-title";
import { detectIntent } from "@/lib/search/intent-fallback";
import { expandQuery } from "@/lib/ai/rag-retriever";

test("globalSearchApiParamsSchema rejects empty q", () => {
  const r = globalSearchApiParamsSchema.safeParse({ q: "   ", mode: "fast" });
  assert.equal(r.success, false);
});

test("globalSearchApiParamsSchema rejects single-char q", () => {
  const r = globalSearchApiParamsSchema.safeParse({ q: "a", mode: "fast" });
  assert.equal(r.success, false);
});

test("globalSearchApiParamsSchema accepts 2-char q", () => {
  const r = globalSearchApiParamsSchema.safeParse({ q: "ab", mode: "fast" });
  assert.equal(r.success, true);
});

test("globalSearchApiParamsSchema accepts valid q and mode", () => {
  const r = globalSearchApiParamsSchema.safeParse({ q: "hello", mode: "ai", limit: "10" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.mode, "ai");
    assert.equal(r.data.limit, 10);
    assert.ok(r.data.q.length > 0);
  }
});

test("globalSearchApiParamsSchema rejects 2-char q in ai mode (min 3)", () => {
  const r = globalSearchApiParamsSchema.safeParse({ q: "ab", mode: "ai" });
  assert.equal(r.success, false);
  if (!r.success) {
    const messages = r.error.issues.map((i) => i.message).join(" ");
    assert.ok(/at least 3/i.test(messages));
  }
});

test("globalSearchApiParamsSchema accepts 3-char q in ai mode", () => {
  const r = globalSearchApiParamsSchema.safeParse({ q: "abc", mode: "ai" });
  assert.equal(r.success, true);
});

test("normalizeRepeatedTitle collapses repeated tokens", () => {
  assert.equal(
    normalizeRepeatedTitle("Baseball Baseball Baseball Baseball"),
    "Baseball",
  );
});

test("normalizeRepeatedTitle preserves unique tokens", () => {
  assert.equal(
    normalizeRepeatedTitle("Senior Product Designer"),
    "Senior Product Designer",
  );
});

test("normalizeRepeatedTitle handles empty/null", () => {
  assert.equal(normalizeRepeatedTitle(""), "");
  assert.equal(normalizeRepeatedTitle(null), "");
  assert.equal(normalizeRepeatedTitle(undefined), "");
});

test("normalizeRepeatedTitle is case-insensitive on match", () => {
  assert.equal(normalizeRepeatedTitle("Team team TEAM"), "Team");
});

test("detectIntent returns entity type for reserved words", () => {
  assert.equal(detectIntent("job"), "job_posting");
  assert.equal(detectIntent("Jobs"), "job_posting");
  assert.equal(detectIntent("events"), "event");
  assert.equal(detectIntent("alumni"), "alumni");
  assert.equal(detectIntent("announcements"), "announcement");
  assert.equal(detectIntent("threads"), "discussion_thread");
});

test("detectIntent returns null for non-reserved or multi-word", () => {
  assert.equal(detectIntent("senior designer"), null);
  assert.equal(detectIntent("acme"), null);
  assert.equal(detectIntent(""), null);
});

test("expandQuery expands bare domain terms", () => {
  assert.ok(expandQuery("job").includes("posting"));
  assert.ok(expandQuery("events").includes("meeting"));
});

test("expandQuery passes through non-domain terms", () => {
  assert.equal(expandQuery("senior engineer"), "senior engineer");
});
