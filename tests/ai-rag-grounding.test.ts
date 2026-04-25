import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyRagGrounding,
  extractFreeformClaims,
  claimCoveredByChunks,
  buildRagGroundingFallback,
} from "../src/lib/ai/grounding/rag.ts";

const chunkAnnouncement = {
  contentText:
    "Announcement: The Spring Gala will be held on 2026-05-15. Contact alice@example.com for tickets. Raised $1500 last year.",
  sourceTable: "announcements",
  metadata: {},
};

test("extractFreeformClaims picks up emails, dates, currency, quotes, prose", () => {
  const claims = extractFreeformClaims(
    'The event "Spring Gala" is on 2026-05-15. Email alice@example.com. Raised $1500 last year.'
  );
  const kinds = claims.map((c) => c.kind);
  assert.ok(kinds.includes("email"));
  assert.ok(kinds.includes("date"));
  assert.ok(kinds.includes("currency"));
  assert.ok(kinds.includes("quoted"));
});

test("claimCoveredByChunks marks covered email", () => {
  const coverage = claimCoveredByChunks(
    { kind: "email", text: "alice@example.com" },
    [chunkAnnouncement],
    0.35
  );
  assert.equal(coverage, "covered");
});

test("claimCoveredByChunks marks uncovered email", () => {
  const coverage = claimCoveredByChunks(
    { kind: "email", text: "nobody@example.com" },
    [chunkAnnouncement],
    0.35
  );
  assert.equal(coverage, "uncovered");
});

test("claimCoveredByChunks covered dates and currency", () => {
  assert.equal(
    claimCoveredByChunks(
      { kind: "date", text: "2026-05-15" },
      [chunkAnnouncement],
      0.35
    ),
    "covered"
  );
  assert.equal(
    claimCoveredByChunks(
      { kind: "currency", text: "$1500" },
      [chunkAnnouncement],
      0.35
    ),
    "covered"
  );
});

test("claimCoveredByChunks prose with heavy overlap returns covered", () => {
  const coverage = claimCoveredByChunks(
    { kind: "prose", text: "The Spring Gala will be held on May 15." },
    [chunkAnnouncement],
    0.2
  );
  assert.equal(coverage, "covered");
});

test("claimCoveredByChunks prose with thin overlap returns prose-check", () => {
  const coverage = claimCoveredByChunks(
    { kind: "prose", text: "Quantum cryptography breakthrough announced today." },
    [chunkAnnouncement],
    0.35
  );
  assert.equal(coverage, "prose-check");
});

test("verifyRagGrounding returns grounded when no chunks (bypass)", async () => {
  const result = await verifyRagGrounding({ content: "Anything", ragChunks: [] });
  assert.equal(result.grounded, true);
});

test("verifyRagGrounding flags fabricated email", async () => {
  const result = await verifyRagGrounding({
    content: "Contact imaginary@nowhere.com for tickets.",
    ragChunks: [chunkAnnouncement],
    judge: async () => "yes",
  });
  assert.equal(result.grounded, false);
  assert.ok(result.uncoveredClaims.some((c) => c.includes("imaginary@nowhere.com")));
});

test("verifyRagGrounding passes paraphrased announcement", async () => {
  const result = await verifyRagGrounding({
    content: "Spring Gala tickets via alice@example.com — raised $1500 previously.",
    ragChunks: [chunkAnnouncement],
    judge: async () => "yes",
    jaccardThreshold: 0.2,
  });
  assert.equal(result.grounded, true);
});

test("verifyRagGrounding uses judge for prose-check and respects `no`", async () => {
  let judgeCalls = 0;
  const result = await verifyRagGrounding({
    content: "Our CEO resigned yesterday amid scandal.",
    ragChunks: [chunkAnnouncement],
    judge: async () => {
      judgeCalls++;
      return "no";
    },
  });
  assert.equal(result.grounded, false);
  assert.ok(judgeCalls > 0);
});

test("verifyRagGrounding marks claim uncovered on judge error", async () => {
  const result = await verifyRagGrounding({
    content: "Our CEO announced record revenue growth yesterday.",
    ragChunks: [chunkAnnouncement],
    judge: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(result.grounded, false);
});

test("buildRagGroundingFallback includes source excerpt", () => {
  const text = buildRagGroundingFallback(["foo"], chunkAnnouncement);
  assert.match(text, /couldn't verify/i);
  assert.match(text, /Spring Gala/);
});

test("buildRagGroundingFallback handles missing chunk gracefully", () => {
  const text = buildRagGroundingFallback(["foo"], null);
  assert.match(text, /couldn't verify/i);
});
