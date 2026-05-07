import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickCurrentOrgProfile } from "@/lib/auth/current-org-profile";

const baseProfile = {
  id: "profile-1",
  first_name: "Louis",
  last_name: "Ciccone",
  photo_url: "https://example.com/avatar.jpg",
};

describe("pickCurrentOrgProfile", () => {
  it("prefers the members profile for active members", () => {
    const profile = pickCurrentOrgProfile({
      orgSlug: "test-org",
      role: "active_member",
      memberProfile: { ...baseProfile, id: "member-1" },
      parentProfile: { ...baseProfile, id: "parent-1" },
    });

    assert.equal(profile?.href, "/test-org/members/member-1");
    assert.equal(profile?.source, "members");
  });

  it("prefers the parent profile for parent users", () => {
    const profile = pickCurrentOrgProfile({
      orgSlug: "test-org",
      role: "parent",
      memberProfile: { ...baseProfile, id: "member-1" },
      parentProfile: { ...baseProfile, id: "parent-1" },
    });

    assert.deepEqual(profile, {
      href: "/test-org/parents/parent-1",
      name: "Louis Ciccone",
      avatarUrl: "https://example.com/avatar.jpg",
      source: "parents",
    });
  });

  it("prefers the alumni profile for alumni users", () => {
    const profile = pickCurrentOrgProfile({
      orgSlug: "test-org",
      role: "alumni",
      alumniProfile: { ...baseProfile, id: "alumni-1" },
      parentProfile: { ...baseProfile, id: "parent-1" },
    });

    assert.equal(profile?.href, "/test-org/alumni/alumni-1");
    assert.equal(profile?.source, "alumni");
  });

  it("falls back to any available profile when the preferred table is missing", () => {
    const profile = pickCurrentOrgProfile({
      orgSlug: "test-org",
      role: "parent",
      memberProfile: { ...baseProfile, id: "member-1" },
    });

    assert.equal(profile?.href, "/test-org/members/member-1");
    assert.equal(profile?.source, "members");
  });

  it("returns null when no profile exists", () => {
    const profile = pickCurrentOrgProfile({
      orgSlug: "test-org",
      role: "active_member",
    });

    assert.equal(profile, null);
  });
});
