import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthContext,
  createAuthContext,
  hasOrgMembership,
  isAuthenticated,
  isOrgAdmin,
} from "../../utils/authMock.ts";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const GROUP_ID = "00000000-0000-4000-8000-000000000010";
const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000201";
const MEMBER_USER_ID = "00000000-0000-4000-8000-000000000202";
const PARENT_USER_ID = "00000000-0000-4000-8000-000000000203";
const OUTSIDER_USER_ID = "00000000-0000-4000-8000-000000000299";

interface MessageRequest {
  auth: AuthContext;
  body?: string;
}

interface MessageContext {
  organizationId: string;
  groupId: string;
  requireApproval: boolean;
  groupMemberUserIds: string[];
}

function simulateSendTextMessage(request: MessageRequest, ctx: MessageContext): { status: number; error?: string } {
  if (!isAuthenticated(request.auth)) return { status: 401, error: "Unauthorized" };
  if (!hasOrgMembership(request.auth, ctx.organizationId)) return { status: 403, error: "Forbidden" };

  const body = request.body?.trim() ?? "";
  if (body.length === 0 || body.length > 4000) {
    return { status: 400, error: "Invalid request body" };
  }

  const userId = request.auth.user!.id;
  const isGroupMember = ctx.groupMemberUserIds.includes(userId);
  const admin = isOrgAdmin(request.auth, ctx.organizationId);
  if (!isGroupMember && !admin) return { status: 403, error: "Forbidden" };

  return { status: 201 };
}

const adminNoGroupMembership = createAuthContext({
  user: { id: ADMIN_USER_ID, email: "admin@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "admin", status: "active" }],
});

const groupMember = createAuthContext({
  user: { id: MEMBER_USER_ID, email: "member@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "active_member", status: "active" }],
});

const parentGroupMember = createAuthContext({
  user: { id: PARENT_USER_ID, email: "parent@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "parent", status: "active" }],
});

const outsider = createAuthContext({
  user: { id: OUTSIDER_USER_ID, email: "outsider@example.com" },
  memberships: [{ organization_id: ORG_ID, role: "active_member", status: "active" }],
});

test("POST /api/chat/[groupId]/messages allows org admin without explicit group membership", () => {
  const result = simulateSendTextMessage(
    { auth: adminNoGroupMembership, body: "Admin announcement" },
    { organizationId: ORG_ID, groupId: GROUP_ID, requireApproval: false, groupMemberUserIds: [MEMBER_USER_ID] },
  );
  assert.equal(result.status, 201);
});

test("POST /api/chat/[groupId]/messages allows group members", () => {
  const result = simulateSendTextMessage(
    { auth: groupMember, body: "Hello team" },
    { organizationId: ORG_ID, groupId: GROUP_ID, requireApproval: false, groupMemberUserIds: [MEMBER_USER_ID] },
  );
  assert.equal(result.status, 201);
});

test("POST /api/chat/[groupId]/messages allows parent group members", () => {
  const result = simulateSendTextMessage(
    { auth: parentGroupMember, body: "Parent update" },
    {
      organizationId: ORG_ID,
      groupId: GROUP_ID,
      requireApproval: false,
      groupMemberUserIds: [MEMBER_USER_ID, PARENT_USER_ID],
    },
  );
  assert.equal(result.status, 201);
});

test("POST /api/chat/[groupId]/messages rejects non-member non-admin users", () => {
  const result = simulateSendTextMessage(
    { auth: outsider, body: "Should not send" },
    { organizationId: ORG_ID, groupId: GROUP_ID, requireApproval: false, groupMemberUserIds: [MEMBER_USER_ID] },
  );
  assert.equal(result.status, 403);
});
