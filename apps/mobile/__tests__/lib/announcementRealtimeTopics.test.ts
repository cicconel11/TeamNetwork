import {
  announcementRolesChannelTopic,
  announcementsTableChannelTopic,
  unreadAnnouncementsChannelTopic,
} from "@/lib/announcementRealtimeTopics";

describe("announcementRealtimeTopics", () => {
  it("encodes org and instance so two instances never share the same topic", () => {
    const orgId = "b83d1993-cd06-4b40-97c4-81e7118e299a";
    const a = announcementsTableChannelTopic(orgId, "home");
    const b = announcementsTableChannelTopic(orgId, "list");
    expect(a).toBe(`announcements:${orgId}:home`);
    expect(b).toBe(`announcements:${orgId}:list`);
    expect(a).not.toBe(b);
  });

  it("includes user id in role subscription topic", () => {
    const orgId = "org-1";
    const userId = "user-2";
    expect(announcementRolesChannelTopic(orgId, userId, "x")).toBe(
      `announcement-roles:${orgId}:${userId}:x`
    );
  });

  it("unread topic is distinct from announcements table topic for same org and key", () => {
    const orgId = "org-1";
    const key = "tabs";
    expect(unreadAnnouncementsChannelTopic(orgId, key)).not.toBe(
      announcementsTableChannelTopic(orgId, key)
    );
  });
});
