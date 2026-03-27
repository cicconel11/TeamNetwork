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

test("verifyToolBackedResponse accepts grounded list_announcements output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Here are the latest announcements:",
      "1. Spring Fundraiser Launch — posted 2026-03-01",
      "2. New Member Welcome — posted 2026-02-15",
    ].join("\n"),
    toolResults: [
      {
        name: "list_announcements",
        data: [
          { title: "Spring Fundraiser Launch", published_at: "2026-03-01T00:00:00.000Z" },
          { title: "New Member Welcome", published_at: "2026-02-15T00:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags announcement title absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Here are the latest announcements:",
      "1. \"Ghost Announcement\" — posted 2026-03-01",
    ].join("\n"),
    toolResults: [
      {
        name: "list_announcements",
        data: [
          { title: "Spring Fundraiser Launch", published_at: "2026-03-01T00:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /ghost announcement/i);
});

test("verifyToolBackedResponse accepts grounded list_discussions output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Active discussions:",
      "1. Alumni Networking Ideas — 12 replies",
      "2. Event Planning Tips — 4 replies",
    ].join("\n"),
    toolResults: [
      {
        name: "list_discussions",
        data: [
          { title: "Alumni Networking Ideas", reply_count: 12 },
          { title: "Event Planning Tips", reply_count: 4 },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags discussion reply count mismatch", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Active discussions:",
      "1. \"Alumni Networking Ideas\" — 99 replies",
    ].join("\n"),
    toolResults: [
      {
        name: "list_discussions",
        data: [
          { title: "Alumni Networking Ideas", reply_count: 12 },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /discussion reply count claim 99 did not match 12/i);
});

test("verifyToolBackedResponse accepts grounded list_job_postings output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Open positions:",
      "1. Senior Engineer - Acme Corp",
      "2. Product Manager - Beta Inc",
    ].join("\n"),
    toolResults: [
      {
        name: "list_job_postings",
        data: [
          { title: "Senior Engineer", company: "Acme Corp" },
          { title: "Product Manager", company: "Beta Inc" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags job title absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Open positions:",
      "1. \"Ghost Job\" at Mystery Co",
    ].join("\n"),
    toolResults: [
      {
        name: "list_job_postings",
        data: [
          { title: "Senior Engineer", company: "Acme Corp" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /ghost job/i);
});
