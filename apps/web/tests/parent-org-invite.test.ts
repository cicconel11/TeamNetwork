/**
 * Parent org-invite sync — ensure parent profiles are created from org invites.
 *
 * Run: node --test --loader ./tests/ts-loader.js tests/parent-org-invite.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

type OrgRole = "admin" | "active_member" | "alumni" | "parent";
type MemberStatus = "active" | "revoked" | "pending";

interface OrgRoleRow {
  user_id: string;
  organization_id: string;
  role: OrgRole;
  status: MemberStatus;
}

interface AuthUser {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}

interface ParentRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  photo_url: string | null;
  deleted_at: string | null;
  updated_at: string;
}

function simulateHandleOrgMemberSync(
  newRow: OrgRoleRow,
  authUser: AuthUser,
  parents: ParentRow[],
  now = new Date().toISOString(),
): ParentRow[] {
  if (newRow.role !== "parent") return parents;

  const userEmail = authUser.email ?? null;
  const normalizedEmail = userEmail?.toLowerCase() ?? null;
  const firstName = authUser.first_name ?? "Member";
  const lastName = authUser.last_name ?? "";

  const existingIndex = parents.findIndex(
    (parent) =>
      parent.organization_id === newRow.organization_id &&
      parent.deleted_at === null &&
      (parent.user_id === newRow.user_id ||
        (normalizedEmail != null &&
          parent.email != null &&
          parent.email.toLowerCase() === normalizedEmail)),
  );

  if (existingIndex >= 0) {
    const existing = parents[existingIndex];
    parents[existingIndex] = {
      ...existing,
      user_id: newRow.user_id,
      email: existing.email ?? userEmail,
      photo_url: existing.photo_url ?? authUser.avatar_url ?? null,
      updated_at: now,
    };
    return parents;
  }

  return [
    ...parents,
    {
      id: randomUUID(),
      organization_id: newRow.organization_id,
      user_id: newRow.user_id,
      first_name: firstName,
      last_name: lastName,
      email: userEmail,
      photo_url: authUser.avatar_url ?? null,
      deleted_at: null,
      updated_at: now,
    },
  ];
}

describe("handle_org_member_sync — parent role sync", () => {
  it("creates a parent record when a parent org role is inserted", () => {
    const orgId = "org-1";
    const userId = "user-1";
    const parents: ParentRow[] = [];

    const result = simulateHandleOrgMemberSync(
      { user_id: userId, organization_id: orgId, role: "parent", status: "active" },
      { id: userId, email: "parent@example.com", first_name: "Jane", last_name: "Smith" },
      parents,
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].organization_id, orgId);
    assert.equal(result[0].user_id, userId);
    assert.equal(result[0].first_name, "Jane");
    assert.equal(result[0].last_name, "Smith");
    assert.equal(result[0].email, "parent@example.com");
  });

  it("reuses existing parent row without overwriting names", () => {
    const orgId = "org-1";
    const userId = "user-1";
    const existingId = randomUUID();
    const parents: ParentRow[] = [
      {
        id: existingId,
        organization_id: orgId,
        user_id: null,
        first_name: "Existing",
        last_name: "Parent",
        email: "parent@example.com",
        photo_url: null,
        deleted_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const result = simulateHandleOrgMemberSync(
      { user_id: userId, organization_id: orgId, role: "parent", status: "active" },
      { id: userId, email: "parent@example.com", first_name: "New", last_name: "Name", avatar_url: "https://img" },
      parents,
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].id, existingId);
    assert.equal(result[0].user_id, userId);
    assert.equal(result[0].first_name, "Existing");
    assert.equal(result[0].last_name, "Parent");
    assert.equal(result[0].email, "parent@example.com");
    assert.equal(result[0].photo_url, "https://img");
  });

  it("does not touch parents when role is not parent", () => {
    const parents: ParentRow[] = [
      {
        id: randomUUID(),
        organization_id: "org-1",
        user_id: "user-2",
        first_name: "Alex",
        last_name: "Lee",
        email: "alex@example.com",
        photo_url: null,
        deleted_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];

    const result = simulateHandleOrgMemberSync(
      { user_id: "user-3", organization_id: "org-1", role: "active_member", status: "active" },
      { id: "user-3", email: "new@example.com", first_name: "New", last_name: "User" },
      parents,
    );

    assert.deepStrictEqual(result, parents);
  });
});
