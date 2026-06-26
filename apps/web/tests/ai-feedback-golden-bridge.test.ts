// Proves the DISCOVERY plumbing for the AI-eval loop's highest-value source: a real thumbs-down
// ai_feedback row → a golden-row proposal a human can promote. Builds the candidate via the REAL
// buildFeedbackEvalCandidate (not a hand-rolled object) so the bridge is tested end-to-end.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildFeedbackEvalCandidate,
  type AiFeedbackEvalSourceRow,
} from "../src/lib/ai/feedback-evals";
import {
  feedbackCandidateToGoldenProposal,
  feedbackCandidatesToGoldenProposals,
} from "../src/lib/ai/feedback-golden-bridge";

function sourceRow(
  overrides: {
    prompt?: string | null;
    surface?: string | null;
    rating?: string;
    comment?: string | null;
  } = {}
): AiFeedbackEvalSourceRow {
  return {
    feedback: {
      id: "fb-1",
      rating: overrides.rating ?? "negative",
      comment: overrides.comment ?? "wrong place",
      created_at: "2026-06-24T00:00:00Z",
    },
    thread: { id: "th-1", org_id: "org-1", user_id: "u-1", surface: overrides.surface ?? "members" },
    userMessage: {
      id: "um-1",
      content: overrides.prompt === undefined ? "show me the roster" : overrides.prompt,
      intent: null,
      intent_type: null,
      context_surface: overrides.surface ?? "analytics",
      created_at: "2026-06-24T00:00:00Z",
    },
    assistantMessage: {
      id: "am-1",
      content: "...",
      tool_calls: null,
      created_at: "2026-06-24T00:00:00Z",
    },
    audit: {
      id: "au-1",
      intent: null,
      intent_type: null,
      context_surface: overrides.surface ?? "analytics",
      tool_calls: null,
      safety_verdict: "ok",
      rag_grounded: true,
      write_action_id: null,
      write_action_status: null,
    },
  };
}

describe("feedback → golden proposal bridge", () => {
  it("turns a real negative-feedback candidate into a routable proposal carrying current behavior", () => {
    const candidate = buildFeedbackEvalCandidate(sourceRow({ surface: "analytics" }));
    assert.ok(candidate, "expected a candidate from a negative-rated row");

    const proposal = feedbackCandidateToGoldenProposal(candidate);
    assert.ok(proposal, "expected a proposal");
    assert.equal(proposal.input, "show me the roster");
    assert.equal(proposal.surface, "analytics");
    // The bridge reports what the CURRENT router does — ground truth is set by a human, not here.
    assert.equal(proposal.current.intent, "members_query");
    assert.equal(proposal.current.effectiveSurface, "members");
    assert.equal(proposal.feedbackId, "fb-1");
    assert.equal(proposal.comment, "wrong place");
  });

  it("coerces an unknown surface to general rather than throwing", () => {
    const candidate = buildFeedbackEvalCandidate(sourceRow({ surface: "bogus-surface" }));
    assert.ok(candidate);
    const proposal = feedbackCandidateToGoldenProposal(candidate);
    assert.ok(proposal);
    assert.equal(proposal.surface, "general");
  });

  it("drops a candidate with no prompt (nothing to route)", () => {
    const candidate = buildFeedbackEvalCandidate(sourceRow({ prompt: "" }));
    // empty prompt still yields a candidate (marked incomplete) but no routable proposal
    assert.ok(candidate);
    assert.equal(feedbackCandidateToGoldenProposal(candidate), null);
  });

  it("batch helper filters nulls", () => {
    const candidates = [
      buildFeedbackEvalCandidate(sourceRow({ surface: "analytics" })),
      buildFeedbackEvalCandidate(sourceRow({ prompt: "" })),
    ].filter((c): c is NonNullable<typeof c> => c != null);
    const proposals = feedbackCandidatesToGoldenProposals(candidates);
    assert.equal(proposals.length, 1);
  });
});
