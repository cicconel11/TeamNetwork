import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchAllEnterpriseMembers,
  shouldRedirectAfterBatchCreate,
  type EnterpriseMemberRecord,
} from "@/lib/enterprise/batch-org-wizard";

function buildMember(
  userId: string,
  orgs: Array<{ orgId: string; orgName: string }>
): EnterpriseMemberRecord {
  return {
    userId,
    email: `${userId}@example.com`,
    fullName: `Member ${userId}`,
    organizations: orgs.map((org) => ({
      orgId: org.orgId,
      orgName: org.orgName,
      orgSlug: org.orgId,
      role: "active_member",
    })),
  };
}

test("fetchAllEnterpriseMembers follows every cursor page before resolving", async () => {
  const cursors: Array<string | null> = [];

  const members = await fetchAllEnterpriseMembers(async (after) => {
    cursors.push(after);

    if (after === null) {
      return {
        members: [buildMember("user-1", [{ orgId: "org-1", orgName: "Alpha" }])],
        nextCursor: "user-1",
      };
    }

    return {
      members: [buildMember("user-2", [{ orgId: "org-2", orgName: "Beta" }])],
      nextCursor: null,
    };
  });

  assert.deepEqual(cursors, [null, "user-1"]);
  assert.equal(members.length, 2);
  assert.equal(members[1].userId, "user-2");
});

test("fetchAllEnterpriseMembers merges overlapping users across pages", async () => {
  const members = await fetchAllEnterpriseMembers(async (after) => {
    if (after === null) {
      return {
        members: [buildMember("user-1", [{ orgId: "org-1", orgName: "Alpha" }])],
        nextCursor: "user-1",
      };
    }

    return {
      members: [buildMember("user-1", [{ orgId: "org-2", orgName: "Beta" }])],
      nextCursor: null,
    };
  });

  assert.equal(members.length, 1);
  assert.deepEqual(
    members[0].organizations.map((org) => org.orgId),
    ["org-1", "org-2"]
  );
});

test("shouldRedirectAfterBatchCreate ignores skipped invites when nothing failed", () => {
  assert.equal(
    shouldRedirectAfterBatchCreate({
      orgsFailed: 0,
      membersFailed: 0,
      invitesFailed: 0,
      invitesSkipped: 3,
    }),
    true
  );
});

test("shouldRedirectAfterBatchCreate blocks redirect on partial failures", () => {
  assert.equal(
    shouldRedirectAfterBatchCreate({
      orgsFailed: 0,
      membersFailed: 1,
      invitesFailed: 0,
    }),
    false
  );
  assert.equal(
    shouldRedirectAfterBatchCreate({
      orgsFailed: 1,
      membersFailed: 0,
      invitesFailed: 0,
    }),
    false
  );
  assert.equal(
    shouldRedirectAfterBatchCreate({
      orgsFailed: 0,
      membersFailed: 0,
      invitesFailed: 1,
    }),
    false
  );
});
