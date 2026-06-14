import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRarityStats,
  rankMenteesForMentor,
  rankMentorsForMentee,
  type MenteeInput,
  type MentorInput,
} from "../src/lib/mentorship/matching.ts";
import { extractMentorSignals } from "../src/lib/mentorship/matching-signals.ts";
import {
  buildSyntheticMenteeFromCriteria,
  buildSyntheticMentorFromCriteria,
  hasMentorshipCriteria,
} from "../src/lib/mentorship/criteria-input.ts";

test("criteria detection accepts topics, industries, role families, or goals", () => {
  assert.equal(hasMentorshipCriteria({}), false);
  assert.equal(hasMentorshipCriteria({ topics: ["marketing"] }), true);
  assert.equal(hasMentorshipCriteria({ industries: ["Law"] }), true);
  assert.equal(hasMentorshipCriteria({ roleFamilies: ["Legal"] }), true);
  assert.equal(hasMentorshipCriteria({ goals: "break into product" }), true);
});

test("synthetic mentee input is deterministic and maps criteria to scorer fields", () => {
  const first = buildSyntheticMenteeFromCriteria("org-1", {
    topics: [" marketing ", "Marketing", "growth"],
    industries: ["Consumer"],
    roleFamilies: ["Product"],
    goals: "learn acquisition",
  });
  const second = buildSyntheticMenteeFromCriteria("org-1", {
    topics: ["marketing", "growth"],
    industries: ["Consumer"],
    roleFamilies: ["Product"],
    goals: "learn acquisition",
  });

  assert.ok(first);
  assert.deepEqual(first, second);
  assert.match(first.input.userId, /^criteria-mentee-[a-f0-9]{8}$/);
  assert.equal(first.label, "marketing, growth, Consumer, Product");
  assert.deepEqual(first.input.focusAreas, ["marketing", "growth"]);
  assert.deepEqual(first.input.preferredIndustries, ["Consumer"]);
  assert.deepEqual(first.input.preferredRoleFamilies, ["Product"]);
  assert.equal(first.input.goals, "learn acquisition");
});

test("synthetic mentor input is deterministic and active for scorer reuse", () => {
  const entity = buildSyntheticMentorFromCriteria("org-1", {
    topics: ["law"],
    industries: ["Legal Services"],
    roleFamilies: ["Legal"],
  });

  assert.ok(entity);
  assert.match(entity.input.userId, /^criteria-mentor-[a-f0-9]{8}$/);
  assert.equal(entity.label, "law, Legal Services, Legal");
  assert.deepEqual(entity.input.topics, ["law"]);
  assert.deepEqual(entity.input.nativeIndustries, ["Legal Services"]);
  assert.deepEqual(entity.input.nativeRoleFamilies, ["Legal"]);
  assert.equal(entity.input.acceptingNew, true);
  assert.equal(entity.input.isActive, true);
});

test("synthetic mentee criteria can rank real mentors", () => {
  const synthetic = buildSyntheticMenteeFromCriteria("org-1", {
    topics: ["marketing"],
  });
  assert.ok(synthetic);

  const mentors: MentorInput[] = [
    {
      userId: "mentor-marketing",
      orgId: "org-1",
      topics: ["marketing"],
      nativeIndustries: [],
      nativeRoleFamilies: [],
      maxMentees: 3,
      currentMenteeCount: 0,
      acceptingNew: true,
      isActive: true,
    },
    {
      userId: "mentor-law",
      orgId: "org-1",
      topics: ["law"],
      nativeIndustries: [],
      nativeRoleFamilies: [],
      maxMentees: 3,
      currentMenteeCount: 0,
      acceptingNew: true,
      isActive: true,
    },
  ];

  const matches = rankMentorsForMentee(synthetic.input, mentors);
  assert.deepEqual(
    matches.map((match) => match.mentorUserId),
    ["mentor-marketing"]
  );
});

test("synthetic mentor criteria can rank real mentees", () => {
  const synthetic = buildSyntheticMentorFromCriteria("org-1", {
    industries: ["Law"],
  });
  assert.ok(synthetic);

  const mentees: MenteeInput[] = [
    {
      userId: "mentee-law",
      orgId: "org-1",
      preferredIndustries: ["Law"],
      focusAreas: [],
      preferredRoleFamilies: [],
    },
    {
      userId: "mentee-finance",
      orgId: "org-1",
      preferredIndustries: ["Finance"],
      focusAreas: [],
      preferredRoleFamilies: [],
    },
  ];

  const matches = rankMenteesForMentor(synthetic.input, mentees, {
    rarityStats: buildRarityStats([extractMentorSignals(synthetic.input)]),
  });
  assert.deepEqual(
    matches.map((match) => match.menteeUserId),
    ["mentee-law"]
  );
});
