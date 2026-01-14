import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterAnnouncementsForUser } from "@/lib/announcements";
import type { Announcement } from "@/types/database";

function makeAnnouncement(
  id: string,
  audience: Announcement["audience"],
  audienceUserIds?: string[]
): Announcement {
  return {
    id,
    organization_id: "org-1",
    title: "Test",
    body: "Body",
    audience,
    audience_user_ids: audienceUserIds ?? null,
    is_pinned: false,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    created_by_user_id: "user-1",
    category: null,
  } as Announcement;
}

describe("filterAnnouncementsForUser — parent role", () => {
  const parentCtx = { role: "parent" as const, status: "active" as const, userId: "parent-user-1" };

  it("parent sees 'all' audience announcements", () => {
    const announcements = [makeAnnouncement("1", "all")];
    const result = filterAnnouncementsForUser(announcements, parentCtx);
    assert.equal(result.length, 1);
  });

  it("parent sees 'alumni' audience announcements", () => {
    const announcements = [makeAnnouncement("2", "alumni")];
    const result = filterAnnouncementsForUser(announcements, parentCtx);
    assert.equal(result.length, 1);
  });

  it("parent does NOT see 'members' audience announcements", () => {
    const announcements = [makeAnnouncement("3", "members")];
    const result = filterAnnouncementsForUser(announcements, parentCtx);
    assert.equal(result.length, 0);
  });

  it("parent does NOT see 'active_members' audience announcements", () => {
    const announcements = [makeAnnouncement("4", "active_members")];
    const result = filterAnnouncementsForUser(announcements, parentCtx);
    assert.equal(result.length, 0);
  });

  it("parent sees 'individuals' announcement if their userId is in the list", () => {
    const announcements = [makeAnnouncement("5", "individuals", ["parent-user-1", "other-user"])];
    const result = filterAnnouncementsForUser(announcements, parentCtx);
    assert.equal(result.length, 1);
  });

  it("parent does NOT see 'individuals' announcement if their userId is not in the list", () => {
    const announcements = [makeAnnouncement("6", "individuals", ["other-user"])];
    const result = filterAnnouncementsForUser(announcements, parentCtx);
    assert.equal(result.length, 0);
  });

  it("revoked parent sees no announcements", () => {
    const revokedCtx = { role: "parent" as const, status: "revoked" as const, userId: "parent-user-1" };
    const announcements = [
      makeAnnouncement("7", "all"),
      makeAnnouncement("8", "alumni"),
    ];
    const result = filterAnnouncementsForUser(announcements, revokedCtx);
    assert.equal(result.length, 0);
  });

  it("alumni still sees 'alumni' announcements (no regression)", () => {
    const alumniCtx = { role: "alumni" as const, status: "active" as const, userId: "alumni-1" };
    const announcements = [makeAnnouncement("9", "alumni")];
    const result = filterAnnouncementsForUser(announcements, alumniCtx);
    assert.equal(result.length, 1);
  });
});
