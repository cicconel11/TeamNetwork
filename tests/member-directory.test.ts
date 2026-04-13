import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMemberDirectoryEntries } from "@/lib/members/directory";

describe("buildMemberDirectoryEntries", () => {
  it("adds parent fallback cards when a parent has no members row", () => {
    const entries = buildMemberDirectoryEntries({
      orgSlug: "test-org",
      linkedMembers: [],
      manualMembers: [],
      parentProfiles: [{
        id: "parent-1",
        first_name: "Louis",
        last_name: "Ciccone",
        email: "cicconel@myteamnetwork.com",
        photo_url: null,
        linkedin_url: null,
        relationship: "father",
        student_name: "Chris",
        user_id: "user-1",
      }],
      adminUserIds: new Set<string>(),
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.profileHref, "/test-org/parents/parent-1");
    assert.equal(entries[0]?.isParent, true);
    assert.equal(entries[0]?.role, "Parent of Chris");
  });

  it("does not duplicate a parent when a members row already exists for the same user", () => {
    const entries = buildMemberDirectoryEntries({
      orgSlug: "test-org",
      linkedMembers: [{
        id: "member-1",
        first_name: "Louis",
        last_name: "Ciccone",
        email: "cicconel@myteamnetwork.com",
        photo_url: null,
        role: "Captain",
        status: "active",
        graduation_year: null,
        linkedin_url: null,
        user_id: "user-1",
      }],
      manualMembers: [],
      parentProfiles: [{
        id: "parent-1",
        first_name: "Louis",
        last_name: "Ciccone",
        email: "cicconel@myteamnetwork.com",
        photo_url: null,
        linkedin_url: null,
        relationship: "father",
        student_name: "Chris",
        user_id: "user-1",
      }],
      adminUserIds: new Set<string>(),
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.profileHref, "/test-org/members/member-1");
    assert.equal(entries[0]?.isParent, false);
  });

  it("preserves active member and manual member cards", () => {
    const entries = buildMemberDirectoryEntries({
      orgSlug: "test-org",
      linkedMembers: [{
        id: "member-1",
        first_name: "Alex",
        last_name: "Zimmer",
        email: "alex@example.com",
        photo_url: null,
        role: "Goalkeeper",
        status: "active",
        graduation_year: 2027,
        linkedin_url: null,
        user_id: "user-1",
      }],
      manualMembers: [{
        id: "member-2",
        first_name: "Jamie",
        last_name: "Young",
        email: "jamie@example.com",
        photo_url: null,
        role: "Coach",
        status: "active",
        graduation_year: null,
        linkedin_url: null,
        user_id: null,
      }],
      parentProfiles: [],
      adminUserIds: new Set(["user-1"]),
    });

    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.last_name, "Young");
    assert.equal(entries[1]?.isAdmin, true);
    assert.equal(entries[1]?.profileHref, "/test-org/members/member-1");
  });
});
