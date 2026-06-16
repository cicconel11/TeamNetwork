import test from "node:test";
import assert from "node:assert/strict";
import { formatMultiSuggestionToolResponse } from "../src/app/api/ai/[orgId]/chat/handler/formatters/index.ts";

function resolvedMentors(menteeName: string, mentorName: string) {
  return {
    state: "resolved",
    mentee: { name: menteeName },
    suggestions: [
      {
        mentor: { name: mentorName, subtitle: "Healthcare Consultant at Pfizer" },
        confidence: 82,
        confidenceLabel: "Good",
        reasons: [
          { label: "Shared topics", value: "healthcare,operations" },
          { label: "Same school", value: "villanova university" },
        ],
      },
    ],
  };
}

test("compare query: two suggest_mentors results render deterministically and concatenate", () => {
  const out = formatMultiSuggestionToolResponse([
    { name: "suggest_mentors", data: resolvedMentors("Brooke Esposito", "Maria Bell") },
    { name: "suggest_mentors", data: resolvedMentors("Maya Bell", "Ryan Romano") },
  ]);
  assert.ok(out, "expected a rendered string");
  // Both headings present — one per mentee — proving each list was rendered.
  assert.match(out, /### Top mentors for Brooke Esposito/);
  assert.match(out, /### Top mentors for Maya Bell/);
  // Real names from both lists appear; nothing invented.
  assert.match(out, /\*\*1\. Maria Bell — Healthcare Consultant at Pfizer\*\*/);
  assert.match(out, /\*\*1\. Ryan Romano — Healthcare Consultant at Pfizer\*\*/);
  // The first heading precedes the second (stable ordering).
  assert.ok(out.indexOf("Brooke Esposito") < out.indexOf("Maya Bell"));
});

test("mixed directions (mentors + mentees) both render", () => {
  const out = formatMultiSuggestionToolResponse([
    { name: "suggest_mentors", data: resolvedMentors("Brooke Esposito", "Maria Bell") },
    {
      name: "suggest_mentees",
      data: {
        state: "resolved",
        mentor: { name: "Cole Reed" },
        suggestions: [
          {
            mentee: { name: "Talia Rogers", subtitle: null },
            confidence: 70,
            confidenceLabel: "Good",
            reasons: [{ label: "Shared industry", value: "Consulting" }],
          },
        ],
      },
    },
  ]);
  assert.ok(out);
  assert.match(out, /### Top mentors for Brooke Esposito/);
  assert.match(out, /### Top mentees for Cole Reed/);
});

test("returns null for a single result (single-tool path handles it)", () => {
  const out = formatMultiSuggestionToolResponse([
    { name: "suggest_mentors", data: resolvedMentors("Brooke Esposito", "Maria Bell") },
  ]);
  assert.equal(out, null);
});

test("returns null when any result is not a suggestion tool (falls back to pass-2)", () => {
  const out = formatMultiSuggestionToolResponse([
    { name: "suggest_mentors", data: resolvedMentors("Brooke Esposito", "Maria Bell") },
    { name: "list_members", data: [{ name: "Someone" }] },
  ]);
  assert.equal(out, null);
});

test("returns null when any list fails to render (falls back to pass-2)", () => {
  const out = formatMultiSuggestionToolResponse([
    { name: "suggest_mentors", data: resolvedMentors("Brooke Esposito", "Maria Bell") },
    { name: "suggest_mentors", data: { not: "a valid payload" } },
  ]);
  assert.equal(out, null);
});

test("non-resolved states still render (e.g. not_found) so the user gets an answer", () => {
  const out = formatMultiSuggestionToolResponse([
    { name: "suggest_mentors", data: resolvedMentors("Brooke Esposito", "Maria Bell") },
    { name: "suggest_mentors", data: { state: "not_found" } },
  ]);
  assert.ok(out);
  assert.match(out, /### Top mentors for Brooke Esposito/);
  assert.match(out, /couldn't find that person/i);
});
