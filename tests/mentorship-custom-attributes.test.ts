import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  scoreMentorForMentee,
  buildRarityStats,
  rankMentorsForMentee,
  type MenteeInput,
  type MentorInput,
} from "@/lib/mentorship/matching";
import {
  resolveMentorshipConfig,
  DEFAULT_MENTORSHIP_WEIGHTS,
  type CustomAttributeDef,
  type MentorshipWeights,
} from "@/lib/mentorship/matching-weights";
import {
  formatMatchExplanation,
  getMatchQualityTier,
} from "@/lib/mentorship/presentation";
import type {
  MenteeSignals,
  MentorSignals,
} from "@/lib/mentorship/matching-signals";

/* ------------------------------------------------------------------ */
/*  Fixture helpers                                                    */
/* ------------------------------------------------------------------ */

function makeMenteeSignals(
  overrides: Partial<MenteeSignals> = {}
): MenteeSignals {
  return {
    userId: "mentee-1",
    orgId: "org-1",
    focusAreas: [],
    preferredIndustries: [],
    preferredRoleFamilies: [],
    preferredSports: [],
    preferredPositions: [],
    requiredMentorAttributes: [],
    currentCity: null,
    currentCityNorm: null,
    graduationYear: null,
    currentCompany: null,
    currentCompanyNorm: null,
    customAttributes: {},
    ...overrides,
  };
}

function makeMentorSignals(
  overrides: Partial<MentorSignals> = {}
): MentorSignals {
  return {
    userId: "mentor-1",
    orgId: "org-1",
    topics: [],
    industries: [],
    roleFamilies: [],
    sports: [],
    positions: [],
    industry: null,
    roleFamily: null,
    currentCity: null,
    currentCityNorm: null,
    graduationYear: null,
    currentCompany: null,
    currentCompanyNorm: null,
    maxMentees: 3,
    currentMenteeCount: 0,
    acceptingNew: true,
    isActive: true,
    customAttributes: {},
    ...overrides,
  };
}

function makeMentorInput(
  overrides: Partial<MentorInput> & { userId: string }
): MentorInput {
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

const defaultWeights: MentorshipWeights = {
  ...DEFAULT_MENTORSHIP_WEIGHTS,
} as MentorshipWeights;

function weightsWithCustom(
  customEntries: Record<`custom:${string}`, number> = {}
): MentorshipWeights {
  return { ...defaultWeights, ...customEntries } as MentorshipWeights;
}

const sportDef: CustomAttributeDef = {
  key: "sport",
  label: "Sport",
  type: "select",
  options: [
    { label: "Lacrosse", value: "lacrosse" },
    { label: "Soccer", value: "soccer" },
    { label: "Tennis", value: "tennis" },
  ],
  weight: 10,
};

const interestsDef: CustomAttributeDef = {
  key: "interests",
  label: "Interests",
  type: "multiselect",
  options: [
    { label: "Finance", value: "finance" },
    { label: "Marketing", value: "marketing" },
    { label: "Engineering", value: "engineering" },
    { label: "Design", value: "design" },
  ],
  weight: 15,
};

const bioDef: CustomAttributeDef = {
  key: "bio",
  label: "Bio",
  type: "text",
  weight: 0,
};

/* ------------------------------------------------------------------ */
/*  resolveMentorshipConfig                                            */
/* ------------------------------------------------------------------ */

describe("resolveMentorshipConfig", () => {
  it("returns default weights and empty customAttributeDefs when orgSettings is null", () => {
    const config = resolveMentorshipConfig(null);
    assert.deepStrictEqual(
      config.weights.shared_topics,
      DEFAULT_MENTORSHIP_WEIGHTS.shared_topics
    );
    assert.deepStrictEqual(
      config.weights.shared_industry,
      DEFAULT_MENTORSHIP_WEIGHTS.shared_industry
    );
    assert.deepStrictEqual(config.customAttributeDefs, []);
  });

  it("returns default weights when orgSettings is undefined", () => {
    const config = resolveMentorshipConfig(undefined);
    assert.deepStrictEqual(config.customAttributeDefs, []);
  });

  it("returns default weights when orgSettings is a non-object", () => {
    const config = resolveMentorshipConfig("invalid");
    assert.deepStrictEqual(config.customAttributeDefs, []);
  });

  it("parses mentorship_custom_attribute_defs from org settings", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        {
          key: "sport",
          label: "Sport",
          type: "select",
          weight: 10,
          options: [
            { label: "Lacrosse", value: "lacrosse" },
            { label: "Soccer", value: "soccer" },
          ],
        },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 1);
    assert.strictEqual(config.customAttributeDefs[0].key, "sport");
    assert.strictEqual(config.customAttributeDefs[0].label, "Sport");
    assert.strictEqual(config.customAttributeDefs[0].type, "select");
    assert.strictEqual(config.customAttributeDefs[0].weight, 10);
    assert.strictEqual(config.customAttributeDefs[0].options?.length, 2);
  });

  it("sets custom attribute weight on the weights object as custom:<key>", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "sport", label: "Sport", type: "select", weight: 10 },
      ],
    });
    assert.strictEqual(config.weights["custom:sport"], 10);
  });

  it("rejects invalid key formats: starts with digit", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "123abc", label: "Bad Key", type: "select", weight: 10 },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 0);
  });

  it("rejects invalid key formats: uppercase letters", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "UPPER", label: "Bad Key", type: "select", weight: 10 },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 0);
  });

  it("rejects invalid key formats: keys with spaces", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "has space", label: "Bad Key", type: "select", weight: 10 },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 0);
  });

  it("accepts valid key formats: lowercase with underscores and digits", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "my_attr_2", label: "Good Key", type: "select", weight: 10 },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 1);
    assert.strictEqual(config.customAttributeDefs[0].key, "my_attr_2");
  });

  it("caps weights: negative weight defaults to 0", () => {
    const config = resolveMentorshipConfig({
      mentorship_weights: { shared_topics: -5 },
    });
    // Negative is out of 0-100 range, so it should NOT be applied
    assert.strictEqual(
      config.weights.shared_topics,
      DEFAULT_MENTORSHIP_WEIGHTS.shared_topics
    );
  });

  it("caps weights: weight above 100 is rejected", () => {
    const config = resolveMentorshipConfig({
      mentorship_weights: { shared_topics: 150 },
    });
    assert.strictEqual(
      config.weights.shared_topics,
      DEFAULT_MENTORSHIP_WEIGHTS.shared_topics
    );
  });

  it("merges valid built-in weight overrides", () => {
    const config = resolveMentorshipConfig({
      mentorship_weights: { shared_topics: 50, shared_city: 80 },
    });
    assert.strictEqual(config.weights.shared_topics, 50);
    assert.strictEqual(config.weights.shared_city, 80);
    // Unmodified keys remain default
    assert.strictEqual(
      config.weights.shared_industry,
      DEFAULT_MENTORSHIP_WEIGHTS.shared_industry
    );
  });

  it("merges custom weight overrides from mentorship_weights", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "sport", label: "Sport", type: "select", weight: 10 },
      ],
      mentorship_weights: { "custom:sport": 25 },
    });
    // The override (25) should take precedence over the def weight (10)
    assert.strictEqual(config.weights["custom:sport"], 25);
  });

  it("uses def weight when no custom weight override is provided", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "sport", label: "Sport", type: "select", weight: 10 },
      ],
      mentorship_weights: {},
    });
    assert.strictEqual(config.weights["custom:sport"], 10);
  });

  it("ignores malformed defs: missing key", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { label: "No Key", type: "select", weight: 5 },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 0);
  });

  it("ignores malformed defs: invalid type", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "bad", label: "Bad Type", type: "checkbox", weight: 5 },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 0);
  });

  it("ignores malformed defs: null entry in array", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        null,
        { key: "valid", label: "Valid", type: "select", weight: 5 },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 1);
    assert.strictEqual(config.customAttributeDefs[0].key, "valid");
  });

  it("ignores malformed defs: missing label", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "nolabel", type: "select", weight: 5 },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 0);
  });

  it("defaults weight to 0 when weight is not a number", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        { key: "noweight", label: "No Weight", type: "select", weight: "abc" },
      ],
    });
    assert.strictEqual(config.customAttributeDefs.length, 1);
    assert.strictEqual(config.customAttributeDefs[0].weight, 0);
  });

  it("filters invalid options from options array", () => {
    const config = resolveMentorshipConfig({
      mentorship_custom_attribute_defs: [
        {
          key: "opts",
          label: "Opts",
          type: "select",
          weight: 5,
          options: [
            { label: "Valid", value: "valid" },
            { label: 123, value: "bad_label" }, // invalid
            { label: "Missing Value" }, // missing value
            null, // null entry
          ],
        },
      ],
    });
    assert.strictEqual(config.customAttributeDefs[0].options?.length, 1);
    assert.strictEqual(config.customAttributeDefs[0].options?.[0].value, "valid");
  });
});

/* ------------------------------------------------------------------ */
/*  scoreMentorForMentee — custom attributes                           */
/* ------------------------------------------------------------------ */

describe("scoreMentorForMentee — custom attributes", () => {
  it("select type: exact match produces signal with custom:<key> code", () => {
    const mentee = makeMenteeSignals({
      customAttributes: { sport: ["lacrosse"] },
    });
    const mentor = makeMentorSignals({
      customAttributes: { sport: ["lacrosse"] },
    });
    const weights = weightsWithCustom({ "custom:sport": 10 });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      sportDef,
    ]);
    assert.ok(result, "should return a match");
    const sig = result.signals.find((s) => s.code === "custom:sport");
    assert.ok(sig, "should have custom:sport signal");
    assert.strictEqual(sig.weight, 10);
    assert.strictEqual(sig.value, "Sport:lacrosse");
  });

  it("select type: no match produces no signal", () => {
    const mentee = makeMenteeSignals({
      customAttributes: { sport: ["lacrosse"] },
    });
    const mentor = makeMentorSignals({
      customAttributes: { sport: ["soccer"] },
    });
    const weights = weightsWithCustom({ "custom:sport": 10 });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      sportDef,
    ]);
    // No signals at all → null
    assert.strictEqual(result, null);
  });

  it("multiselect type: set intersection with overlap scaling", () => {
    const mentee = makeMenteeSignals({
      customAttributes: { interests: ["finance", "marketing", "design"] },
    });
    const mentor = makeMentorSignals({
      customAttributes: { interests: ["finance", "marketing"] },
    });
    const weights = weightsWithCustom({ "custom:interests": 15 });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      interestsDef,
    ]);
    assert.ok(result, "should return a match");
    const sig = result.signals.find((s) => s.code === "custom:interests");
    assert.ok(sig, "should have custom:interests signal");
    // 2 overlap → overlapFactor=2, weight = round(15 * 1 * (0.6 + 0.2*2)) = round(15 * 1.0) = 15
    assert.strictEqual(sig.weight, 15);
    assert.ok(
      typeof sig.value === "string" && sig.value.includes("finance"),
      "value should contain matched items"
    );
  });

  it("multiselect type: no overlap produces no signal", () => {
    const mentee = makeMenteeSignals({
      customAttributes: { interests: ["finance"] },
    });
    const mentor = makeMentorSignals({
      customAttributes: { interests: ["design"] },
    });
    const weights = weightsWithCustom({ "custom:interests": 15 });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      interestsDef,
    ]);
    assert.strictEqual(result, null);
  });

  it("text type: not scored (display-only)", () => {
    const mentee = makeMenteeSignals({
      customAttributes: { bio: ["some bio text"] },
    });
    const mentor = makeMentorSignals({
      customAttributes: { bio: ["same bio text"] },
    });
    const weights = weightsWithCustom({ "custom:bio": 10 });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      bioDef,
    ]);
    // bio is text type → skipped, no other signals → null
    assert.strictEqual(result, null);
  });

  it("zero-weight custom attribute excluded from scoring", () => {
    const zeroWeightDef: CustomAttributeDef = {
      ...sportDef,
      weight: 0,
    };
    const mentee = makeMenteeSignals({
      customAttributes: { sport: ["lacrosse"] },
    });
    const mentor = makeMentorSignals({
      customAttributes: { sport: ["lacrosse"] },
    });
    const weights = weightsWithCustom({ "custom:sport": 0 });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      zeroWeightDef,
    ]);
    assert.strictEqual(result, null, "zero weight should produce no signal");
  });

  it("empty customAttributes on mentor produces no signals and no crash", () => {
    const mentee = makeMenteeSignals({
      customAttributes: { sport: ["lacrosse"] },
    });
    const mentor = makeMentorSignals({
      customAttributes: {},
    });
    const weights = weightsWithCustom({ "custom:sport": 10 });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      sportDef,
    ]);
    // No matching custom attributes, no built-in signals → null
    assert.strictEqual(result, null);
  });

  it("empty customAttributes on mentee produces no signals and no crash", () => {
    const mentee = makeMenteeSignals({
      customAttributes: {},
    });
    const mentor = makeMentorSignals({
      customAttributes: { sport: ["lacrosse"] },
    });
    const weights = weightsWithCustom({ "custom:sport": 10 });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      sportDef,
    ]);
    assert.strictEqual(result, null);
  });

  it("org with no custom attribute defs: algorithm unchanged (backward compat)", () => {
    const mentee = makeMenteeSignals({
      focusAreas: ["finance"],
    });
    const mentor = makeMentorSignals({
      topics: ["finance"],
    });

    const resultNoDefs = scoreMentorForMentee(
      mentee,
      mentor,
      defaultWeights,
      null,
      undefined
    );
    const resultEmptyDefs = scoreMentorForMentee(
      mentee,
      mentor,
      defaultWeights,
      null,
      []
    );

    assert.ok(resultNoDefs, "should match without custom defs");
    assert.ok(resultEmptyDefs, "should match with empty custom defs");
    assert.strictEqual(
      resultNoDefs.score,
      resultEmptyDefs.score,
      "scores should be identical"
    );
    assert.ok(
      resultNoDefs.signals.every((s) => !s.code.startsWith("custom:")),
      "no custom signals without defs"
    );
  });

  it("custom attributes combine with built-in signals additively", () => {
    const mentee = makeMenteeSignals({
      focusAreas: ["finance"],
      customAttributes: { sport: ["lacrosse"] },
    });
    const mentor = makeMentorSignals({
      topics: ["finance"],
      customAttributes: { sport: ["lacrosse"] },
    });
    const weights = weightsWithCustom({ "custom:sport": 10 });

    const resultWithCustom = scoreMentorForMentee(mentee, mentor, weights, null, [
      sportDef,
    ]);
    const resultWithoutCustom = scoreMentorForMentee(
      mentee,
      mentor,
      weights,
      null,
      undefined
    );

    assert.ok(resultWithCustom, "should match with custom");
    assert.ok(resultWithoutCustom, "should match without custom");
    assert.ok(
      resultWithCustom.score > resultWithoutCustom.score,
      "custom attribute should add to the score"
    );
    assert.ok(
      resultWithCustom.signals.some((s) => s.code === "shared_topics"),
      "built-in signal still present"
    );
    assert.ok(
      resultWithCustom.signals.some((s) => s.code === "custom:sport"),
      "custom signal present"
    );
  });

  it("multiple custom attribute defs scored independently", () => {
    const mentee = makeMenteeSignals({
      customAttributes: {
        sport: ["lacrosse"],
        interests: ["finance", "marketing"],
      },
    });
    const mentor = makeMentorSignals({
      customAttributes: {
        sport: ["lacrosse"],
        interests: ["finance"],
      },
    });
    const weights = weightsWithCustom({
      "custom:sport": 10,
      "custom:interests": 15,
    });

    const result = scoreMentorForMentee(mentee, mentor, weights, null, [
      sportDef,
      interestsDef,
    ]);
    assert.ok(result, "should match on both custom attributes");
    assert.ok(
      result.signals.some((s) => s.code === "custom:sport"),
      "sport signal"
    );
    assert.ok(
      result.signals.some((s) => s.code === "custom:interests"),
      "interests signal"
    );
  });
});

/* ------------------------------------------------------------------ */
/*  buildRarityStats — custom attributes                               */
/* ------------------------------------------------------------------ */

describe("buildRarityStats — custom attributes", () => {
  it("populates customAttributeCounts map correctly", () => {
    const mentors: MentorSignals[] = [
      makeMentorSignals({
        userId: "m1",
        customAttributes: { sport: ["lacrosse"], interests: ["finance"] },
      }),
      makeMentorSignals({
        userId: "m2",
        customAttributes: { sport: ["lacrosse"], interests: ["marketing"] },
      }),
      makeMentorSignals({
        userId: "m3",
        customAttributes: { sport: ["soccer"] },
      }),
    ];

    const rarity = buildRarityStats(mentors);

    assert.strictEqual(rarity.totalMentors, 3);

    const sportCounts = rarity.customAttributeCounts.get("sport");
    assert.ok(sportCounts, "should have sport counts");
    assert.strictEqual(sportCounts.get("lacrosse"), 2);
    assert.strictEqual(sportCounts.get("soccer"), 1);

    const interestCounts = rarity.customAttributeCounts.get("interests");
    assert.ok(interestCounts, "should have interests counts");
    assert.strictEqual(interestCounts.get("finance"), 1);
    assert.strictEqual(interestCounts.get("marketing"), 1);
  });

  it("empty custom attributes produce empty map (no crash)", () => {
    const mentors: MentorSignals[] = [
      makeMentorSignals({ userId: "m1", customAttributes: {} }),
      makeMentorSignals({ userId: "m2", customAttributes: {} }),
    ];

    const rarity = buildRarityStats(mentors);

    assert.strictEqual(rarity.customAttributeCounts.size, 0);
    assert.strictEqual(rarity.totalMentors, 2);
  });

  it("handles mentors with mixed custom attribute presence", () => {
    const mentors: MentorSignals[] = [
      makeMentorSignals({
        userId: "m1",
        customAttributes: { sport: ["lacrosse"] },
      }),
      makeMentorSignals({ userId: "m2", customAttributes: {} }),
    ];

    const rarity = buildRarityStats(mentors);

    const sportCounts = rarity.customAttributeCounts.get("sport");
    assert.ok(sportCounts, "sport key should exist");
    assert.strictEqual(sportCounts.get("lacrosse"), 1);
  });
});

/* ------------------------------------------------------------------ */
/*  formatMatchExplanation — custom attributes                         */
/* ------------------------------------------------------------------ */

describe("formatMatchExplanation", () => {
  it("custom attribute signal: single value", () => {
    const result = formatMatchExplanation({
      code: "custom:sport",
      value: "Sport:Lacrosse",
    });
    assert.strictEqual(result, "Shared sport: Lacrosse");
  });

  it("custom attribute with multiple values", () => {
    const result = formatMatchExplanation({
      code: "custom:interests",
      value: "Interests:Finance,Marketing",
    });
    assert.strictEqual(result, "Shared interests: Finance, Marketing");
  });

  it("custom attribute with no colon in value falls back", () => {
    const result = formatMatchExplanation({
      code: "custom:weird",
      value: "JustAValue",
    });
    assert.strictEqual(result, "Shared: JustAValue");
  });

  it("built-in shared_topics signal: single topic", () => {
    const result = formatMatchExplanation({
      code: "shared_topics",
      value: "finance",
    });
    assert.strictEqual(result, "Shared topic: finance");
  });

  it("built-in shared_topics signal: multiple topics", () => {
    const result = formatMatchExplanation({
      code: "shared_topics",
      value: "finance,marketing",
    });
    assert.strictEqual(result, "Shared topics: finance, marketing");
  });

  it("built-in shared_industry signal", () => {
    const result = formatMatchExplanation({
      code: "shared_industry",
      value: "Finance",
    });
    assert.strictEqual(result, "Same industry: Finance");
  });

  it("built-in graduation_gap_fit signal", () => {
    const result = formatMatchExplanation({
      code: "graduation_gap_fit",
      value: 5,
    });
    assert.strictEqual(result, "5 years ahead in career");
  });

  it("built-in shared_city signal", () => {
    const result = formatMatchExplanation({
      code: "shared_city",
      value: "New York",
    });
    assert.strictEqual(result, "Same city: New York");
  });

  it("built-in shared_company signal", () => {
    const result = formatMatchExplanation({
      code: "shared_company",
      value: "Google",
    });
    assert.strictEqual(result, "Same company: Google");
  });

  it("built-in shared_role_family signal", () => {
    const result = formatMatchExplanation({
      code: "shared_role_family",
      value: "Engineering",
    });
    assert.strictEqual(result, "Same career path: Engineering");
  });

  it("unknown code falls back to title-cased label", () => {
    const result = formatMatchExplanation({
      code: "some_unknown_signal",
      value: "whatever",
    });
    assert.strictEqual(result, "Some Unknown Signal");
  });
});

/* ------------------------------------------------------------------ */
/*  getMatchQualityTier                                                */
/* ------------------------------------------------------------------ */

describe("getMatchQualityTier", () => {
  it("75%+ returns 'strong'", () => {
    assert.strictEqual(getMatchQualityTier(75, 100), "strong");
    assert.strictEqual(getMatchQualityTier(80, 100), "strong");
    assert.strictEqual(getMatchQualityTier(100, 100), "strong");
  });

  it("50-74% returns 'good'", () => {
    assert.strictEqual(getMatchQualityTier(50, 100), "good");
    assert.strictEqual(getMatchQualityTier(60, 100), "good");
    assert.strictEqual(getMatchQualityTier(74, 100), "good");
  });

  it("25-49% returns 'possible'", () => {
    assert.strictEqual(getMatchQualityTier(25, 100), "possible");
    assert.strictEqual(getMatchQualityTier(30, 100), "possible");
    assert.strictEqual(getMatchQualityTier(49, 100), "possible");
  });

  it("below 25% returns null", () => {
    assert.strictEqual(getMatchQualityTier(24, 100), null);
    assert.strictEqual(getMatchQualityTier(10, 100), null);
    assert.strictEqual(getMatchQualityTier(0, 100), null);
  });

  it("theoreticalMax <= 0 returns null", () => {
    assert.strictEqual(getMatchQualityTier(50, 0), null);
    assert.strictEqual(getMatchQualityTier(50, -1), null);
  });

  it("exact boundary at 75% returns 'strong'", () => {
    assert.strictEqual(getMatchQualityTier(75, 100), "strong");
  });

  it("just below 75% returns 'good'", () => {
    assert.strictEqual(getMatchQualityTier(74.9, 100), "good");
  });

  it("exact boundary at 50% returns 'good'", () => {
    assert.strictEqual(getMatchQualityTier(50, 100), "good");
  });

  it("exact boundary at 25% returns 'possible'", () => {
    assert.strictEqual(getMatchQualityTier(25, 100), "possible");
  });
});

/* ------------------------------------------------------------------ */
/*  rankMentorsForMentee — custom attributes integration               */
/* ------------------------------------------------------------------ */

describe("rankMentorsForMentee — custom attributes", () => {
  const menteeBase: MenteeInput = {
    userId: "mentee-1",
    orgId: "org-1",
    focusAreas: ["finance"],
    preferredIndustries: [],
    preferredRoleFamilies: [],
    currentCity: null,
    graduationYear: null,
    currentCompany: null,
    customAttributes: { sport: "lacrosse" },
  };

  it("custom attributes affect ranking order", () => {
    const mentors: MentorInput[] = [
      makeMentorInput({
        userId: "mentor-no-custom",
        topics: ["finance"],
      }),
      makeMentorInput({
        userId: "mentor-with-custom",
        topics: ["finance"],
        customAttributes: { sport: "lacrosse" },
      }),
    ];

    const orgSettings = {
      mentorship_custom_attribute_defs: [
        {
          key: "sport",
          label: "Sport",
          type: "select",
          weight: 10,
          options: [{ label: "Lacrosse", value: "lacrosse" }],
        },
      ],
    };

    const ranked = rankMentorsForMentee(menteeBase, mentors, { orgSettings });

    assert.strictEqual(ranked.length, 2);
    assert.strictEqual(
      ranked[0].mentorUserId,
      "mentor-with-custom",
      "mentor with matching custom attribute should rank first"
    );
    assert.ok(
      ranked[0].score > ranked[1].score,
      "custom attribute should boost score"
    );
  });

  it("backward compat: no custom defs produces same behavior as before", () => {
    const mentors: MentorInput[] = [
      makeMentorInput({ userId: "mentor-a", topics: ["finance"] }),
      makeMentorInput({ userId: "mentor-b", topics: ["finance"] }),
    ];

    const menteeNoCustAttr: MenteeInput = {
      ...menteeBase,
      customAttributes: null,
    };

    const withoutSettings = rankMentorsForMentee(
      menteeNoCustAttr,
      mentors,
      {}
    );
    const withEmptySettings = rankMentorsForMentee(
      menteeNoCustAttr,
      mentors,
      { orgSettings: {} }
    );

    assert.strictEqual(withoutSettings.length, withEmptySettings.length);
    for (let i = 0; i < withoutSettings.length; i++) {
      assert.strictEqual(
        withoutSettings[i].mentorUserId,
        withEmptySettings[i].mentorUserId
      );
      assert.strictEqual(
        withoutSettings[i].score,
        withEmptySettings[i].score
      );
    }
  });

  it("custom multiselect attributes affect ranking via orgSettings", () => {
    const menteeMulti: MenteeInput = {
      ...menteeBase,
      customAttributes: {
        interests: ["finance", "marketing"],
      },
    };

    const mentors: MentorInput[] = [
      makeMentorInput({
        userId: "mentor-overlap-2",
        topics: ["finance"],
        customAttributes: { interests: ["finance", "marketing"] },
      }),
      makeMentorInput({
        userId: "mentor-overlap-1",
        topics: ["finance"],
        customAttributes: { interests: ["finance"] },
      }),
      makeMentorInput({
        userId: "mentor-overlap-0",
        topics: ["finance"],
        customAttributes: { interests: ["design"] },
      }),
    ];

    const orgSettings = {
      mentorship_custom_attribute_defs: [
        {
          key: "interests",
          label: "Interests",
          type: "multiselect",
          weight: 15,
          options: [
            { label: "Finance", value: "finance" },
            { label: "Marketing", value: "marketing" },
            { label: "Design", value: "design" },
          ],
        },
      ],
    };

    const ranked = rankMentorsForMentee(menteeMulti, mentors, { orgSettings });

    assert.strictEqual(ranked[0].mentorUserId, "mentor-overlap-2");
    assert.ok(
      ranked[0].score > ranked[1].score,
      "more overlap should produce higher score"
    );
    // mentor-overlap-0 has no custom signal (no intersection) but still has topic match
    const noOverlap = ranked.find(
      (r) => r.mentorUserId === "mentor-overlap-0"
    );
    assert.ok(noOverlap, "mentor with no custom overlap still ranked via topics");
    assert.ok(
      !noOverlap.signals.some((s) => s.code === "custom:interests"),
      "no custom:interests signal for non-overlapping mentor"
    );
  });
});
