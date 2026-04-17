import { describe, it } from "node:test";
import assert from "node:assert";

import {
  rankMentorsForMentee,
  type MenteeInput,
  type MentorInput,
} from "@/lib/mentorship/matching";

function mentor(overrides: Partial<MentorInput> & { userId: string }): MentorInput {
  return {
    orgId: "org-1",
    topics: [],
    industry: null,
    jobTitle: null,
    currentCompany: null,
    currentCity: null,
    graduationYear: null,
    maxMentees: 3,
    currentMenteeCount: 0,
    acceptingNew: true,
    isActive: true,
    ...overrides,
  };
}

const menteeBase: MenteeInput = {
  userId: "mentee-1",
  orgId: "org-1",
  focusAreas: ["finance", "recruiting"],
  preferredIndustries: ["Finance"],
  preferredRoleFamilies: ["Finance"],
  currentCity: "New York",
  graduationYear: 2025,
  currentCompany: null,
};

describe("rankMentorsForMentee", () => {
  it("excludes capacity-full mentor even with perfect topic match", () => {
    const mentors: MentorInput[] = [
      mentor({
        userId: "full-mentor",
        topics: ["finance", "recruiting"],
        industry: "Finance",
        jobTitle: "Investment Analyst",
        currentCompany: "Goldman Sachs",
        currentCity: "New York",
        graduationYear: 2018,
        maxMentees: 2,
        currentMenteeCount: 2, // at capacity
      }),
      mentor({
        userId: "weak-mentor",
        topics: ["finance"],
        graduationYear: 2018,
      }),
    ];
    const ranked = rankMentorsForMentee(menteeBase, mentors);
    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].mentorUserId, "weak-mentor");
  });

  it("excludes mentor with accepting_new=false", () => {
    const mentors: MentorInput[] = [
      mentor({
        userId: "paused-mentor",
        topics: ["finance"],
        acceptingNew: false,
      }),
      mentor({
        userId: "open-mentor",
        topics: ["finance"],
      }),
    ];
    const ranked = rankMentorsForMentee(menteeBase, mentors);
    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].mentorUserId, "open-mentor");
  });

  it("shared_topics outweighs shared_city when only one qualifies", () => {
    const topicMentor = mentor({
      userId: "topic",
      topics: ["finance", "recruiting"],
    });
    const cityMentor = mentor({
      userId: "city",
      topics: [],
      currentCity: "New York",
    });
    const ranked = rankMentorsForMentee(menteeBase, [topicMentor, cityMentor]);
    assert.strictEqual(ranked[0].mentorUserId, "topic");
    assert.ok(ranked[0].score > ranked[1].score);
  });

  it("graduation_gap_fit penalizes gap<3 or >15, max at 5-10", () => {
    const m5 = mentor({ userId: "gap-5", graduationYear: 2020 }); // gap 5
    const m2 = mentor({ userId: "gap-2", graduationYear: 2023 }); // gap 2
    const m20 = mentor({ userId: "gap-20", graduationYear: 2005 }); // gap 20
    // Add topic so all three pass (signals.length >= 1)
    const withTopic: MentorInput[] = [m5, m2, m20].map((m) => ({
      ...m,
      topics: ["finance"],
    }));
    const ranked = rankMentorsForMentee(menteeBase, withTopic);
    const byId = new Map(ranked.map((r) => [r.mentorUserId, r]));
    const s5 = byId.get("gap-5")!;
    const s2 = byId.get("gap-2")!;
    const s20 = byId.get("gap-20");
    assert.ok(s5.score > s2.score, "5yr gap should beat 2yr gap");
    if (s20) {
      assert.ok(s5.score > s20.score, "5yr gap should beat 20yr gap");
    }
    // gap-5 has graduation_gap_fit signal; gap-2 has reduced; gap-20 has none
    assert.ok(s5.signals.some((s) => s.code === "graduation_gap_fit"));
    if (s20) {
      assert.ok(!s20.signals.some((s) => s.code === "graduation_gap_fit"));
    }
  });

  it("rarity boost: uncommon industry outscores common industry at same overlap", () => {
    // Build pool where "Finance" is common (8 mentors) and "Aerospace" is rare (1)
    const mentee: MenteeInput = {
      ...menteeBase,
      preferredIndustries: ["Finance", "Aerospace"],
      preferredRoleFamilies: [],
      focusAreas: [],
    };
    const pool: MentorInput[] = [];
    for (let i = 0; i < 8; i++) {
      pool.push(mentor({ userId: `fin-${i}`, industry: "Finance" }));
    }
    pool.push(mentor({ userId: "aero-1", industry: "Aerospace" }));

    const ranked = rankMentorsForMentee(mentee, pool);
    const aero = ranked.find((r) => r.mentorUserId === "aero-1");
    const fin = ranked.find((r) => r.mentorUserId === "fin-0");
    assert.ok(aero, "aerospace mentor should be ranked");
    assert.ok(fin, "finance mentor should be ranked");
    assert.ok(
      aero!.score > fin!.score,
      `rare Aerospace (${aero!.score}) should outscore common Finance (${fin!.score})`
    );
  });

  it("tied-score stability: identical inputs give identical order across runs", () => {
    const mentors: MentorInput[] = [
      mentor({ userId: "bbb", topics: ["finance"] }),
      mentor({ userId: "aaa", topics: ["finance"] }),
      mentor({ userId: "ccc", topics: ["finance"] }),
    ];
    const r1 = rankMentorsForMentee(menteeBase, mentors).map((r) => r.mentorUserId);
    const r2 = rankMentorsForMentee(menteeBase, mentors).map((r) => r.mentorUserId);
    assert.deepStrictEqual(r1, r2);
    // With identical score, mentorUserId asc
    assert.deepStrictEqual(r1, ["aaa", "bbb", "ccc"]);
  });

  it("excludes mentors in excludeMentorUserIds option", () => {
    const mentors: MentorInput[] = [
      mentor({ userId: "existing-pair", topics: ["finance"] }),
      mentor({ userId: "fresh", topics: ["finance"] }),
    ];
    const ranked = rankMentorsForMentee(menteeBase, mentors, {
      excludeMentorUserIds: ["existing-pair"],
    });
    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].mentorUserId, "fresh");
  });

  it("drops mentors from other orgs (tenant isolation)", () => {
    const mentors: MentorInput[] = [
      mentor({ userId: "other-org", orgId: "org-2", topics: ["finance"] }),
      mentor({ userId: "same-org", topics: ["finance"] }),
    ];
    const ranked = rankMentorsForMentee(menteeBase, mentors);
    assert.strictEqual(ranked.length, 1);
    assert.strictEqual(ranked[0].mentorUserId, "same-org");
  });

  it("graduation_gap_fit zero when mentor graduated after mentee", () => {
    const youngerMentor = mentor({
      userId: "younger",
      graduationYear: 2028, // mentee grad 2025 -> gap = -3
      topics: ["finance"],
    });
    const olderMentor = mentor({
      userId: "older",
      graduationYear: 2020, // gap = +5
      topics: ["finance"],
    });
    const ranked = rankMentorsForMentee(menteeBase, [youngerMentor, olderMentor]);
    const younger = ranked.find((r) => r.mentorUserId === "younger");
    const older = ranked.find((r) => r.mentorUserId === "older");
    assert.ok(younger, "younger mentor still scored via topic");
    assert.ok(older, "older mentor scored");
    assert.ok(
      !younger!.signals.some((s) => s.code === "graduation_gap_fit"),
      "no gap bonus for mentor graduating after mentee"
    );
    assert.ok(older!.signals.some((s) => s.code === "graduation_gap_fit"));
    assert.ok(older!.score > younger!.score);
  });

  it("skips mentors with no qualifying signals", () => {
    const mentors: MentorInput[] = [
      mentor({ userId: "nothing" }), // no topics, no industry etc.
    ];
    const ranked = rankMentorsForMentee(menteeBase, mentors);
    assert.strictEqual(ranked.length, 0);
  });

  it("respects org-level weight overrides via orgSettings", () => {
    const mentors: MentorInput[] = [
      mentor({
        userId: "city-mentor",
        currentCity: "New York",
        topics: ["finance"],
      }),
    ];
    const defaultRanked = rankMentorsForMentee(menteeBase, mentors);
    const overrideRanked = rankMentorsForMentee(menteeBase, mentors, {
      orgSettings: { mentorship_weights: { shared_city: 100 } },
    });
    assert.ok(overrideRanked[0].score > defaultRanked[0].score);
  });
});
