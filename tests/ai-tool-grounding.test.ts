import test from "node:test";
import assert from "node:assert/strict";
import { verifyToolBackedResponse } from "../src/lib/ai/tool-grounding.ts";

test("verifyToolBackedResponse accepts grounded org stats summaries", () => {
  const result = verifyToolBackedResponse({
    content:
      "Your organization has:\n- Active Members: 23\n- Alumni: 10\n- Parents: 1\n\nTotal: 34 people across all member types.",
    toolResults: [
      {
        name: "get_org_stats",
        data: { active_members: 23, alumni: 10, parents: 1, upcoming_events: 4, donations: null },
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags unsupported org stats summaries", () => {
  const result = verifyToolBackedResponse({
    content: "Your organization has 99 active members and a total of 120 people.",
    toolResults: [
      {
        name: "get_org_stats",
        data: { active_members: 23, alumni: 10, parents: 1, upcoming_events: 4, donations: null },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /active members claim 99 did not match 23/i);
});

test("verifyToolBackedResponse flags member names absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: "- Jane Smith\n- Ghost Person",
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "Jane Smith", email: "jane@example.com" },
          { name: "John Doe", email: "john@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /ghost person/i);
});

test("verifyToolBackedResponse flags event dates absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: 'Upcoming event: "Spring Gala" on 2026-05-01.',
    toolResults: [
      {
        name: "list_events",
        data: [
          { title: "Spring Gala", start_date: "2026-04-01T18:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /2026-05-01/i);
});

test("verifyToolBackedResponse flags unsupported suggest_connections reasons", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Who Alex Source should connect with",
      "1. Dina Direct - VP Product • Acme",
      "Why: direct mentorship and shared city",
    ].join("\n"),
    toolResults: [
      {
        name: "suggest_connections",
        data: {
          state: "resolved",
          mode: "sql_fallback",
          source_person: {
            name: "Alex Source",
          },
          freshness: { state: "fresh", as_of: "2026-03-24T00:00:00.000Z" },
          suggestions: [
            {
              name: "Dina Direct",
              reasons: [{ code: "direct_mentorship", label: "direct mentorship", weight: 100 }],
            },
          ],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /shared_city/i);
});

test("verifyToolBackedResponse accepts fixed-template suggest_connections output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Who Alex Source should connect with",
      "1. Dina Direct - VP Product • Acme",
      "Why: direct mentorship, shared company, shared graduation year",
    ].join("\n"),
    toolResults: [
      {
        name: "suggest_connections",
        data: {
          state: "resolved",
          mode: "sql_fallback",
          source_person: {
            name: "Alex Source",
          },
          freshness: { state: "fresh", as_of: "2026-03-24T00:00:00.000Z" },
          suggestions: [
            {
              name: "Dina Direct",
              reasons: [
                { code: "direct_mentorship", label: "direct mentorship", weight: 100 },
                { code: "shared_company", label: "shared company", weight: 20 },
                { code: "shared_graduation_year", label: "shared graduation year", weight: 8 },
              ],
            },
          ],
        },
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse rejects out-of-order suggest_connections output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Who Alex Source should connect with",
      "1. Sam Second - Founder",
      "Why: second-degree mentorship",
      "2. Dina Direct - VP Product • Acme",
      "Why: direct mentorship",
    ].join("\n"),
    toolResults: [
      {
        name: "suggest_connections",
        data: {
          state: "resolved",
          mode: "sql_fallback",
          source_person: {
            name: "Alex Source",
          },
          freshness: { state: "fresh", as_of: "2026-03-24T00:00:00.000Z" },
          suggestions: [
            {
              name: "Dina Direct",
              reasons: [{ code: "direct_mentorship", label: "direct mentorship", weight: 100 }],
            },
            {
              name: "Sam Second",
              reasons: [{ code: "second_degree_mentorship", label: "second-degree mentorship", weight: 50 }],
            },
          ],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /out of ranked order/i);
});

test("verifyToolBackedResponse does not treat non-location 'both in' phrasing as shared_city", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Who Alex Source should connect with",
      "1. Dina Direct - VP Product • Acme",
      "Why: direct mentorship and both in the finance sector",
    ].join("\n"),
    toolResults: [
      {
        name: "suggest_connections",
        data: {
          state: "resolved",
          mode: "sql_fallback",
          source_person: {
            name: "Alex Source",
          },
          freshness: { state: "fresh", as_of: "2026-03-24T00:00:00.000Z" },
          suggestions: [
            {
              name: "Dina Direct",
              reasons: [{ code: "direct_mentorship", label: "direct mentorship", weight: 100 }],
            },
          ],
        },
      },
    ],
  });

  assert.equal(result.grounded, true);
});
