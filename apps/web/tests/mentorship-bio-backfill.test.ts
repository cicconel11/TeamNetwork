import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractBioCustomAttributes,
  loadMentorBioContext,
  shouldEnqueueMentorBioBackfill,
  shouldPersistGeneratedBio,
  type MentorBioBackfillCandidate,
} from "@/lib/mentorship/bio-backfill";
import { computeBioInputHash } from "@/lib/mentorship/bio-generator";
import type { CustomAttributeDef } from "@/lib/mentorship/matching-weights";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const defs: CustomAttributeDef[] = [
  {
    key: "sport",
    label: "Sport",
    type: "select",
    weight: 20,
  },
  {
    key: "interests",
    label: "Interests",
    type: "multiselect",
    weight: 15,
  },
  {
    key: "notes",
    label: "Notes",
    type: "text",
    weight: 0,
  },
];

function candidate(
  overrides: Partial<MentorBioBackfillCandidate> = {}
): MentorBioBackfillCandidate {
  return {
    mentorProfileId: "profile-1",
    organizationId: "org-1",
    userId: "user-1",
    bio: null,
    bioSource: null,
    bioGeneratedAt: null,
    bioInputHash: null,
    nextInputHash: "abcd1234",
    ...overrides,
  };
}

// ── loadMentorBioContext fake supabase ──────────────────────────────────────
//
// Two chain shapes terminate against this fake:
//   1. queryMaybeSingle: from(t).select().eq()...[.is()].maybeSingle()
//   2. resolveEnrichedProfiles: from(t).select().eq().is().in()
// We capture the table and whether an `is(deleted_at, null)` filter was applied,
// then resolve canned rows from the fixture.

interface Fixture {
  members?: Record<string, unknown> | null;
  alumniLive?: Record<string, unknown> | null; // returned when deleted_at filter applied
  alumniDeleted?: Record<string, unknown> | null; // returned when no deleted_at filter
  parents?: Record<string, unknown> | null;
  org?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  mentorProfile?: Record<string, unknown> | null;
}

function makeFakeSupabase(fixture: Fixture): SupabaseClient<Database> {
  function builder(table: string) {
    let isDeletedFiltered = false;

    const resolveSingle = (): { data: Record<string, unknown> | null } => {
      switch (table) {
        case "alumni":
          return {
            data: isDeletedFiltered
              ? fixture.alumniLive ?? null
              : fixture.alumniDeleted ?? fixture.alumniLive ?? null,
          };
        case "organizations":
          return { data: fixture.org ?? null };
        case "user_organization_roles":
          return { data: fixture.user ?? null };
        case "mentor_profiles":
          return { data: fixture.mentorProfile ?? null };
        default:
          return { data: null };
      }
    };

    const resolveList = (): { data: Record<string, unknown>[] | null } => {
      switch (table) {
        case "members":
          return { data: fixture.members ? [fixture.members] : [] };
        case "alumni":
          return { data: fixture.alumniLive ? [fixture.alumniLive] : [] };
        case "parents":
          return { data: fixture.parents ? [fixture.parents] : [] };
        default:
          return { data: [] };
      }
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => {
        isDeletedFiltered = true;
        return chain;
      },
      in: () => Promise.resolve(resolveList()),
      maybeSingle: () => Promise.resolve(resolveSingle()),
    };
    return chain;
  }

  return {
    from: (table: string) => builder(table),
  } as unknown as SupabaseClient<Database>;
}

const ORG = "org-1";
const USER = "user-1";

function baseFixture(over: Partial<Fixture> = {}): Fixture {
  return {
    org: { settings: {}, name: "TeamMeet U" },
    user: { user_id: USER, users: { name: "Jordan Smith" } },
    mentorProfile: {
      id: "profile-1",
      organization_id: ORG,
      user_id: USER,
      bio: null,
      bio_source: null,
      bio_generated_at: null,
      bio_input_hash: null,
      custom_attributes: null,
      expertise_areas: null,
      topics: null,
      sports: null,
      positions: null,
    },
    ...over,
  };
}

describe("extractBioCustomAttributes", () => {
  it("includes select and multiselect attributes but omits text attributes", () => {
    const result = extractBioCustomAttributes(defs, {
      sport: "lacrosse",
      interests: ["finance", "marketing"],
      notes: "captain",
    });

    assert.deepStrictEqual(result, {
      sport: "lacrosse",
      interests: "finance, marketing",
    });
  });

  it("returns null when no usable custom attributes exist", () => {
    const result = extractBioCustomAttributes(defs, {
      notes: "captain",
    });

    assert.equal(result, null);
  });
});

describe("loadMentorBioContext enrichment precedence", () => {
  it("prefers the member row company over a stale alumni row company", async () => {
    const supabase = makeFakeSupabase(
      baseFixture({
        members: {
          user_id: USER,
          current_company: "Member Co",
          industry: "Technology",
          job_title: null,
          position_title: null,
          graduation_year: 2019,
        },
        alumniLive: {
          // alumni text read returns headline/summary only; enrichment from members
          headline: "Stale headline",
          summary: "Stale summary",
        },
      })
    );

    const context = await loadMentorBioContext(supabase, ORG, USER);
    assert.ok(context);
    assert.equal(context.input.currentCompany, "Member Co");
    assert.equal(context.input.graduationYear, 2019);
  });

  it("excludes soft-deleted alumni from headline/summary", async () => {
    // alumniLive null => the deleted-filtered read finds nothing, even though a
    // deleted row exists. Enrichment falls to alumni list (also empty here).
    const supabase = makeFakeSupabase(
      baseFixture({
        members: null,
        alumniLive: null,
        alumniDeleted: { headline: "Deleted headline", summary: "Deleted summary" },
      })
    );

    const context = await loadMentorBioContext(supabase, ORG, USER);
    assert.ok(context);
    assert.equal(context.input.linkedinHeadline, null);
    assert.equal(context.input.linkedinSummary, null);
  });

  it("threads the mentor's chosen fields into the bio input", async () => {
    const supabase = makeFakeSupabase(
      baseFixture({
        members: {
          user_id: USER,
          current_company: "Stripe",
          industry: "Technology",
          graduation_year: 2018,
        },
        mentorProfile: {
          id: "profile-1",
          organization_id: ORG,
          user_id: USER,
          bio: null,
          bio_source: null,
          bio_generated_at: null,
          bio_input_hash: null,
          custom_attributes: null,
          expertise_areas: ["Distributed Systems"],
          topics: ["interview prep"],
          sports: ["Crew"],
          positions: ["Stroke"],
        },
      })
    );

    const context = await loadMentorBioContext(supabase, ORG, USER);
    assert.ok(context);
    assert.deepEqual(context.input.chosenTopics, ["interview prep"]);
    assert.deepEqual(context.input.chosenSports, ["Crew"]);
    assert.deepEqual(context.input.chosenPositions, ["Stroke"]);
    assert.deepEqual(context.input.chosenExpertiseAreas, ["Distributed Systems"]);
  });

  it("hash changes when chosen topics change but is idempotent for identical input", async () => {
    const withTopics = makeFakeSupabase(
      baseFixture({
        members: { user_id: USER, current_company: "Stripe", industry: "Technology" },
        mentorProfile: {
          id: "profile-1",
          organization_id: ORG,
          user_id: USER,
          bio: null,
          bio_source: null,
          bio_generated_at: null,
          bio_input_hash: null,
          custom_attributes: null,
          expertise_areas: null,
          topics: ["careers"],
          sports: null,
          positions: null,
        },
      })
    );
    const withMoreTopics = makeFakeSupabase(
      baseFixture({
        members: { user_id: USER, current_company: "Stripe", industry: "Technology" },
        mentorProfile: {
          id: "profile-1",
          organization_id: ORG,
          user_id: USER,
          bio: null,
          bio_source: null,
          bio_generated_at: null,
          bio_input_hash: null,
          custom_attributes: null,
          expertise_areas: null,
          topics: ["careers", "leadership"],
          sports: null,
          positions: null,
        },
      })
    );

    const a = await loadMentorBioContext(withTopics, ORG, USER);
    const b = await loadMentorBioContext(withMoreTopics, ORG, USER);
    assert.ok(a && b);
    assert.notEqual(a.nextInputHash, b.nextInputHash);

    // Idempotent: re-deriving the hash from the same input is stable.
    assert.equal(a.nextInputHash, computeBioInputHash(a.input));
    assert.equal(b.nextInputHash, computeBioInputHash(b.input));
  });
});

describe("shouldEnqueueMentorBioBackfill", () => {
  it("skips manual bios", () => {
    assert.equal(
      shouldEnqueueMentorBioBackfill(
        candidate({
          bio: "Written manually",
          bioSource: "manual",
        })
      ),
      false
    );
  });

  it("enqueues blank bios", () => {
    assert.equal(shouldEnqueueMentorBioBackfill(candidate({ bio: "" })), true);
  });

  it("enqueues ai bios with stale input hashes", () => {
    assert.equal(
      shouldEnqueueMentorBioBackfill(
        candidate({
          bio: "Current bio",
          bioSource: "ai_generated",
          bioGeneratedAt: "2026-10-19T20:00:00.000Z",
          bioInputHash: "oldhash",
          nextInputHash: "newhash",
        })
      ),
      true
    );
  });

  it("skips current ai bios when the hash matches and generation timestamp exists", () => {
    assert.equal(
      shouldEnqueueMentorBioBackfill(
        candidate({
          bio: "Current bio",
          bioSource: "ai_generated",
          bioGeneratedAt: "2026-10-19T20:00:00.000Z",
          bioInputHash: "samehash",
          nextInputHash: "samehash",
        })
      ),
      false
    );
  });
});

describe("shouldPersistGeneratedBio", () => {
  it("never persists over manual bios", () => {
    assert.equal(
      shouldPersistGeneratedBio(
        candidate({
          bio: "Manual bio",
          bioSource: "manual",
        })
      ),
      false
    );
  });

  it("persists eligible generated bios", () => {
    assert.equal(
      shouldPersistGeneratedBio(
        candidate({
          bio: "Old generated bio",
          bioSource: "ai_generated",
          bioInputHash: "oldhash",
          nextInputHash: "newhash",
        })
      ),
      true
    );
  });
});
