import test from "node:test";
import assert from "node:assert/strict";
import { verifyToolBackedResponse } from "../src/lib/ai/tool-grounding.ts";

const FRESH_FRESHNESS = { state: "fresh", as_of: "2026-03-24T00:00:00.000Z" } as const;

function makeSuggestConnectionsToolResult(suggestions: Array<{
  name: string;
  reasons: Array<{ code: string; label: string; weight: number }>;
}>) {
  return {
    name: "suggest_connections" as const,
    data: {
      state: "resolved",
      mode: "sql_fallback",
      source_person: { name: "Alex Source" },
      freshness: FRESH_FRESHNESS,
      suggestions,
    },
  };
}

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

test("verifyToolBackedResponse accepts member labels with presentation-only role suffixes", () => {
  const result = verifyToolBackedResponse({
    content: "- Patrick Leonard (Parent)\n- Jane Smith (Admin)",
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "Patrick Leonard", email: "patrick@example.com" },
          { name: "Jane Smith", email: "jane@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse ignores list-member field labels", () => {
  const result = verifyToolBackedResponse({
    content: [
      "- Patrick Leonard (Parent): Email: patrick@example.com",
      "- Jane Smith (Admin): Email: jane@example.com",
    ].join("\n"),
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "Patrick Leonard", email: "patrick@example.com" },
          { name: "Jane Smith", email: "jane@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse rejects unsupported member count claims when answer is not partial", () => {
  const result = verifyToolBackedResponse({
    content: "You have 35 active members in this organization.",
    toolResults: [
      {
        name: "list_members",
        data: Array.from({ length: 20 }, (_, index) => ({
          name: `Member ${index + 1}`,
          email: `member${index + 1}@example.com`,
        })),
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /member count claim 35 exceeded returned rows 20/i);
});

test("verifyToolBackedResponse accepts bounded partial member phrasing", () => {
  const result = verifyToolBackedResponse({
    content: "Showing the first 20 active members:\n- Member 1\n- Member 2",
    toolResults: [
      {
        name: "list_members",
        data: Array.from({ length: 20 }, (_, index) => ({
          name: `Member ${index + 1}`,
          email: `member${index + 1}@example.com`,
        })),
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
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

test("verifyToolBackedResponse flags announcement titles absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Recent announcements",
      "- Welcome back - 2026-03-20 - audience: all",
      "- Ghost update - 2026-03-21 - audience: members",
    ].join("\n"),
    toolResults: [
      {
        name: "list_announcements",
        data: [
          {
            title: "Welcome back",
            published_at: "2026-03-20T12:00:00.000Z",
            audience: "all",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /ghost update/i);
});

test("verifyToolBackedResponse flags unsupported suggest_connections reasons", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: direct mentorship and shared city",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        { name: "Dina Direct", reasons: [{ code: "shared_city", label: "shared city", weight: 15 }] },
      ]),
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /unsupported_mentorship/i);
});

test("verifyToolBackedResponse accepts fixed-template suggest_connections output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: shared industry, shared company, shared role family",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        {
          name: "Dina Direct",
          reasons: [
            { code: "shared_industry", label: "shared industry", weight: 40 },
            { code: "shared_company", label: "shared company", weight: 30 },
            { code: "shared_role_family", label: "shared role family", weight: 20 },
          ],
        },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse rejects out-of-order suggest_connections output", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Sam Second - Founder",
      "Why: shared city",
      "2. Dina Direct - VP Product • Acme",
      "Why: shared industry",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        { name: "Dina Direct", reasons: [{ code: "shared_industry", label: "shared industry", weight: 40 }] },
        { name: "Sam Second", reasons: [{ code: "shared_city", label: "shared city", weight: 15 }] },
      ]),
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /out of ranked order/i);
});

test("verifyToolBackedResponse does not treat non-location 'both in' phrasing as shared_city", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: shared industry and both in the finance sector",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        { name: "Dina Direct", reasons: [{ code: "shared_industry", label: "shared industry", weight: 40 }] },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
});

test("verifyToolBackedResponse accepts shared graduation year phrasing as graduation proximity", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: shared graduation year",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        { name: "Dina Direct", reasons: [{ code: "graduation_proximity", label: "graduation proximity", weight: 10 }] },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse ignores adjacency wording that is not a scored reason", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Top connections for Alex Source",
      "1. Dina Direct - VP Product • Acme",
      "Why: adjacent role family, shared industry",
    ].join("\n"),
    toolResults: [
      makeSuggestConnectionsToolResult([
        { name: "Dina Direct", reasons: [{ code: "shared_industry", label: "shared industry", weight: 24 }] },
      ]),
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse accepts grounded list_discussions output", () => {
  const result = verifyToolBackedResponse({
    content: 'Active discussions:\n- "Best practices for onboarding"\n- "Event planning thread"',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          { title: "Best practices for onboarding", body: "Let's discuss...", reply_count: 5, is_pinned: false, is_locked: false, last_activity_at: "2026-03-20T00:00:00.000Z" },
          { title: "Event planning thread", body: "Planning...", reply_count: 12, is_pinned: true, is_locked: false, last_activity_at: "2026-03-18T00:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags fabricated discussion title", () => {
  const result = verifyToolBackedResponse({
    content: '- "Real Thread"\n- "Ghost Thread"',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          { title: "Real Thread", body: "...", reply_count: 3, is_pinned: false, is_locked: false },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /ghost thread/i.test(f)));
});

test("verifyToolBackedResponse flags incorrect discussion reply count", () => {
  const result = verifyToolBackedResponse({
    content: '- "Active Discussion" has 99 replies',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          { title: "Active Discussion", body: "...", reply_count: 5, is_pinned: false, is_locked: false },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /reply count claim 99 did not match 5/i.test(f)));
});

test("verifyToolBackedResponse accepts grounded list_job_postings output", () => {
  const result = verifyToolBackedResponse({
    content: 'Current openings:\n- "Software Engineer" at "Acme Corp"\n- "Product Manager" at "Beta Inc"',
    toolResults: [
      {
        name: "list_job_postings",
        data: [
          { title: "Software Engineer", company: "Acme Corp", location: "San Francisco", is_active: true },
          { title: "Product Manager", company: "Beta Inc", location: "Remote", is_active: true },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags fabricated company in job postings", () => {
  const result = verifyToolBackedResponse({
    content: '- "Software Engineer" at "Fake Company"',
    toolResults: [
      {
        name: "list_job_postings",
        data: [
          { title: "Software Engineer", company: "Acme Corp", location: "San Francisco", is_active: true },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /fake company/i.test(f)));
});

test("verifyToolBackedResponse flags inflated job posting count", () => {
  const result = verifyToolBackedResponse({
    content: "There are 15 job openings available.",
    toolResults: [
      {
        name: "list_job_postings",
        data: [
          { title: "Engineer", company: "Acme", location: "NYC", is_active: true },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /job posting count claim 15/i.test(f)));
});
