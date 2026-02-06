import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  createAuthContext,
  isAuthenticated,
  hasOrgMembership,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for /api/chat/[groupId]/members
 *
 * GET  — List members of the chat group
 * POST — Add member(s) to the chat group
 * DELETE — Remove a member from the chat group
 *
 * Authorization matrix:
 * - GET: group member OR org admin
 * - POST: org admin OR group admin/moderator
 * - DELETE: org admin, group admin/moderator, OR self (leaving)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatGroupMemberRow {
  id: string;
  chat_group_id: string;
  user_id: string;
  organization_id: string;
  role: "admin" | "moderator" | "member";
  removed_at: string | null;
}

interface AddMembersRequest {
  auth: AuthContext;
  groupId: string;
  user_ids: string[];
}

interface RemoveMemberRequest {
  auth: AuthContext;
  groupId: string;
  user_id: string;
}

interface ListMembersRequest {
  auth: AuthContext;
  groupId: string;
}

interface MemberResult {
  status: number;
  error?: string;
  members?: ChatGroupMemberRow[];
  added?: number;
  skipped?: number;
  removed?: boolean;
}

interface SimulationContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organizationId: string;
  groupId: string;
  /** Chat group members pre-seeded in the context */
  groupMembers: ChatGroupMemberRow[];
  /** User IDs of active org members */
  activeOrgMemberUserIds: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGroupRole(
  ctx: SimulationContext,
  userId: string
): "admin" | "moderator" | "member" | null {
  const m = ctx.groupMembers.find(
    (gm) =>
      gm.user_id === userId &&
      gm.chat_group_id === ctx.groupId &&
      gm.removed_at === null
  );
  return m?.role ?? null;
}

function isGroupMember(ctx: SimulationContext, userId: string): boolean {
  return getGroupRole(ctx, userId) !== null;
}

// ─── Simulation Functions ────────────────────────────────────────────────────

function simulateListMembers(
  request: ListMembersRequest,
  ctx: SimulationContext
): MemberResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!hasOrgMembership(request.auth, ctx.organizationId)) {
    return { status: 403, error: "Forbidden" };
  }

  const userId = request.auth.user!.id;
  const admin = isOrgAdmin(request.auth, ctx.organizationId);

  if (!admin && !isGroupMember(ctx, userId)) {
    return { status: 403, error: "Forbidden" };
  }

  const activeMembers = ctx.groupMembers.filter(
    (m) => m.chat_group_id === ctx.groupId && m.removed_at === null
  );
  return { status: 200, members: activeMembers };
}

function simulateAddMembers(
  request: AddMembersRequest,
  ctx: SimulationContext
): MemberResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!hasOrgMembership(request.auth, ctx.organizationId)) {
    return { status: 403, error: "Forbidden" };
  }

  // Validate user_ids
  if (!request.user_ids || request.user_ids.length === 0) {
    return { status: 400, error: "Validation failed" };
  }

  for (const uid of request.user_ids) {
    // Simple UUID format check
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
      return { status: 400, error: "Validation failed" };
    }
  }

  const userId = request.auth.user!.id;
  const admin = isOrgAdmin(request.auth, ctx.organizationId);
  const groupRole = getGroupRole(ctx, userId);
  const canManage = admin || groupRole === "admin" || groupRole === "moderator";

  if (!canManage) {
    return { status: 403, error: "Forbidden" };
  }

  // Validate each user_id is an active org member
  const invalidIds = request.user_ids.filter(
    (uid) => !ctx.activeOrgMemberUserIds.includes(uid)
  );
  if (invalidIds.length > 0) {
    return { status: 400, error: "Some users are not active org members" };
  }

  // Count already-existing members vs new
  let added = 0;
  let skipped = 0;
  for (const uid of request.user_ids) {
    const existing = ctx.groupMembers.find(
      (m) =>
        m.chat_group_id === ctx.groupId &&
        m.user_id === uid &&
        m.removed_at === null
    );
    if (existing) {
      skipped++;
    } else {
      // Check if there's a soft-deleted row to re-activate
      const softDeleted = ctx.groupMembers.find(
        (m) =>
          m.chat_group_id === ctx.groupId &&
          m.user_id === uid &&
          m.removed_at !== null
      );
      if (softDeleted) {
        softDeleted.removed_at = null;
      } else {
        ctx.groupMembers.push({
          id: `cgm-${Date.now()}-${Math.random()}`,
          chat_group_id: ctx.groupId,
          user_id: uid,
          organization_id: ctx.organizationId,
          role: "member",
          removed_at: null,
        });
      }
      added++;
    }
  }

  return { status: 200, added, skipped };
}

function simulateRemoveMember(
  request: RemoveMemberRequest,
  ctx: SimulationContext
): MemberResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!hasOrgMembership(request.auth, ctx.organizationId)) {
    return { status: 403, error: "Forbidden" };
  }

  // Validate user_id
  if (!request.user_id) {
    return { status: 400, error: "Validation failed" };
  }

  const userId = request.auth.user!.id;
  const admin = isOrgAdmin(request.auth, ctx.organizationId);
  const groupRole = getGroupRole(ctx, userId);
  const canManage = admin || groupRole === "admin" || groupRole === "moderator";
  const isSelf = userId === request.user_id;

  if (!canManage && !isSelf) {
    return { status: 403, error: "Forbidden" };
  }

  // Check target is a group member
  const target = ctx.groupMembers.find(
    (m) =>
      m.chat_group_id === ctx.groupId &&
      m.user_id === request.user_id &&
      m.removed_at === null
  );
  if (!target) {
    return { status: 404, error: "User is not a member of this group" };
  }

  // Prevent removing last group admin
  if (target.role === "admin") {
    const adminCount = ctx.groupMembers.filter(
      (m) =>
        m.chat_group_id === ctx.groupId &&
        m.role === "admin" &&
        m.removed_at === null
    ).length;
    if (adminCount <= 1) {
      return { status: 400, error: "Cannot remove the last group admin" };
    }
  }

  // Soft-delete
  target.removed_at = new Date().toISOString();

  return { status: 200, removed: true };
}

// ─── Test Fixtures ───────────────────────────────────────────────────────────

// Use valid UUIDs throughout
const ORG_ID = "00000000-0000-4000-8000-000000000001";
const GROUP_ID = "00000000-0000-4000-8000-000000000010";
const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000100";
const MOD_USER_ID = "00000000-0000-4000-8000-000000000200";
const MEMBER_USER_ID = "00000000-0000-4000-8000-000000000300";
const OUTSIDER_USER_ID = "00000000-0000-4000-8000-000000000400";
const NEW_USER_1_ID = "00000000-0000-4000-8000-000000000500";
const NEW_USER_2_ID = "00000000-0000-4000-8000-000000000600";
const ORG_ADMIN_USER_ID = "00000000-0000-4000-8000-000000000700";

function createTestContext(
  overrides?: Partial<SimulationContext>
): SimulationContext {
  const supabase = createSupabaseStub();
  return {
    supabase,
    organizationId: ORG_ID,
    groupId: GROUP_ID,
    groupMembers: [
      {
        id: "cgm-admin",
        chat_group_id: GROUP_ID,
        user_id: ADMIN_USER_ID,
        organization_id: ORG_ID,
        role: "admin",
        removed_at: null,
      },
      {
        id: "cgm-mod",
        chat_group_id: GROUP_ID,
        user_id: MOD_USER_ID,
        organization_id: ORG_ID,
        role: "moderator",
        removed_at: null,
      },
      {
        id: "cgm-member",
        chat_group_id: GROUP_ID,
        user_id: MEMBER_USER_ID,
        organization_id: ORG_ID,
        role: "member",
        removed_at: null,
      },
    ],
    activeOrgMemberUserIds: [
      ADMIN_USER_ID,
      MOD_USER_ID,
      MEMBER_USER_ID,
      OUTSIDER_USER_ID,
      NEW_USER_1_ID,
      NEW_USER_2_ID,
    ],
    ...overrides,
  };
}

// Custom auth preset for moderator
const groupModeratorAuth = createAuthContext({
  user: { id: MOD_USER_ID, email: "mod@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "active_member", status: "active" }],
});

// Custom auth preset for group admin (who is also org member, not org admin)
const groupAdminAuth = createAuthContext({
  user: { id: ADMIN_USER_ID, email: "groupadmin@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "active_member", status: "active" }],
});

// Regular member of the group (role=member)
const groupMemberAuth = createAuthContext({
  user: { id: MEMBER_USER_ID, email: "member@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "active_member", status: "active" }],
});

// Not a group member, but an org member
const outsiderAuth = createAuthContext({
  user: { id: OUTSIDER_USER_ID, email: "outsider@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "active_member", status: "active" }],
});

// Org admin preset (uses a separate user ID)
const orgAdminAuth = createAuthContext({
  user: { id: ORG_ADMIN_USER_ID, email: "orgadmin@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "admin", status: "active" }],
});

// ─── GET Tests ───────────────────────────────────────────────────────────────

test("GET: unauthenticated user gets 401", () => {
  const ctx = createTestContext();
  const result = simulateListMembers(
    { auth: AuthPresets.unauthenticated, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(result.status, 401);
});

test("GET: non-org-member gets 403", () => {
  const ctx = createTestContext();
  const result = simulateListMembers(
    { auth: AuthPresets.authenticatedNoOrg, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("GET: non-group-member (regular org member) gets 403", () => {
  const ctx = createTestContext();
  const result = simulateListMembers(
    { auth: outsiderAuth, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("GET: group member can list members", () => {
  const ctx = createTestContext();
  const result = simulateListMembers(
    { auth: groupMemberAuth, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.members!.length, 3);
});

test("GET: org admin can list members even without group membership", () => {
  const ctx = createTestContext();
  const result = simulateListMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.members!.length, 3);
});

test("GET: does not return soft-deleted members", () => {
  const ctx = createTestContext();
  // Soft-delete one member
  ctx.groupMembers[2].removed_at = new Date().toISOString();
  simulateListMembers(
    { auth: groupMemberAuth, groupId: GROUP_ID },
    ctx
  );
  // The member-user is now removed, so they can't list anymore
  // Let's use the mod to list instead
  const result2 = simulateListMembers(
    { auth: groupModeratorAuth, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(result2.status, 200);
  assert.strictEqual(result2.members!.length, 2);
});

// ─── POST Tests ──────────────────────────────────────────────────────────────

test("POST: unauthenticated user gets 401", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: AuthPresets.unauthenticated, groupId: GROUP_ID, user_ids: [NEW_USER_1_ID] },
    ctx
  );
  assert.strictEqual(result.status, 401);
});

test("POST: non-org-member gets 403", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: AuthPresets.authenticatedNoOrg, groupId: GROUP_ID, user_ids: [NEW_USER_1_ID] },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("POST: group member (role=member) cannot add others", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: groupMemberAuth, groupId: GROUP_ID, user_ids: [NEW_USER_1_ID] },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("POST: group admin can add members", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: groupAdminAuth, groupId: GROUP_ID, user_ids: [NEW_USER_1_ID] },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.added, 1);
  assert.strictEqual(result.skipped, 0);
});

test("POST: group moderator can add members", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: groupModeratorAuth, groupId: GROUP_ID, user_ids: [NEW_USER_1_ID] },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.added, 1);
});

test("POST: org admin can add members", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_ids: [NEW_USER_1_ID, NEW_USER_2_ID] },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.added, 2);
  assert.strictEqual(result.skipped, 0);
});

test("POST: empty user_ids returns 400", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_ids: [] },
    ctx
  );
  assert.strictEqual(result.status, 400);
});

test("POST: invalid UUIDs return 400", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_ids: ["not-a-uuid"] },
    ctx
  );
  assert.strictEqual(result.status, 400);
});

test("POST: non-org-member user_id returns 400", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_ids: ["00000000-0000-0000-0000-000000000099"] },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("not active org members"));
});

test("POST: adding already-existing member returns success with skipped=1", () => {
  const ctx = createTestContext();
  const result = simulateAddMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_ids: [MEMBER_USER_ID] },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.added, 0);
  assert.strictEqual(result.skipped, 1);
});

test("POST: re-adding a soft-deleted member reactivates them", () => {
  const ctx = createTestContext();
  // Soft-delete member-user
  ctx.groupMembers[2].removed_at = new Date().toISOString();

  const result = simulateAddMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_ids: [MEMBER_USER_ID] },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.added, 1);
  // Verify membership is restored
  const restored = ctx.groupMembers.find(
    (m) => m.user_id === MEMBER_USER_ID && m.removed_at === null
  );
  assert.ok(restored);
});

// ─── DELETE Tests ────────────────────────────────────────────────────────────

test("DELETE: unauthenticated user gets 401", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: AuthPresets.unauthenticated, groupId: GROUP_ID, user_id: MEMBER_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 401);
});

test("DELETE: non-org-member gets 403", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: AuthPresets.authenticatedNoOrg, groupId: GROUP_ID, user_id: MEMBER_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("DELETE: group member (role=member) cannot remove others", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: groupMemberAuth, groupId: GROUP_ID, user_id: MOD_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 403);
});

test("DELETE: group admin can remove members", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: groupAdminAuth, groupId: GROUP_ID, user_id: MEMBER_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.removed, true);
  // Verify soft-deleted
  const removed = ctx.groupMembers.find((m) => m.user_id === MEMBER_USER_ID);
  assert.ok(removed!.removed_at);
});

test("DELETE: group moderator can remove members", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: groupModeratorAuth, groupId: GROUP_ID, user_id: MEMBER_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.removed, true);
});

test("DELETE: org admin can remove members", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_id: MEMBER_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.removed, true);
});

test("DELETE: any member can remove self (leave)", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: groupMemberAuth, groupId: GROUP_ID, user_id: MEMBER_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.removed, true);
});

test("DELETE: cannot remove the last group admin", () => {
  const ctx = createTestContext();
  // There is only 1 admin (admin-user)
  const result = simulateRemoveMember(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_id: ADMIN_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("last group admin"));
});

test("DELETE: can remove admin when there are multiple admins", () => {
  const ctx = createTestContext();
  // Add a second admin
  ctx.groupMembers.push({
    id: "cgm-admin-2",
    chat_group_id: GROUP_ID,
    user_id: NEW_USER_1_ID,
    organization_id: ORG_ID,
    role: "admin",
    removed_at: null,
  });
  const result = simulateRemoveMember(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_id: ADMIN_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.removed, true);
});

test("DELETE: missing user_id returns 400", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_id: "" },
    ctx
  );
  assert.strictEqual(result.status, 400);
});

test("DELETE: removing non-member returns 404", () => {
  const ctx = createTestContext();
  const result = simulateRemoveMember(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_id: OUTSIDER_USER_ID },
    ctx
  );
  assert.strictEqual(result.status, 404);
});

test("DELETE: removed user no longer visible in member list", () => {
  const ctx = createTestContext();
  // Remove a member
  simulateRemoveMember(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_id: MEMBER_USER_ID },
    ctx
  );
  // List members
  const result = simulateListMembers(
    { auth: groupModeratorAuth, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.members!.length, 2);
  assert.ok(!result.members!.some((m) => m.user_id === MEMBER_USER_ID));
});

// ─── Cross-operation Tests ───────────────────────────────────────────────────

test("full lifecycle: add, list, remove, list", () => {
  const ctx = createTestContext();

  // Add new member
  const addResult = simulateAddMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_ids: [NEW_USER_1_ID] },
    ctx
  );
  assert.strictEqual(addResult.status, 200);
  assert.strictEqual(addResult.added, 1);

  // List should show 4 members
  const listResult1 = simulateListMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(listResult1.members!.length, 4);

  // Remove the new member
  const removeResult = simulateRemoveMember(
    { auth: orgAdminAuth, groupId: GROUP_ID, user_id: NEW_USER_1_ID },
    ctx
  );
  assert.strictEqual(removeResult.status, 200);

  // List should show 3 members again
  const listResult2 = simulateListMembers(
    { auth: orgAdminAuth, groupId: GROUP_ID },
    ctx
  );
  assert.strictEqual(listResult2.members!.length, 3);
});
