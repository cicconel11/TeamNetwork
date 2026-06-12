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

test("code-bearing reasons render human copy, not raw label:value", () => {
  const out = formatSuggestMentorsResponse({
    state: "resolved",
    mentee: { name: "Reese Price" },
    suggestions: [
      {
        mentor: { name: "Maria Bell", subtitle: "Healthcare Consultant at Pfizer" },
        confidence: 63,
        confidenceLabel: "Moderate",
        reasons: [
          { code: "graduation_gap_fit", label: "Graduation gap fit", value: 8 },
          { code: "career_trajectory", label: "Walked your path", value: "Operations" },
          { code: "shared_industry", label: "Shared industry", value: "Healthcare" },
        ],
      },
    ],
  })!;
  // Raw internal number is humanized.
  assert.match(out, /\n- 8 years ahead in career/);
  assert.ok(!out.includes("Graduation gap fit: 8"));
  assert.match(out, /\n- Has worked in Operations/);
  assert.match(out, /\n- Same industry: Healthcare/);
});

test("mentee-direction reasons flip perspective-sensitive copy", () => {
  const out = formatSuggestMenteesResponse({
    state: "resolved",
    mentor: { name: "Emily Adams" },
    suggestions: [
      {
        mentee: { name: "Dominic Romano", subtitle: null },
        confidence: 89,
        confidenceLabel: "High",
        reasons: [
          { code: "aspirational_skill", label: "Skills you want", value: "operations,healthcare" },
          { code: "career_trajectory", label: "Walked your path", value: "Operations" },
          { code: "graduation_gap_fit", label: "Graduation gap fit", value: 14 },
        ],
      },
    ],
  })!;
  assert.match(out, /\n- Wants skills you have: operations, healthcare/);
  assert.match(out, /\n- Wants to follow your path: Operations/);
  assert.match(out, /\n- You're 14 years ahead in career/);
  // The mentor-perspective wording must not appear in the mentee direction.
  assert.ok(!out.includes("Skills you want"));
  assert.ok(!out.includes("Walked your path"));
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

/* ── Suggestion list sizing: default 4, trim to 3 when top matches are High ── */

test("trimHighConfidenceSuggestions cuts to 3 when the top 3 are all High", async () => {
  const { trimHighConfidenceSuggestions } = await import(
    "../src/lib/mentorship/presentation.ts"
  );
  const list = [
    { confidence: 92 },
    { confidence: 88 },
    { confidence: 85 },
    { confidence: 70 },
  ];
  assert.deepEqual(trimHighConfidenceSuggestions(list), list.slice(0, 3));
});

test("trimHighConfidenceSuggestions keeps the full list when any top match is below High", async () => {
  const { trimHighConfidenceSuggestions } = await import(
    "../src/lib/mentorship/presentation.ts"
  );
  const list = [
    { confidence: 92 },
    { confidence: 84 }, // Good, not High
    { confidence: 80 },
    { confidence: 70 },
  ];
  assert.deepEqual(trimHighConfidenceSuggestions(list), list);
});

test("trimHighConfidenceSuggestions leaves lists of 3 or fewer untouched", async () => {
  const { trimHighConfidenceSuggestions } = await import(
    "../src/lib/mentorship/presentation.ts"
  );
  const short = [{ confidence: 95 }, { confidence: 90 }];
  assert.deepEqual(trimHighConfidenceSuggestions(short), short);
});

test("default suggestion limit is 4 and suggest functions use it (source assert)", async () => {
  const { DEFAULT_SUGGESTION_LIMIT, HIGH_CONFIDENCE_TRIM_LIMIT } = await import(
    "../src/lib/mentorship/presentation.ts"
  );
  assert.equal(DEFAULT_SUGGESTION_LIMIT, 4);
  assert.equal(HIGH_CONFIDENCE_TRIM_LIMIT, 3);

  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL("../src/lib/mentorship/ai-suggestions.ts", import.meta.url),
    "utf8"
  );
  // Both directions default to the shared limit, never a hardcoded 5.
  const defaults = src.match(/opts\.limit \?\? DEFAULT_SUGGESTION_LIMIT/g) ?? [];
  assert.equal(defaults.length, 2);
  // Auto-trim applies only when the caller passed no explicit limit.
  const trims = src.match(/trimHighConfidenceSuggestions\(suggestions\)/g) ?? [];
  assert.equal(trims.length, 2);
});
