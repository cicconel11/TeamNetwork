import test from "node:test";
import assert from "node:assert/strict";
import { parseCurrencyClaim, verifyToolBackedResponse } from "../src/lib/ai/tool-grounding.ts";

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

test("verifyToolBackedResponse accepts grounded donation analytics summaries", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 8",
      "- Raised: $450",
      "- Average successful donation: $56",
      "- Largest successful donation: $125",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 8,
            successful_amount_cents: 45000,
            average_successful_amount_cents: 5625,
            largest_successful_amount_cents: 12500,
          },
        },
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags unsupported donation analytics summaries", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 9",
      "- Raised: $999",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 8,
            successful_amount_cents: 45000,
            average_successful_amount_cents: 5625,
            largest_successful_amount_cents: 12500,
          },
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.match(result.failures.join("\n"), /successful donations claim 9 did not match 8/i);
  assert.match(result.failures.join("\n"), /raised claim \$999 did not match \$450/i);
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

test("verifyToolBackedResponse accepts member labels decorated with positions or titles from RAG", () => {
  // Regression: list_members rows only carry name/email/role/etc, no position
  // or title. The model legitimately enriches names with parenthetical context
  // pulled from RAG chunks (player position, board title, etc). Grounding
  // should match on the bare name and ignore the trailing parenthetical.
  const result = verifyToolBackedResponse({
    content: [
      "- JT Goodman (Running Back)",
      "- Louis Ciccone (Chairman and CEO)",
      "- Jacob Rios (DLINE)",
    ].join("\n"),
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "JT Goodman", email: "jt@example.com" },
          { name: "Louis Ciccone", email: "louis@example.com" },
          { name: "Jacob Rios", email: "jacob@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse still flags fabricated member names even when decorated", () => {
  // Regression guard for the fix above: stripping parentheticals must not
  // accidentally accept fabricated bare names. The bare name still has to
  // exist in tool rows. Includes an asymmetric case (Jane Doe shares the
  // first token "Jane" with real row Jane Smith) to prove the matcher
  // requires the *full* bare name, not just a prefix.
  const result = verifyToolBackedResponse({
    content: [
      "- Ghost Player (Wide Receiver)",
      "- Jane Doe (Captain)",
    ].join("\n"),
    toolResults: [
      {
        name: "list_members",
        data: [
          { name: "Jane Smith", email: "jane@example.com" },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  const joined = result.failures.join("\n");
  assert.match(joined, /ghost player/i);
  assert.match(joined, /jane doe/i);
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

test("verifyToolBackedResponse accepts partial discussion title quote", () => {
  const result = verifyToolBackedResponse({
    content: '- "My new Thread" has 2 replies',
    toolResults: [
      {
        name: "list_discussions",
        data: [
          { title: "My new Thread - Check it out!", body: "...", reply_count: 2, is_pinned: false, is_locked: false },
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

test("parseCurrencyClaim handles commas, decimals, and k suffix", () => {
  const cases = [
    { content: "- Raised: $1,234", label: "raised", expected: 1234 },
    { content: "- Raised: $1.2k", label: "raised", expected: 1200 },
    { content: "- Raised: $1234.56", label: "raised", expected: 1235 },
    { content: "- Raised: $12.345", label: "raised", expected: null },
    { content: "No amount here", label: "raised", expected: null },
  ];
  for (const tc of cases) {
    assert.equal(
      parseCurrencyClaim(tc.content, tc.label),
      tc.expected,
      `parseCurrencyClaim(${JSON.stringify(tc.content)})`
    );
  }
});

test("verifyToolBackedResponse flags hallucinated donation trend rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (180-day window)",
      "- Successful donations: 1",
      "- Raised: $100",
      "Trend",
      "- 2026-03 - 1 donations - $100",
      "- 2026-04 - 5 donations - $5000",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 1,
            successful_amount_cents: 10000,
            average_successful_amount_cents: 10000,
            largest_successful_amount_cents: 10000,
          },
          trend: [{ bucket_label: "2026-03", amount_cents: 10000, donation_count: 1 }],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /trend row 2026-04/i.test(f)));
});

test("verifyToolBackedResponse flags mismatched donation counts in trend rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (180-day window)",
      "- Successful donations: 1",
      "- Raised: $100",
      "Trend",
      "- 2026-03 - 99 donations - $100",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 1,
            successful_amount_cents: 10000,
            average_successful_amount_cents: 10000,
            largest_successful_amount_cents: 10000,
          },
          trend: [{ bucket_label: "2026-03", amount_cents: 10000, donation_count: 1 }],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /trend donation count claim 99 did not match 1/i.test(f)));
});

test("verifyToolBackedResponse flags hallucinated top purposes", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 1",
      "- Raised: $100",
      "Top purposes",
      "- Fake Drive - 9 donations - $9000",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 1,
            successful_amount_cents: 10000,
            average_successful_amount_cents: 10000,
            largest_successful_amount_cents: 10000,
          },
          trend: [],
          top_purposes: [
            { purpose: "Alumni Campaign", amount_cents: 10000, donation_count: 1 },
          ],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /top purpose fake drive/i.test(f)));
});

test("verifyToolBackedResponse flags mismatched donation counts in top-purpose rows", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 1",
      "- Raised: $100",
      "Top purposes",
      "- Alumni Campaign - 99 donations - $100",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 1,
            successful_amount_cents: 10000,
            average_successful_amount_cents: 10000,
            largest_successful_amount_cents: 10000,
          },
          trend: [],
          top_purposes: [
            { purpose: "Alumni Campaign", amount_cents: 10000, donation_count: 1 },
          ],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /top purpose donation count claim 99 did not match 1/i.test(f)));
});

test("verifyToolBackedResponse flags freeform donation paraphrase lacking formatter labels", () => {
  const result = verifyToolBackedResponse({
    content: "You received 8 donations totaling $450 across the last quarter.",
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 8,
            successful_amount_cents: 45000,
            average_successful_amount_cents: 5625,
            largest_successful_amount_cents: 12500,
          },
          trend: [],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /did not reference formatter labels/i.test(f)));
});

test("verifyToolBackedResponse accepts currency k-suffix claim that matches cents", () => {
  const result = verifyToolBackedResponse({
    content: [
      "Donation analytics (90-day window)",
      "- Successful donations: 5",
      "- Raised: $1.2k",
    ].join("\n"),
    toolResults: [
      {
        name: "get_donation_analytics",
        data: {
          totals: {
            successful_donation_count: 5,
            successful_amount_cents: 120000,
            average_successful_amount_cents: 24000,
            largest_successful_amount_cents: 50000,
          },
          trend: [],
          top_purposes: [],
        },
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse accepts grounded list_donations output", () => {
  const result = verifyToolBackedResponse({
    content: '- "Alumni Campaign" - $125 - jane@example.com',
    toolResults: [
      {
        name: "list_donations",
        data: [
          {
            donor_name: "Jane Doe",
            donor_email: "jane@example.com",
            amount_dollars: 125,
            purpose: "Alumni Campaign",
            status: "succeeded",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.failures, []);
});

test("verifyToolBackedResponse flags hallucinated donor in list_donations", () => {
  const result = verifyToolBackedResponse({
    content: '- "Ghost Donor" gave $125',
    toolResults: [
      {
        name: "list_donations",
        data: [
          {
            donor_name: "Jane Doe",
            donor_email: "jane@example.com",
            amount_dollars: 125,
            purpose: "Alumni Campaign",
            status: "succeeded",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /ghost donor/i.test(f)));
});

test("verifyToolBackedResponse flags donation amount absent from tool rows", () => {
  const result = verifyToolBackedResponse({
    content: "Recent donation of $9999 from an anonymous supporter.",
    toolResults: [
      {
        name: "list_donations",
        data: [
          {
            donor_name: "Anonymous",
            donor_email: null,
            amount_dollars: 125,
            purpose: "Alumni Campaign",
            status: "succeeded",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /\$9999/i.test(f)));
});

test("verifyToolBackedResponse flags donor leak when hide_donor_names is enabled", () => {
  const result = verifyToolBackedResponse({
    content: '- "Jane Doe" - $125',
    orgContext: { hideDonorNames: true },
    toolResults: [
      {
        name: "list_donations",
        data: [
          {
            donor_name: "Jane Doe",
            donor_email: "jane@example.com",
            amount_dollars: 125,
            purpose: "Alumni Campaign",
            status: "succeeded",
          },
        ],
      },
    ],
  });

  assert.equal(result.grounded, false);
  assert.ok(result.failures.some((f) => /jane doe.*leaked/i.test(f)));
});
