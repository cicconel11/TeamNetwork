import test from "node:test";
import assert from "node:assert/strict";
import {
  getMentorshipSectionOrder,
  getMentorshipStatusTranslationKey,
  getVisibleMentorshipPairs,
  isUserInMentorshipPair,
} from "../src/lib/mentorship/presentation.ts";

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

test("getMentorshipStatusTranslationKey normalizes mentorship status labels", () => {
  assert.equal(getMentorshipStatusTranslationKey("active"), "statusActive");
  assert.equal(getMentorshipStatusTranslationKey("paused"), "statusPaused");
  assert.equal(
    getMentorshipStatusTranslationKey("completed"),
    "statusCompleted"
  );
  assert.equal(getMentorshipStatusTranslationKey("unexpected"), "statusActive");
});
