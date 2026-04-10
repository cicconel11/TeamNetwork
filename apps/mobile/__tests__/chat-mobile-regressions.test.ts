import fs from "node:fs";
import path from "node:path";
import {
  buildChatGroupMemberInsertPayload,
  buildChatGroupMemberReactivationPayload,
  buildMobileDiscussionThreadRoute,
  buildMobileNewDiscussionThreadRoute,
  canAccessMobileChatGroup,
  canManageMobileChatMembers,
  MOBILE_CHAT_MEMBER_DIRECTORY_ROLES,
  MOBILE_DISCUSSION_THREADS_TABLE,
} from "@/lib/chat-helpers";

const chatIndexPath = path.join(
  __dirname,
  "../app/(app)/(drawer)/[orgSlug]/chat/index.tsx"
);
const chatRoomPath = path.join(
  __dirname,
  "../app/(app)/(drawer)/[orgSlug]/chat/[groupId].tsx"
);

describe("mobile chat regression helpers", () => {
  it("uses the current discussion threads table and routes", () => {
    expect(MOBILE_DISCUSSION_THREADS_TABLE).toBe("discussion_threads");
    expect(buildMobileDiscussionThreadRoute("acme", "thread-1")).toBe(
      "/(app)/acme/chat/threads/thread-1"
    );
    expect(buildMobileNewDiscussionThreadRoute("acme")).toBe(
      "/(app)/acme/chat/threads/new"
    );
  });

  it("keeps legacy member roles eligible for add-member selection", () => {
    expect(MOBILE_CHAT_MEMBER_DIRECTORY_ROLES).toEqual([
      "admin",
      "active_member",
      "member",
    ]);
  });

  it("allows chat access for org admins without a group membership row", () => {
    expect(
      canAccessMobileChatGroup({
        hasActiveMembership: false,
        isOrgAdmin: true,
      })
    ).toBe(true);
    expect(
      canAccessMobileChatGroup({
        hasActiveMembership: false,
        isOrgAdmin: false,
      })
    ).toBe(false);
  });

  it("allows member management for admins, moderators, and creators", () => {
    expect(
      canManageMobileChatMembers({
        isOrgAdmin: true,
        isGroupModerator: false,
        isGroupCreator: false,
      })
    ).toBe(true);
    expect(
      canManageMobileChatMembers({
        isOrgAdmin: false,
        isGroupModerator: true,
        isGroupCreator: false,
      })
    ).toBe(true);
    expect(
      canManageMobileChatMembers({
        isOrgAdmin: false,
        isGroupModerator: false,
        isGroupCreator: true,
      })
    ).toBe(true);
  });

  it("builds insert and reactivation payloads with added_by", () => {
    expect(
      buildChatGroupMemberInsertPayload({
        groupId: "group-1",
        organizationId: "org-1",
        userId: "user-2",
        addedBy: "user-1",
      })
    ).toEqual({
      chat_group_id: "group-1",
      organization_id: "org-1",
      user_id: "user-2",
      role: "member",
      added_by: "user-1",
    });

    expect(buildChatGroupMemberReactivationPayload("user-1")).toEqual({
      added_by: "user-1",
      removed_at: null,
    });
  });
});

describe("mobile chat screen wiring", () => {
  it("does not reference stale discussion tables or routes in the chat index screen", () => {
    const source = fs.readFileSync(chatIndexPath, "utf8");

    expect(source).toContain("MOBILE_DISCUSSION_THREADS_TABLE");
    expect(source).toContain("buildMobileDiscussionThreadRoute");
    expect(source).toContain("buildMobileNewDiscussionThreadRoute");
    expect(source).not.toContain("discussion_discussions");
    expect(source).not.toContain("/chat/discussions/");
  });

  it("uses the fixed membership queries in the chat room screen", () => {
    const source = fs.readFileSync(chatRoomPath, "utf8");
    const orgMemberQuery = source.match(
      /from\("user_organization_roles"\)([\s\S]{0,300})/
    )?.[1];

    expect(source).toContain('.is("removed_at", null)');
    expect(source).toContain(".maybeSingle()");
    expect(source).toContain('user:users(id, name, email, avatar_url)');
    expect(source).toContain("MOBILE_CHAT_MEMBER_DIRECTORY_ROLES");
    expect(orgMemberQuery).toContain('.eq("status", "active")');
    expect(orgMemberQuery).not.toContain("deleted_at");
  });
});
