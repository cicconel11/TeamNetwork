import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractBioCustomAttributes,
  shouldEnqueueMentorBioBackfill,
  shouldPersistGeneratedBio,
  type MentorBioBackfillCandidate,
} from "@/lib/mentorship/bio-backfill";
import type { CustomAttributeDef } from "@/lib/mentorship/matching-weights";

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
