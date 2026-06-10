import test from "node:test";
import assert from "node:assert/strict";
import {
  formatSuggestMentorsResponse,
  formatSuggestMenteesResponse,
} from "../src/app/api/ai/[orgId]/chat/handler/formatters/reads.ts";

function resolvedMentees() {
  return {
    state: "resolved",
    mentor: { name: "Cole Reed" },
    suggestions: [
      {
        mentee: { name: "Isaiah Walsh", subtitle: "Consulting Analyst" },
        confidence: 68,
        confidenceLabel: "Good",
        reasons: [
          { label: "Shared topics", value: "consulting,strategy,leadership" },
          { label: "Skills you want", value: "strategy" },
          { label: "Same school", value: "villanova university" },
        ],
      },
      {
        mentee: { name: "Talia Rogers", subtitle: null },
        confidence: 68,
        confidenceLabel: "Good",
        reasons: [{ label: "Shared industry", value: "Consulting" }],
      },
    ],
  };
}

test("mentee suggestions render as a markdown heading with bold numbered names", () => {
  const out = formatSuggestMenteesResponse(resolvedMentees());
  assert.ok(out);
  assert.match(out, /^### Top mentees for Cole Reed/);
  assert.match(out, /\*\*1\. Isaiah Walsh — Consulting Analyst\*\*/);
  assert.match(out, /\*\*2\. Talia Rogers\*\*/);
});

test("confidence is on its own line, not jammed into the name", () => {
  const out = formatSuggestMenteesResponse(resolvedMentees())!;
  assert.match(out, /Confidence: 68\/100 \(Good\)/);
  // Old buried "(Confidence .. )" suffix on the name line is gone.
  assert.ok(!/\*\*1\..*\(Confidence/.test(out));
});

test("each reason is its own bullet and comma lists get spacing", () => {
  const out = formatSuggestMenteesResponse(resolvedMentees())!;
  assert.match(out, /\n- Shared topics: consulting, strategy, leadership/);
  assert.match(out, /\n- Skills you want: strategy/);
  assert.match(out, /\n- Same school: villanova university/);
  // No comma-jammed values remain.
  assert.ok(!out.includes("consulting,strategy"));
  // No legacy single-line "Why:" dump.
  assert.ok(!out.includes("Why:"));
});

test("people are separated by a divider with surrounding blank lines", () => {
  const out = formatSuggestMenteesResponse(resolvedMentees())!;
  assert.match(out, /\n\n---\n\n/);
});

test("mentor suggestions share the same structure", () => {
  const out = formatSuggestMentorsResponse({
    state: "resolved",
    mentee: { name: "Brooke Esposito" },
    suggestions: [
      {
        mentor: { name: "Olivia Perez", subtitle: "VP at Citi" },
        confidence: 63,
        confidenceLabel: "Moderate",
        reasons: [{ label: "Shared industry", value: "Finance" }],
      },
    ],
  });
  assert.ok(out);
  assert.match(out, /^### Top mentors for Brooke Esposito/);
  assert.match(out, /\*\*1\. Olivia Perez — VP at Citi\*\*/);
  assert.match(out, /Confidence: 63\/100 \(Moderate\)/);
  assert.match(out, /\n- Shared industry: Finance/);
});

test("non-resolved states keep their plain copy (no markdown heading)", () => {
  assert.equal(
    formatSuggestMenteesResponse({ state: "unauthorized" }),
    "Mentee suggestions are currently available to admins only."
  );
  assert.equal(
    formatSuggestMentorsResponse({
      state: "no_suggestions",
      mentee: { name: "Brooke Esposito" },
    }),
    "I found Brooke Esposito, but there are no eligible mentors matching their preferences right now."
  );
});
