import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { suggestMenteesModule } from "@/lib/ai/tools/registry/suggest-mentees";
import { formatSuggestMenteesResponse } from "@/app/api/ai/[orgId]/chat/handler/formatters/reads";
import {
  buildRarityStats,
  rankMentorsForMentee,
  rankMenteesForMentor,
  type MenteeInput,
  type MentorInput,
} from "@/lib/mentorship/matching";
import { extractMentorSignals } from "@/lib/mentorship/matching-signals";

describe("suggest_mentees tool schema", () => {
  it("accepts either a person or criteria", () => {
    assert.equal(suggestMenteesModule.name, "suggest_mentees");
    assert.equal(suggestMenteesModule.argsSchema.safeParse({}).success, false);
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({ mentor_query: "Pat" }).success,
      true
    );
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({
        mentor_id: "00000000-0000-0000-0000-000000000000",
      }).success,
      true
    );
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({ topics: ["marketing"] }).success,
      true
    );
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({ industries: ["Law"] }).success,
      true
    );
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({ role_families: ["Legal"] }).success,
      true
    );
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({ goals: "learn fundraising" }).success,
      true
    );
    // limit is bounded
    assert.equal(
      suggestMenteesModule.argsSchema.safeParse({ mentor_query: "Pat", limit: 99 }).success,
      false
    );
  });

  it("strips unknown keys emitted by the model instead of erroring", () => {
    const parsed = suggestMenteesModule.argsSchema.safeParse({
      mentor_query: "Pat",
      // glm-5.2 sometimes emits stray keys; these must not fail the call.
      unexpected_extra_key: "ignored",
    });
    assert.equal(parsed.success, true);
    assert.ok(parsed.success);
    assert.equal(
      (parsed.data as Record<string, unknown>).unexpected_extra_key,
      undefined,
      "unknown key should be stripped, not retained"
    );
  });

  it("coerces single strings for topics/industries/role_families (glm tolerance)", () => {
    const parsed = suggestMenteesModule.argsSchema.parse({
      topics: "leadership",
      industries: "sports",
      role_families: "operations",
    });
    assert.deepEqual(parsed.topics, ["leadership"]);
    assert.deepEqual(parsed.industries, ["sports"]);
    assert.deepEqual(parsed.role_families, ["operations"]);
  });

  it("leaves criteria arrays unchanged", () => {
    const parsed = suggestMenteesModule.argsSchema.parse({
      topics: ["marketing", "fundraising"],
    });
    assert.deepEqual(parsed.topics, ["marketing", "fundraising"]);
  });
});

describe("formatSuggestMenteesResponse", () => {
  it("renders resolved mentee suggestions with reasons", () => {
    const out = formatSuggestMenteesResponse({
      state: "resolved",
      mentor: { name: "Alex Rivera" },
      suggestions: [
        {
          mentee: { user_id: "u1", name: "Jordan Lee", subtitle: null },
          score: 30,
          reasons: [{ code: "shared_industry", label: "Same industry", value: "Finance" }],
        },
      ],
    });
    assert.ok(out);
    assert.match(out!, /Top mentees for Alex Rivera/);
    assert.match(out!, /Jordan Lee/);
    assert.match(out!, /Same industry: Finance/);
  });

  it("handles the no-suggestions and unauthorized states", () => {
    assert.match(
      formatSuggestMenteesResponse({ state: "no_suggestions", mentor: { name: "Alex" } })!,
      /no students seeking mentorship/
    );
    assert.match(
      formatSuggestMenteesResponse({ state: "unauthorized" })!,
      /admins only/
    );
  });
});

/* ── U8: rarity symmetry between the two suggestion directions ─────────────── */

describe("rarity symmetry (U8)", () => {
  const org = "org-rarity";

  function mentorInput(overrides: Partial<MentorInput> & { userId: string }): MentorInput {
    return {
      orgId: org,
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

  const mentee: MenteeInput = {
    userId: "mentee-1",
    orgId: org,
    focusAreas: ["finance"],
    preferredIndustries: ["Finance"],
    preferredRoleFamilies: [],
    currentCity: null,
    graduationYear: 2025,
    currentCompany: null,
  };

  // Four mentors where only mentor-a knows "finance" → share 1/4 ≤ 0.25 earns
  // the 1.25× rarity boost. The population-of-one default clamps the multiplier
  // back to 1 (rarityMultiplier only ever boosts), losing that ~25%.
  const mentorA = mentorInput({
    userId: "mentor-a",
    topics: ["finance"],
    graduationYear: 2018,
  });
  const otherMentors = ["mentor-b", "mentor-c", "mentor-d"].map((userId) =>
    mentorInput({ userId, topics: ["marketing"], graduationYear: 2017 })
  );
  const allMentors = [mentorA, ...otherMentors];

  it("mentee-direction score equals the symmetric mentor-direction score when rarity is shared", () => {
    const population = buildRarityStats(allMentors.map(extractMentorSignals));

    const mentorDirection = rankMentorsForMentee(mentee, allMentors, {
      rarityStats: population,
    });
    const menteeDirection = rankMenteesForMentor(mentorA, [mentee], {
      rarityStats: population,
    });

    const aScore = mentorDirection.find((m) => m.mentorUserId === "mentor-a")?.score;
    assert.ok(aScore !== undefined);
    assert.strictEqual(menteeDirection.length, 1);
    assert.strictEqual(menteeDirection[0].score, aScore);
  });

  it("omitting rarityStats deflates the mentee direction (the bug U8 fixes)", () => {
    const population = buildRarityStats(allMentors.map(extractMentorSignals));
    const withPopulation = rankMenteesForMentor(mentorA, [mentee], {
      rarityStats: population,
    })[0].score;
    const withoutPopulation = rankMenteesForMentor(mentorA, [mentee], {})[0].score;
    assert.ok(
      withoutPopulation < withPopulation,
      `expected population-1 default (${withoutPopulation}) < full population (${withPopulation})`
    );
  });

  it("population of one is unchanged by passing explicit stats", () => {
    const single = buildRarityStats([mentorA].map(extractMentorSignals));
    const explicit = rankMenteesForMentor(mentorA, [mentee], { rarityStats: single });
    const defaulted = rankMenteesForMentor(mentorA, [mentee], {});
    assert.strictEqual(explicit[0].score, defaulted[0].score);
  });

  it("suggestMentees passes the full mentor population as rarity stats (source assert)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../src/lib/mentorship/ai-suggestions.ts", import.meta.url),
      "utf8"
    );
    assert.match(src, /rarityStats:\s*buildRarityStats\(mentorInputs\.map\(extractMentorSignals\)\)/);
  });
});
