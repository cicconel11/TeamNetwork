// Golden-set scorer for the AI-eval loop.
//
// The source of truth for correct routing lives in
// .claude/loops/state/ai-eval-baseline.md; this file is the deterministic runner the
// `ai-eval-loop` skill and `ai-eval-judge` agent execute to compute passing/total against
// `resolveSurfaceRouting`. No live model — pure, exact, CI-cheap. House style mirrors
// tests/ai-fast-path-classifier.test.ts (node:test + assert/strict).
//
// Rows here must stay in sync with the golden-set table in the baseline markdown. When the
// loop promotes a new golden row, it adds it in BOTH places in the same PR.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveSurfaceRouting,
  type AiIntent,
} from "../src/lib/ai/intent-router";
import type { AiSurface } from "../src/lib/schemas/ai-assistant";

interface GoldenRow {
  input: string;
  surface: AiSurface;
  expectIntent: AiIntent;
  expectSurface: AiSurface;
  note: string;
}

// Seeded with two real, verified rows. Grow from confirmed `ai_feedback` misses + hard cases.
const GOLDEN: readonly GoldenRow[] = [
  {
    input: "show me the roster",
    surface: "analytics",
    expectIntent: "members_query",
    expectSurface: "members",
    note: "cross-surface pull → must reroute to members",
  },
  {
    input: "thanks!",
    surface: "general",
    expectIntent: "general_query",
    expectSurface: "general",
    note: "casual → no reroute, stays general",
  },
  {
    input: "show me everything",
    surface: "members",
    expectIntent: "general_query",
    expectSurface: "members",
    note: "no keyword match → must NOT guess a surface; stays put, low confidence",
  },
  {
    input: "",
    surface: "members",
    expectIntent: "general_query",
    expectSurface: "members",
    note: "empty input → stable defined result, no throw, no reroute",
  },
  {
    input: "members donations",
    surface: "general",
    expectIntent: "ambiguous_query",
    expectSurface: "general",
    note: "keyword collision (members + analytics tie) → ambiguous, documented tie-break",
  },
  {
    input: "who are our donors?",
    surface: "general",
    expectIntent: "analytics_query",
    expectSurface: "analytics",
    note: "'donor' keyword → reroute from general to analytics, high confidence",
  },
  {
    input: "upcoming games this week",
    surface: "general",
    expectIntent: "events_query",
    expectSurface: "events",
    note: "'games' keyword → reroute to events (not analytics, despite 'this week')",
  },
  {
    input: "create an event for friday",
    surface: "members",
    expectIntent: "events_query",
    expectSurface: "events",
    note: "action_request + events keyword → reroute from members to events",
  },
  {
    input: "mentor",
    surface: "analytics",
    expectIntent: "members_query",
    expectSurface: "members",
    note: "single bare members keyword → reroute from analytics, high confidence",
  },
  {
    input: "how do I message a mentor",
    surface: "general",
    expectIntent: "members_query",
    expectSurface: "members",
    note: "members keywords win → members surface (a 'how do I' phrasing must not override the surface signal)",
  },
  {
    input: "delete a member",
    surface: "general",
    expectIntent: "members_query",
    expectSurface: "members",
    note: "action_request + members keyword → reroute to members",
  },
  {
    input: "send an announcement",
    surface: "events",
    expectIntent: "general_query",
    expectSurface: "general",
    note: "general-content keyword ('announcement') beats the events surface → reroute to general",
  },
  {
    input: "mentor and mentee connections donation",
    surface: "general",
    expectIntent: "members_query",
    expectSurface: "members",
    note: "keyword-count dominance: 3 members keywords outrank 1 analytics → members, not ambiguous",
  },
  {
    input: "any new job postings?",
    surface: "members",
    expectIntent: "general_query",
    expectSurface: "general",
    note: "'job'/'postings' are general-content keywords → reroute from members to general",
  },
  {
    input: "good morning team",
    surface: "members",
    expectIntent: "general_query",
    expectSurface: "members",
    note: "casual variant (multi-word greeting) → casual, no reroute, stays put",
  },
  {
    input: "take me to the calendar",
    surface: "general",
    expectIntent: "events_query",
    expectSurface: "events",
    note: "navigation phrasing + events keyword → reroute to events",
  },
  {
    input: "donation trends by month",
    surface: "general",
    expectIntent: "analytics_query",
    expectSurface: "analytics",
    note: "reporting language ('trends by month') + analytics keyword → analytics, not navigation",
  },
  {
    input: "MEMBERS",
    surface: "general",
    expectIntent: "members_query",
    expectSurface: "members",
    note: "case-insensitive keyword match → uppercase still routes to members",
  },
  {
    input: "  roster  ",
    surface: "analytics",
    expectIntent: "members_query",
    expectSurface: "members",
    note: "whitespace-padded input is normalized → still reroutes to members",
  },
  {
    input: "donations and events",
    surface: "general",
    expectIntent: "ambiguous_query",
    expectSurface: "general",
    note: "analytics vs events tie (1 each) → ambiguous, stays on requested surface",
  },
];

describe("AI intent golden set", () => {
  for (const row of GOLDEN) {
    it(`routes "${row.input}" on [${row.surface}] → ${row.expectIntent}/${row.expectSurface} (${row.note})`, () => {
      const decision = resolveSurfaceRouting(row.input, row.surface);
      assert.equal(decision.intent, row.expectIntent);
      assert.equal(decision.effectiveSurface, row.expectSurface);
    });
  }
});
