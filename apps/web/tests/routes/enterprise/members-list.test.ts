import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildEnterpriseMembers,
  getActiveAdminOrgIds,
  paginateEnterpriseMemberUsers,
  type EnterpriseMemberUserRow,
} from "@/lib/enterprise/member-list";

async function fetchAllEnterpriseMembers<T extends { userId: string }>(
  fetchPage: (after: string | null) => Promise<{ members: T[]; nextCursor: string | null }>
): Promise<T[]> {
  const members: T[] = [];
  let after: string | null = null;

  do {
    const page = await fetchPage(after);
    members.push(...page.members);
    after = page.nextCursor;
  } while (after !== null);

  return members;
}

test("member list scoping excludes revoked org-admin memberships", () => {
  const scopedOrgIds = getActiveAdminOrgIds([
    { organization_id: "org-revoked", role: "admin", status: "revoked" },
    { organization_id: "org-active", role: "admin", status: "active" },
  ]);

  assert.deepEqual(scopedOrgIds, ["org-active"]);
});

test("member list scoping dedupes repeated active admin rows", () => {
  const scopedOrgIds = getActiveAdminOrgIds([
    { organization_id: "org-1", role: "admin", status: "active" },
    { organization_id: "org-1", role: "admin", status: "active" },
    { organization_id: "org-2", role: "admin", status: "active" },
  ]);

  assert.deepEqual(scopedOrgIds, ["org-1", "org-2"]);
});

test("member pagination slices by unique users and uses the last returned user id as cursor", () => {
  const page = paginateEnterpriseMemberUsers(
    [
      { id: "user-1", email: "one@example.com", name: "One" },
      { id: "user-2", email: "two@example.com", name: "Two" },
      { id: "user-3", email: "three@example.com", name: "Three" },
    ],
    2
  );

  assert.deepEqual(
    page.users.map((user) => user.id),
    ["user-1", "user-2"]
  );
  // Cursor MUST be the last id of the returned page (used with `.gt(cursor)` in the
  // query), not the id of the extra peeked row. Returning the extra row's id paired
  // with `.gte(cursor)` would duplicate that row on the next page.
  assert.equal(page.nextCursor, "user-2");
});

test("member pagination returns null cursor when there is no next page", () => {
  const page = paginateEnterpriseMemberUsers(
    [
      { id: "user-1", email: "one@example.com", name: "One" },
      { id: "user-2", email: "two@example.com", name: "Two" },
    ],
    2
  );

  assert.deepEqual(
    page.users.map((user) => user.id),
    ["user-1", "user-2"]
  );
  assert.equal(page.nextCursor, null);
});

test("member pagination across consecutive pages yields no duplicates and no skips", () => {
  // Simulate the DB layer: stable order by id, fetch limit+1, apply `.gt(after)`
  // when a cursor is supplied. This mirrors the behavior of the route.
  const allUsers: EnterpriseMemberUserRow[] = Array.from({ length: 5 }, (_, index) => ({
    id: `user-${index + 1}`,
    email: `user${index + 1}@example.com`,
    name: `User ${index + 1}`,
  }));

  const limit = 2;

  const fetchPeek = (after: string | null) => {
    const filtered = after === null ? allUsers : allUsers.filter((user) => user.id > after);
    return filtered.slice(0, limit + 1);
  };

  const firstPage = paginateEnterpriseMemberUsers(fetchPeek(null), limit);
  assert.deepEqual(
    firstPage.users.map((user) => user.id),
    ["user-1", "user-2"]
  );
  assert.equal(firstPage.nextCursor, "user-2");

  const secondPage = paginateEnterpriseMemberUsers(fetchPeek(firstPage.nextCursor), limit);
  assert.deepEqual(
    secondPage.users.map((user) => user.id),
    ["user-3", "user-4"]
  );
  assert.equal(secondPage.nextCursor, "user-4");

  const thirdPage = paginateEnterpriseMemberUsers(fetchPeek(secondPage.nextCursor), limit);
  assert.deepEqual(
    thirdPage.users.map((user) => user.id),
    ["user-5"]
  );
  assert.equal(thirdPage.nextCursor, null);

  const seenIds = [
    ...firstPage.users.map((user) => user.id),
    ...secondPage.users.map((user) => user.id),
    ...thirdPage.users.map((user) => user.id),
  ];
  assert.deepEqual(seenIds, ["user-1", "user-2", "user-3", "user-4", "user-5"]);
  assert.equal(new Set(seenIds).size, seenIds.length, "no duplicate user ids across pages");
});

test("member building keeps later users reachable even when one user has many org-role rows", () => {
  const members = buildEnterpriseMembers(
    [
      { id: "user-1", email: "one@example.com", name: "One" },
      { id: "user-2", email: "two@example.com", name: "Two" },
    ],
    [
      { user_id: "user-1", organization_id: "org-1", role: "active_member" },
      { user_id: "user-1", organization_id: "org-2", role: "active_member" },
      { user_id: "user-1", organization_id: "org-3", role: "active_member" },
      { user_id: "user-2", organization_id: "org-4", role: "admin" },
    ],
    [
      { id: "org-1", name: "Alpha", slug: "alpha" },
      { id: "org-2", name: "Beta", slug: "beta" },
      { id: "org-3", name: "Gamma", slug: "gamma" },
      { id: "org-4", name: "Delta", slug: "delta" },
    ]
  );

  assert.equal(members.length, 2);
  assert.deepEqual(
    members[0].organizations.map((organization) => organization.orgId),
    ["org-1", "org-2", "org-3"]
  );
  assert.deepEqual(
    members[1].organizations.map((organization) => organization.orgId),
    ["org-4"]
  );
});

test("fetchAllEnterpriseMembers reaches later pages when nextCursor is the last returned user id", async () => {
  const seenCursors: Array<string | null> = [];

  const members = await fetchAllEnterpriseMembers(async (after) => {
    seenCursors.push(after);

    if (after === null) {
      return {
        members: [
          {
            userId: "user-1",
            email: "one@example.com",
            fullName: "One",
            organizations: [
              { orgId: "org-1", orgName: "Alpha", orgSlug: "alpha", role: "active_member" },
            ],
          },
          {
            userId: "user-2",
            email: "two@example.com",
            fullName: "Two",
            organizations: [
              { orgId: "org-2", orgName: "Beta", orgSlug: "beta", role: "active_member" },
            ],
          },
        ],
        nextCursor: "user-2",
      };
    }

    return {
      members: [
        {
          userId: "user-3",
          email: "three@example.com",
          fullName: "Three",
          organizations: [
            { orgId: "org-3", orgName: "Gamma", orgSlug: "gamma", role: "admin" },
          ],
        },
      ],
      nextCursor: null,
    };
  });

  assert.deepEqual(seenCursors, [null, "user-2"]);
  assert.deepEqual(
    members.map((member) => member.userId),
    ["user-1", "user-2", "user-3"]
  );
});

test("members route pages distinct users instead of truncating on raw role rows", () => {
  const routePath = path.join(
    process.cwd(),
    "src/app/api/enterprise/[enterpriseId]/members/route.ts"
  );
  const source = readFileSync(routePath, "utf8");

  assert.match(source, /\.from\("users"\)/);
  assert.match(source, /user_organization_roles!inner/);
  // Cursor pagination MUST use `.gt` (strict) to avoid duplicating the boundary
  // row on the next page; `.gte` would cause repeated rows.
  assert.match(source, /\.gt\("id", after\)/);
  assert.doesNotMatch(source, /\.gte\("id", after\)/);
  assert.match(source, /\.limit\(limit \+ 1\)/);
  assert.doesNotMatch(source, /\.limit\(limit \* 5\)/);
});
