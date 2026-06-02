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
    positionTitle: null,
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

  it("hard-filters by same_sport when mentee requires it", () => {
    const mentee: MenteeInput = {
      ...menteeBase,
      preferredSports: ["Basketball"],
      requiredMentorAttributes: ["same_sport"],
    };
    const ranked = rankMentorsForMentee(mentee, [
      mentor({
        userId: "basketball-mentor",
        nativeSports: ["Basketball"],
        topics: ["basketball", "leadership"],
      }),
      mentor({
        userId: "football-mentor",
        nativeSports: ["Football"],
        topics: ["football", "leadership"],
      }),
    ]);
    assert.deepStrictEqual(ranked.map((row) => row.mentorUserId), ["basketball-mentor"]);
    assert.ok(ranked[0].signals.some((signal) => signal.code === "shared_sport"));
  });

  it("scores shared_position from mentor position titles", () => {
    const mentee: MenteeInput = {
      ...menteeBase,
      preferredPositions: ["Quarterback"],
    };
    const ranked = rankMentorsForMentee(mentee, [
      mentor({
        userId: "qb-mentor",
        nativePositions: ["Quarterback"],
        positionTitle: "Quarterback Coach",
        topics: ["finance"],
      }),
      mentor({
        userId: "pitcher-mentor",
        nativePositions: ["Pitcher"],
        positionTitle: "Pitcher",
        topics: ["finance"],
      }),
    ]);
    assert.strictEqual(ranked[0].mentorUserId, "qb-mentor");
    assert.ok(ranked[0].signals.some((signal) => signal.code === "shared_position"));
    assert.ok(!ranked[1].signals.some((signal) => signal.code === "shared_position"));
  });

  it("hard-filters same_industry when mentee marks it required", () => {
    const mentee: MenteeInput = {
      ...menteeBase,
      preferredIndustries: ["Finance"],
      requiredMentorAttributes: ["same_industry"],
    };
    const ranked = rankMentorsForMentee(mentee, [
      mentor({
        userId: "finance-mentor",
        industry: "Finance",
        nativeIndustries: ["Finance"],
        topics: ["finance"],
      }),
      mentor({
        userId: "tech-mentor",
        industry: "Technology",
        nativeIndustries: ["Technology"],
        topics: ["finance"],
      }),
    ]);
    assert.deepStrictEqual(ranked.map((row) => row.mentorUserId), ["finance-mentor"]);
  });

  it("matches a native industry even when the overlap is not in slot 0", () => {
    const mentee: MenteeInput = {
      ...menteeBase,
      preferredIndustries: ["Technology"],
      requiredMentorAttributes: ["same_industry"],
    };
    const ranked = rankMentorsForMentee(mentee, [
      mentor({
        userId: "multi-industry",
        nativeIndustries: ["Finance", "Technology"],
        topics: ["finance"],
      }),
    ]);
    assert.strictEqual(ranked.length, 1);
    assert.ok(ranked[0].signals.some((signal) => signal.code === "shared_industry"));
  });

  it("matches a native role family even when the overlap is not in slot 0", () => {
    const mentee: MenteeInput = {
      ...menteeBase,
      preferredRoleFamilies: ["Engineering"],
      requiredMentorAttributes: ["same_role_family"],
    };
    const ranked = rankMentorsForMentee(mentee, [
      mentor({
        userId: "multi-role-family",
        nativeRoleFamilies: ["Finance", "Engineering"],
        topics: ["finance"],
      }),
    ]);
    assert.strictEqual(ranked.length, 1);
    assert.ok(ranked[0].signals.some((signal) => signal.code === "shared_role_family"));
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
      pool.push(mentor({ userId: `fin-${i}`, industry: "Finance", nativeIndustries: ["Finance"] }));
    }
    pool.push(mentor({ userId: "aero-1", industry: "Aerospace", nativeIndustries: ["Aerospace"] }));

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

  describe("athletic smoke scenarios", () => {
    it("Basketball + Point Guard mentee ranks athletic match above non-athletic match", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        preferredSports: ["Basketball"],
        preferredPositions: ["Point Guard"],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "athletic-match",
          topics: ["basketball", "leadership"],
          nativeSports: ["Basketball"],
          nativePositions: ["Point Guard"],
          positionTitle: "Point Guard Coach",
        }),
        mentor({
          userId: "non-athletic",
          topics: ["finance"],
          positionTitle: "Investment Analyst",
        }),
      ]);
      assert.strictEqual(ranked[0].mentorUserId, "athletic-match");
      assert.ok(ranked[0].signals.some((s) => s.code === "shared_sport"));
      assert.ok(ranked[0].signals.some((s) => s.code === "shared_position"));
    });

    it("same_sport required + football mentor is hard-filter-rejected for basketball mentee", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        preferredSports: ["Basketball"],
        requiredMentorAttributes: ["same_sport"],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "football-mentor",
          topics: ["football"],
          nativeSports: ["Football"],
          positionTitle: "Quarterback",
        }),
      ]);
      assert.strictEqual(ranked.length, 0);
    });

    it("generic job title 'Security Guard' does not match point-guard / shooting-guard positions", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        preferredPositions: ["Point Guard"],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "security-guard",
          topics: [],
          positionTitle: "Security Guard",
          jobTitle: "Security Guard",
        }),
      ]);
      assert.ok(
        !ranked.some((r) => r.signals.some((s) => s.code === "shared_position")),
        "Security Guard must not create a false athletic position match"
      );
    });

    it("generic title 'Center Director' does not match basketball 'center' position", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        preferredPositions: ["Center"],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "center-director",
          topics: [],
          positionTitle: "Center Director",
          jobTitle: "Center Director",
        }),
      ]);
      assert.ok(
        !ranked.some((r) => r.signals.some((s) => s.code === "shared_position")),
        "Center Director must not create a false athletic position match"
      );
    });

    it("generic non-athletic titles do not trigger sport signals", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        preferredSports: ["Basketball"],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "generic-1",
          topics: [],
          positionTitle: "Security Guard",
        }),
        mentor({
          userId: "generic-2",
          topics: [],
          positionTitle: "Center Director",
        }),
        mentor({
          userId: "generic-3",
          topics: [],
          positionTitle: "Managing Director",
        }),
      ]);
      assert.ok(
        !ranked.some((r) => r.signals.some((s) => s.code === "shared_sport")),
        "Generic titles must not trigger shared_sport"
      );
    });

    it("admin queue signals include shared_sport and shared_position for an athletic match", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        preferredSports: ["Basketball"],
        preferredPositions: ["Point Guard"],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "full-athletic",
          topics: ["basketball"],
          nativeSports: ["Basketball"],
          nativePositions: ["Point Guard"],
          positionTitle: "Point Guard",
        }),
      ]);
      const codes = ranked[0].signals.map((s) => s.code);
      assert.ok(codes.includes("shared_sport"));
      assert.ok(codes.includes("shared_position"));
    });
  });
});

describe("enriched-data signals", () => {
  describe("career_trajectory", () => {
    it("fires on a PAST role even when the current role does not match the aspiration", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: ["Technology"],
        preferredRoleFamilies: [],
      };
      // Current employer is Finance; only the mentor's PAST role at Google
      // covers the mentee's Technology aspiration.
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "ex-googler",
          currentCompany: "Goldman Sachs",
          workHistory: [
            { company: "Google", title: "Software Engineer" },
            { company: "Goldman Sachs", title: "Analyst" },
          ],
        }),
      ]);
      assert.strictEqual(ranked.length, 1);
      const codes = ranked[0].signals.map((s) => s.code);
      assert.ok(codes.includes("career_trajectory"), "past Technology role should fire career_trajectory");
      assert.ok(!codes.includes("shared_industry"), "current snapshot does not match Technology");
    });

    it("does not double-count when the current role already covers the aspiration", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: ["Technology"],
        preferredRoleFamilies: [],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "current-techie",
          nativeIndustries: ["Technology"],
          // Work history adds no NEW industry beyond the current Technology one.
          workHistory: [{ company: "Google", title: "Software Engineer" }],
        }),
      ]);
      assert.strictEqual(ranked.length, 1);
      const codes = ranked[0].signals.map((s) => s.code);
      assert.ok(codes.includes("shared_industry"));
      assert.ok(
        !codes.includes("career_trajectory"),
        "career_trajectory must subtract current-role hits to stay additive"
      );
    });

    it("coverage: covering more aspirations outscores covering fewer", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: ["Technology", "Healthcare"],
        preferredRoleFamilies: [],
      };
      const broad = mentor({
        userId: "broad",
        workHistory: [
          { company: "Google", title: "Engineer" }, // Technology
          { company: "Pfizer", title: "Analyst" }, // Healthcare
        ],
      });
      const narrow = mentor({
        userId: "narrow",
        workHistory: [{ company: "Google", title: "Engineer" }], // Technology only
      });
      const ranked = rankMentorsForMentee(mentee, [broad, narrow]);
      assert.strictEqual(ranked[0].mentorUserId, "broad");
      assert.ok(ranked[0].score > ranked[1].score);
    });
  });

  describe("shared_school", () => {
    it("matches same school at full weight", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: [],
        preferredRoleFamilies: [],
        educationHistory: [{ title: "Stanford University", field_of_study: "Economics" }],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "stanford-alum",
          educationHistory: [{ title: "Stanford University", field_of_study: "Computer Science" }],
        }),
      ]);
      const signal = ranked[0]?.signals.find((s) => s.code === "shared_school");
      assert.ok(signal, "shared_school should fire");
      assert.strictEqual(signal!.weight, 14);
    });

    it("falls back to field-of-study at half weight when schools differ", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: [],
        preferredRoleFamilies: [],
        educationHistory: [{ title: "Stanford University", field_of_study: "Computer Science" }],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "mit-alum",
          educationHistory: [{ title: "MIT", field_of_study: "Computer Science" }],
        }),
      ]);
      const signal = ranked[0]?.signals.find((s) => s.code === "shared_school");
      assert.ok(signal, "field-of-study overlap should fire shared_school");
      assert.strictEqual(signal!.weight, 7);
    });

    // Real data: education_history[].field_of_study is ~always null; the field
    // lives in the noisy `degree` line. The matcher must recover it from degree.
    it("recovers field of study from the degree line when field_of_study is null", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: [],
        preferredRoleFamilies: [],
        educationHistory: [
          { title: "Stockton University", field_of_study: null, degree: "Bachelor of Science - BS, Computer Science" },
        ],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "fdu-cs",
          educationHistory: [
            { title: "Fairleigh Dickinson University", field_of_study: null, degree: "BSI, Data Analysis, Minor in Computer Science" },
          ],
        }),
      ]);
      const signal = ranked[0]?.signals.find((s) => s.code === "shared_school");
      assert.ok(signal, "computer science recovered from both degree lines should match");
      assert.strictEqual(signal!.weight, 7);
    });

    // Real data: degree lines are polluted with clubs/sports/honor societies.
    // Keyword whitelist must NOT manufacture a field match from that noise.
    it("does not invent a field match from extracurricular noise in degree", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: [],
        preferredRoleFamilies: [],
        educationHistory: [
          { title: "Mt Lebanon Senior High School", field_of_study: null, degree: "All-Division Football (Team Captain), National Honor Society" },
        ],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "noisy-degree",
          educationHistory: [
            { title: "Cornwall Central High School", field_of_study: null, degree: "11 Varsity Letter Recipient in Baseball, Swimming, and Football, Special Olympics" },
          ],
        }),
      ]);
      assert.ok(
        !ranked.some((r) => r.signals.some((s) => s.code === "shared_school")),
        "no real academic field present — shared_school must not fire"
      );
    });

    // Real data: LinkedIn appends the sub-school ("University of Pennsylvania -
    // The Wharton School"); same-university alumni must still match.
    it("matches the same university across sub-school suffixes", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: [],
        preferredRoleFamilies: [],
        educationHistory: [{ title: "University of Pennsylvania", field_of_study: null }],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "wharton-alum",
          educationHistory: [
            { title: "University of Pennsylvania - The Wharton School", field_of_study: null },
          ],
        }),
      ]);
      const signal = ranked[0]?.signals.find((s) => s.code === "shared_school");
      assert.ok(signal, "Penn should match Penn-Wharton at the institution level");
      assert.strictEqual(signal!.weight, 14, "institution match is full weight, not the field fallback");
    });
  });

  describe("aspirational_skill", () => {
    it("matches mentor skills against mentee focus areas with overlap scaling", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: ["finance", "recruiting"],
        preferredIndustries: [],
        preferredRoleFamilies: [],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({ userId: "skilled", skills: ["Finance", "Recruiting"] }),
      ]);
      const signal = ranked[0]?.signals.find((s) => s.code === "aspirational_skill");
      assert.ok(signal, "aspirational_skill should fire");
      // 2 overlaps -> 0.6 + 0.2*2 = 1.0 -> weight 20
      assert.strictEqual(signal!.weight, 20);
    });
  });

  describe("past_employer_overlap", () => {
    it("fires on a shared past employer", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: [],
        preferredRoleFamilies: [],
        workHistory: [{ company: "Deloitte", title: "Analyst" }],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "ex-deloitte",
          currentCompany: "Google",
          workHistory: [{ company: "Deloitte", title: "Consultant" }],
        }),
      ]);
      const codes = ranked[0]?.signals.map((s) => s.code) ?? [];
      assert.ok(codes.includes("past_employer_overlap"));
    });

    it("does not double-count the shared CURRENT employer (shared_company owns it)", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        focusAreas: [],
        preferredIndustries: [],
        preferredRoleFamilies: [],
        currentCompany: "Goldman Sachs",
        workHistory: [{ company: "Goldman Sachs", title: "Analyst" }],
      };
      const ranked = rankMentorsForMentee(mentee, [
        mentor({
          userId: "gs-colleague",
          currentCompany: "Goldman Sachs",
          workHistory: [{ company: "Goldman Sachs", title: "Associate" }],
        }),
      ]);
      const codes = ranked[0]?.signals.map((s) => s.code) ?? [];
      assert.ok(codes.includes("shared_company"));
      assert.ok(
        !codes.includes("past_employer_overlap"),
        "the only shared employer is the current one — past_employer must not fire"
      );
    });
  });

  describe("backward compatibility", () => {
    it("none of the enriched signals fire when no enriched data is present", () => {
      const ranked = rankMentorsForMentee(menteeBase, [
        mentor({ userId: "legacy", topics: ["finance"] }),
      ]);
      const codes = ranked[0].signals.map((s) => s.code);
      for (const enriched of [
        "career_trajectory",
        "shared_school",
        "aspirational_skill",
        "past_employer_overlap",
      ]) {
        assert.ok(!codes.includes(enriched as never), `${enriched} must not fire without data`);
      }
    });

    it("tolerates dirty jsonb (null company / non-array) without throwing", () => {
      const mentee: MenteeInput = {
        ...menteeBase,
        preferredIndustries: ["Technology"],
        // @ts-expect-error — simulate a dirty row reaching the matcher
        workHistory: "not-an-array",
        educationHistory: [{ title: null, field_of_study: null }],
      };
      assert.doesNotThrow(() => {
        rankMentorsForMentee(mentee, [
          mentor({
            userId: "dirty",
            topics: ["finance"],
            // @ts-expect-error — simulate a dirty row reaching the matcher
            workHistory: [{ company: null, title: 42 }],
            // @ts-expect-error — simulate a dirty row reaching the matcher
            skills: [null, "Finance", 7],
          }),
        ]);
      });
    });
  });

  it("respects org-level weight override for a new signal", () => {
    const mentee: MenteeInput = {
      ...menteeBase,
      focusAreas: [],
      preferredIndustries: ["Technology"],
      preferredRoleFamilies: [],
    };
    const mentors: MentorInput[] = [
      mentor({
        userId: "ex-googler",
        currentCompany: "Goldman Sachs",
        workHistory: [{ company: "Google", title: "Software Engineer" }],
      }),
    ];
    const base = rankMentorsForMentee(mentee, mentors);
    const boosted = rankMentorsForMentee(mentee, mentors, {
      orgSettings: { mentorship_weights: { career_trajectory: 100 } },
    });
    assert.ok(boosted[0].score > base[0].score);
  });
});
