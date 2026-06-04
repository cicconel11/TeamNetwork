import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeterministicWhy,
  canLogMentorshipActivity,
  formatMatchExplanation,
  formatMentorshipReasonLabel,
  getMentorshipSectionOrder,
  getMentorshipStatusTranslationKey,
  getVisibleMentorshipPairs,
  isUserInMentorshipPair,
} from "../src/lib/mentorship/presentation.ts";
import { MENTORSHIP_REASON_ORDER } from "../src/lib/mentorship/matching-weights.ts";

test("getMentorshipSectionOrder shows pairs first only for non-admins with pairs", () => {
  assert.equal(
    getMentorshipSectionOrder({ hasPairs: true, isAdmin: false }),
    "pairs-first"
  );
  assert.equal(
    getMentorshipSectionOrder({ hasPairs: true, isAdmin: true }),
    "directory-first"
  );
  assert.equal(
    getMentorshipSectionOrder({ hasPairs: false, isAdmin: false }),
    "directory-first"
  );
});

test("getVisibleMentorshipPairs preserves new server pairs while hiding locally deleted ones", () => {
  const pairs = [
    { id: "pair-1", mentor_user_id: "mentor-1", mentee_user_id: "mentee-1" },
    { id: "pair-2", mentor_user_id: "mentor-2", mentee_user_id: "mentee-2" },
  ];

  assert.deepEqual(getVisibleMentorshipPairs([], []), []);
  assert.deepEqual(getVisibleMentorshipPairs(pairs, []), pairs);
  assert.deepEqual(getVisibleMentorshipPairs(pairs, ["pair-1"]), [pairs[1]]);
});

test("isUserInMentorshipPair highlights both mentor and mentee identities", () => {
  const pair = {
    id: "pair-1",
    mentor_user_id: "mentor-1",
    mentee_user_id: "mentee-1",
  };

  assert.equal(isUserInMentorshipPair(pair, "mentor-1"), true);
  assert.equal(isUserInMentorshipPair(pair, "mentee-1"), true);
  assert.equal(isUserInMentorshipPair(pair, "someone-else"), false);
  assert.equal(isUserInMentorshipPair(pair), false);
});

test("canLogMentorshipActivity matches mentorship log RLS roles", () => {
  assert.equal(
    canLogMentorshipActivity({ role: "admin", status: "active" }),
    true
  );
  assert.equal(
    canLogMentorshipActivity({ role: "active_member", status: "active" }),
    true
  );
  assert.equal(
    canLogMentorshipActivity({ role: "alumni", status: "active" }),
    false
  );
  assert.equal(
    canLogMentorshipActivity({ role: "parent", status: "active" }),
    false
  );
  assert.equal(
    canLogMentorshipActivity({ role: "active_member", status: "revoked" }),
    false
  );
});

test("getMentorshipStatusTranslationKey normalizes mentorship status labels", () => {
  assert.equal(getMentorshipStatusTranslationKey("active"), "statusActive");
  assert.equal(getMentorshipStatusTranslationKey("paused"), "statusPaused");
  assert.equal(
    getMentorshipStatusTranslationKey("completed"),
    "statusCompleted"
  );
  assert.equal(getMentorshipStatusTranslationKey("unexpected"), "statusActive");
});

test("every built-in reason code has a non-humanized label", () => {
  // A label is "humanized" (the fallback) when it is exactly the code with
  // underscores replaced and words title-cased. Every curated code must beat that.
  for (const code of MENTORSHIP_REASON_ORDER) {
    const humanized = code
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const label = formatMentorshipReasonLabel(code);
    assert.notEqual(label, humanized, `${code} should have a curated label`);
  }
});

test("enriched signals produce value-aware explanations", () => {
  assert.equal(
    formatMatchExplanation({ code: "career_trajectory", value: "Finance,Consulting" }),
    "Has worked in Finance, Consulting"
  );
  assert.equal(
    formatMatchExplanation({ code: "shared_school", value: "Cornell" }),
    "Same school: Cornell"
  );
  assert.equal(
    formatMatchExplanation({ code: "aspirational_skill", value: "Product Strategy" }),
    "Has skills you want to build: Product Strategy"
  );
  assert.equal(
    formatMatchExplanation({ code: "past_employer_overlap", value: "McKinsey" }),
    "Both worked at McKinsey"
  );
  assert.equal(
    formatMatchExplanation({ code: "fallback_general", value: "limited mentee data" }),
    "Suggested while we learn more about this student"
  );
});

test("buildDeterministicWhy orders by reason priority and joins top reasons", () => {
  assert.equal(buildDeterministicWhy([]), "");
  assert.equal(
    buildDeterministicWhy([{ code: "shared_school", value: "Cornell" }]),
    "Same school: Cornell."
  );
  // career_trajectory outranks graduation_gap_fit and shared_city in the order.
  const why = buildDeterministicWhy([
    { code: "shared_city", value: "NYC" },
    { code: "career_trajectory", value: "Finance" },
    { code: "graduation_gap_fit", value: 6 },
  ]);
  assert.equal(
    why,
    "Has worked in Finance, 6 years ahead in career, and Same city: NYC."
  );
});
