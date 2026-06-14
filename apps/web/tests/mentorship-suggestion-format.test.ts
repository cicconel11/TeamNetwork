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

test("match score is on its own line, not jammed into the name", () => {
  const out = formatSuggestMenteesResponse(resolvedMentees())!;
  assert.match(out, /Match score: 68\/100 \(Good\)/);
  // "Confidence" copy is gone — it read like the AI guessing.
  assert.ok(!out.includes("Confidence"));
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
  assert.match(out, /Match score: 63\/100 \(Moderate\)/);
  assert.match(out, /\n- Shared industry: Finance/);
});

test("mentor suggestions can render criteria-only headings", () => {
  const out = formatSuggestMentorsResponse({
    state: "resolved",
    mentee: null,
    criteriaLabel: "marketing",
    suggestions: [
      {
        mentor: { name: "Olivia Perez", subtitle: "Growth Lead at Citi" },
        confidence: 63,
        confidenceLabel: "Moderate",
        reasons: [{ code: "shared_topics", value: "marketing" }],
      },
    ],
  });
  assert.ok(out);
  assert.match(out, /^### Top mentors for "marketing"/);
  assert.match(out, /\*\*1\. Olivia Perez — Growth Lead at Citi\*\*/);
});

test("mentee suggestions can render criteria-only headings", () => {
  const out = formatSuggestMenteesResponse({
    state: "resolved",
    mentor: null,
    criteriaLabel: "law",
    suggestions: [
      {
        mentee: { name: "Jordan Lee", subtitle: null },
        confidence: 63,
        confidenceLabel: "Moderate",
        reasons: [{ code: "shared_industry", value: "Law" }],
      },
    ],
  });
  assert.ok(out);
  assert.match(out, /^### Top mentees for "law"/);
  assert.match(out, /\*\*1\. Jordan Lee\*\*/);
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
  assert.equal(
    formatSuggestMentorsResponse({
      state: "no_suggestions",
      mentee: null,
      criteriaLabel: "marketing",
    }),
    'There are no eligible mentors matching "marketing" right now.'
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

/* ── Differentiated rendering: shared-signal collapse, rank edge, questions ── */

function lawCohortMentors() {
  const shared = [
    { code: "shared_topics", value: "law,leadership" },
    { code: "shared_industry", value: "Law" },
    { code: "shared_role_family", value: "Law" },
    { code: "shared_school", value: "villanova university" },
  ];
  return {
    state: "resolved",
    mentee: { name: "Maya Bell" },
    suggestions: [
      {
        mentor: { name: "Brandon Morgan", subtitle: "Associate Attorney at Morgan Lewis" },
        confidence: 72,
        confidenceLabel: "Good",
        reasons: [...shared, { code: "graduation_gap_fit", value: 9 }],
      },
      {
        mentor: { name: "Sofia Russo", subtitle: "Litigation Associate at Kirkland & Ellis" },
        confidence: 70,
        confidenceLabel: "Good",
        reasons: [...shared, { code: "graduation_gap_fit", value: 12 }],
      },
      {
        mentor: { name: "Brian Brooks", subtitle: "Associate Attorney at Dechert" },
        confidence: 67,
        confidenceLabel: "Good",
        reasons: [...shared],
      },
    ],
  };
}

test("reasons shared by every suggestion collapse into a compact common-signals line", () => {
  const out = formatSuggestMentorsResponse(lawCohortMentors())!;
  assert.match(
    out,
    /_Common match signals across all 3: Law interests · Leadership interests · Law industry · Law career path · Villanova University_/
  );
  // The collapsed reasons no longer repeat as per-mentor bullets.
  const industryBullets = out.match(/\n- Same industry: Law/g) ?? [];
  assert.equal(industryBullets.length, 0);
});

test("per-mentor bullets show only differentiators", () => {
  const out = formatSuggestMentorsResponse(lawCohortMentors())!;
  // Sofia keeps her gap bullet; Brandon's gap is consumed by the why-first line.
  assert.match(out, /\n- 12 years ahead in career/);
  // No card falls back to the filler line — every card has a Best for line.
  assert.ok(!out.includes("Matches on the shared signals above"));
});

test("the top match gets a why-ranked-first line explaining the closer career-stage fit", () => {
  const out = formatSuggestMentorsResponse(lawCohortMentors())!;
  assert.match(
    out,
    /_Why Brandon ranks #1: closest career-stage fit of these matches \(9 years ahead vs 12\) — recent enough to speak to your next steps_/
  );
  // The gap reason is not duplicated as a bullet on Brandon's card.
  const nineYears = out.match(/\n- 9 years ahead in career/g) ?? [];
  assert.equal(nineYears.length, 0);
});

test("every mentor card gets a Best for positioning line from its own data", () => {
  const out = formatSuggestMentorsResponse(lawCohortMentors())!;
  assert.match(
    out,
    /Best for: early-career advice close to your stage and the Associate Attorney perspective from Morgan Lewis/
  );
  assert.match(
    out,
    /Best for: a more seasoned view of the path and the Litigation Associate perspective from Kirkland & Ellis/
  );
  assert.match(out, /Best for: the Associate Attorney perspective from Dechert/);
});

test("no why-ranked-first line when the top two have identical reason sets", () => {
  const payload = lawCohortMentors();
  payload.suggestions = payload.suggestions.slice(2, 3).concat(payload.suggestions.slice(2, 3));
  const out = formatSuggestMentorsResponse(payload)!;
  assert.ok(!out.includes("ranks #1"));
});

test("mentor direction appends grounded conversation-starter questions for the top match", () => {
  const out = formatSuggestMentorsResponse(lawCohortMentors())!;
  assert.match(out, /\*\*Questions to ask Brandon:\*\*/);
  assert.match(out, /- What should someone aiming for a career in Law be doing right now\?/);
  assert.match(out, /- How did you break into Law\?/);
  // Capped at 3.
  const questionBullets = out.split("Questions to ask")[1].split("\n").filter((l) => l.startsWith("- "));
  assert.equal(questionBullets.length, 3);
});

test("mentee direction never renders suggested questions", () => {
  const out = formatSuggestMenteesResponse(resolvedMentees())!;
  assert.ok(!out.includes("Questions to ask"));
});

test("no collapse line when fewer than two reasons are shared by all", () => {
  const out = formatSuggestMenteesResponse(resolvedMentees())!;
  assert.ok(!out.includes("Common match signals"));
  // Original per-card bullets stay intact.
  assert.match(out, /\n- Shared topics: consulting, strategy, leadership/);
});

test("mentee direction renders no Best for or why-ranked lines", () => {
  const out = formatSuggestMenteesResponse(resolvedMentees())!;
  assert.ok(!out.includes("Best for:"));
  assert.ok(!out.includes("ranks #1"));
});

test("mentee-direction card with no differentiators keeps the shared-signals anchor", () => {
  const shared = [
    { code: "shared_topics", value: "consulting,strategy" },
    { code: "shared_industry", value: "Consulting" },
  ];
  const out = formatSuggestMenteesResponse({
    state: "resolved",
    mentor: { name: "Cole Reed" },
    suggestions: [
      {
        mentee: { name: "Isaiah Walsh", subtitle: null },
        confidence: 70,
        confidenceLabel: "Good",
        reasons: [...shared, { code: "graduation_gap_fit", value: 6 }],
      },
      {
        mentee: { name: "Talia Rogers", subtitle: null },
        confidence: 65,
        confidenceLabel: "Good",
        reasons: [...shared],
      },
    ],
  })!;
  assert.match(out, /\n- Matches on the shared signals above/);
});

test("thin-data caveat appears when every suggestion carries two or fewer signals", () => {
  const out = formatSuggestMentorsResponse({
    state: "resolved",
    mentee: { name: "Maya Bell" },
    suggestions: [
      {
        mentor: { name: "Matthew McKillop", subtitle: null },
        confidence: 46,
        confidenceLabel: "Moderate",
        reasons: [
          { code: "career_trajectory", value: "Law" },
          { code: "aspirational_skill", value: "leadership" },
        ],
      },
    ],
  })!;
  assert.match(out, /limited profile data/);
});

test("rich suggestions render no thin-data caveat", () => {
  const out = formatSuggestMentorsResponse(lawCohortMentors())!;
  assert.ok(!out.includes("limited profile data"));
});

test("school names render title-cased", () => {
  const out = formatSuggestMentorsResponse(lawCohortMentors())!;
  assert.match(out, /Villanova University/);
  assert.ok(!out.includes("villanova university"));
});

test("Best for is signal-driven and org-agnostic — works with no subtitle at all", () => {
  const out = formatSuggestMentorsResponse({
    state: "resolved",
    mentee: { name: "Jordan Diaz" },
    suggestions: [
      {
        mentor: { name: "Amara Okafor", subtitle: null },
        confidence: 74,
        confidenceLabel: "Good",
        reasons: [
          { code: "shared_industry", value: "Finance" },
          { code: "shared_topics", value: "investing,networking" },
          { code: "shared_school", value: "howard university" },
        ],
      },
      {
        mentor: { name: "Luis Romero", subtitle: null },
        confidence: 66,
        confidenceLabel: "Good",
        reasons: [
          { code: "past_employer_overlap", value: "Goldman Sachs" },
          { code: "shared_school", value: "howard university" },
        ],
      },
    ],
  })!;
  // Phrasing is composed from each person's own signal values, not org-specific copy.
  assert.match(out, /Best for: Finance industry insight and guidance on investing and networking/);
  assert.match(out, /Best for: an inside view of Goldman Sachs/);
});

/* ── Deep link back to the mentorship page ── */

test("suggestion list links to the mentorship page when an orgSlug is provided", () => {
  const mentors = formatSuggestMentorsResponse(lawCohortMentors(), { orgSlug: "villanova" })!;
  assert.match(mentors, /\[Open the mentorship page\]\(\/villanova\/mentorship\)/);

  const mentees = formatSuggestMenteesResponse(resolvedMentees(), { orgSlug: "villanova" })!;
  assert.match(mentees, /\[Open the mentorship page\]\(\/villanova\/mentorship\)/);
});

test("suggestion list omits the link when no orgSlug is provided", () => {
  const out = formatSuggestMentorsResponse(lawCohortMentors())!;
  assert.ok(!out.includes("Open the mentorship page"));
});

test("a malformed orgSlug never reaches the rendered link", () => {
  // A slug with path characters would otherwise break out of /<slug>/mentorship.
  const out = formatSuggestMentorsResponse(lawCohortMentors(), {
    orgSlug: "../../etc/passwd",
  })!;
  assert.ok(!out.includes("Open the mentorship page"));
  assert.ok(!out.includes("etc/passwd"));
});
