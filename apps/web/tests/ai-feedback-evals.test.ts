import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFeedbackEvalCandidate,
  buildFeedbackEvalCandidates,
  extractToolNames,
  type AiFeedbackEvalSourceRow,
} from "../src/lib/ai/feedback-evals";

const baseRow: AiFeedbackEvalSourceRow = {
  feedback: {
    id: "feedback-1",
    rating: "negative",
    comment: "It opened the wrong place.",
    created_at: "2026-04-28T12:00:00Z",
  },
  thread: {
    id: "thread-1",
    org_id: "org-1",
    user_id: "user-1",
    surface: "general",
  },
  userMessage: {
    id: "message-user-1",
    content: "Where is the members page?",
    intent: "members_query",
    intent_type: "navigation",
    context_surface: "members",
    created_at: "2026-04-28T11:59:58Z",
  },
  assistantMessage: {
    id: "message-assistant-1",
    content: "Members: /acme/members",
    tool_calls: null,
    created_at: "2026-04-28T12:00:00Z",
  },
  audit: {
    id: "audit-1",
    intent: "members_query",
    intent_type: "navigation",
    context_surface: "members",
    tool_calls: [{ function: { name: "find_navigation_targets" } }],
    safety_verdict: "allow",
    rag_grounded: true,
    write_action_id: null,
    write_action_status: null,
  },
};

describe("extractToolNames", () => {
  it("extracts common tool-call shapes", () => {
    assert.deepEqual(
      extractToolNames([
        { function: { name: "list_members" } },
        { name: "get_org_stats" },
        { tool_name: "list_members" },
        { no_name: true },
      ]),
      ["list_members", "get_org_stats"],
    );
  });
});

describe("buildFeedbackEvalCandidate", () => {
  it("turns negative feedback into a reviewable eval candidate", () => {
    const candidate = buildFeedbackEvalCandidate(baseRow);

    assert.ok(candidate);
    assert.equal(candidate.prompt, "Where is the members page?");
    assert.equal(candidate.surface, "members");
    assert.equal(candidate.intentType, "navigation");
    assert.deepEqual(candidate.expected.toolCalls, ["find_navigation_targets"]);
    assert.equal(candidate.expected.answerShape, "tool_response");
    assert.equal(candidate.incomplete, false);
    assert.equal(candidate.feedback.comment, "It opened the wrong place.");
  });

  it("skips positive feedback by default", () => {
    const candidate = buildFeedbackEvalCandidate({
      ...baseRow,
      feedback: { ...baseRow.feedback, rating: "positive" },
    });

    assert.equal(candidate, null);
  });

  it("marks missing audit/tool metadata as incomplete but keeps the candidate", () => {
    const candidate = buildFeedbackEvalCandidate({
      ...baseRow,
      audit: null,
      assistantMessage: {
        ...baseRow.assistantMessage,
        tool_calls: null,
      },
    });

    assert.ok(candidate);
    assert.equal(candidate.incomplete, true);
    assert.equal(candidate.expected.answerShape, "unknown");
    assert.deepEqual(candidate.expected.toolCalls, []);
  });

  it("classifies write actions as pending-action eval candidates", () => {
    const candidate = buildFeedbackEvalCandidate({
      ...baseRow,
      userMessage: {
        ...baseRow.userMessage!,
        content: "Create an announcement about practice.",
        intent_type: "action_request",
      },
      audit: {
        ...baseRow.audit!,
        tool_calls: [{ name: "prepare_announcement" }],
        write_action_id: "action-1",
        write_action_status: "pending",
      },
    });

    assert.ok(candidate);
    assert.equal(candidate.expected.answerShape, "pending_action");
    assert.deepEqual(candidate.expected.toolCalls, ["prepare_announcement"]);
    assert.equal(candidate.expected.writeActionStatus, "pending");
  });
});

describe("buildFeedbackEvalCandidates", () => {
  it("filters null candidates from mixed feedback rows", () => {
    const candidates = buildFeedbackEvalCandidates([
      baseRow,
      { ...baseRow, feedback: { ...baseRow.feedback, id: "feedback-2", rating: "positive" } },
    ]);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].sourceIds.feedbackId, "feedback-1");
  });
});
