import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  AuthContext,
  createAuthContext,
  isAuthenticated,
  hasOrgMembership,
  isOrgAdmin,
} from "./utils/authMock.ts";

/**
 * Tests for chat polls/forms security hardening.
 *
 * Covers:
 * - Non-member org admin cannot vote or retract votes
 * - allow_change: false blocks vote change (409) and retraction (403)
 * - Pending polls: author can vote, regular member cannot
 * - Pending forms: author can submit, regular member cannot
 * - Form response strips extra field keys
 * - Form submit with flat body format succeeds
 * - DELETE vote validates poll message exists and is not deleted
 * - DELETE vote includes chat_group_id scope
 */

// ─── Constants ─────────────────────────────────────────────────────────────

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const GROUP_ID = "00000000-0000-4000-8000-000000000010";
const POLL_MESSAGE_ID = "00000000-0000-4000-8000-000000000100";
const FORM_MESSAGE_ID = "00000000-0000-4000-8000-000000000101";
const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000201";
const MEMBER_USER_ID = "00000000-0000-4000-8000-000000000202";
const AUTHOR_USER_ID = "00000000-0000-4000-8000-000000000203";

// ─── Types ─────────────────────────────────────────────────────────────────

interface GroupMembership {
  user_id: string;
  role: "admin" | "moderator" | "member";
}

interface PollMetadata {
  question: string;
  options: { label: string }[];
  allow_change: boolean;
}

interface FormMetadata {
  title: string;
  fields: { id: string; label: string; type: string; required: boolean }[];
}

interface PollMessage {
  id: string;
  chat_group_id: string;
  author_id: string;
  message_type: "poll";
  metadata: PollMetadata;
  status: "approved" | "pending";
  deleted_at: string | null;
}

interface FormMessage {
  id: string;
  chat_group_id: string;
  author_id: string;
  message_type: "form";
  metadata: FormMetadata;
  status: "approved" | "pending";
  deleted_at: string | null;
}

interface ExistingVote {
  message_id: string;
  user_id: string;
  option_index: number;
}

interface SimContext {
  organizationId: string;
  groupId: string;
  groupMembers: GroupMembership[];
  pollMessages: PollMessage[];
  formMessages: FormMessage[];
  existingVotes: ExistingVote[];
  existingFormResponses: { message_id: string; user_id: string }[];
}

interface VoteResult {
  status: number;
  error?: string;
}

// ─── Simulation Functions ──────────────────────────────────────────────────

function getGroupMembership(
  ctx: SimContext,
  userId: string
): GroupMembership | null {
  return ctx.groupMembers.find((m) => m.user_id === userId) ?? null;
}

function simulateVote(
  auth: AuthContext,
  ctx: SimContext,
  messageId: string,
  optionIndex: number
): VoteResult {
  if (!isAuthenticated(auth)) return { status: 401, error: "Unauthorized" };
  if (!hasOrgMembership(auth, ctx.organizationId))
    return { status: 403, error: "Forbidden" };

  const userId = auth.user!.id;
  const userIsOrgAdmin = isOrgAdmin(auth, ctx.organizationId);
  const membership = getGroupMembership(ctx, userId);

  // Org admin without group membership is blocked
  if (!membership && !userIsOrgAdmin) return { status: 403, error: "Forbidden" };
  // 2a: Require group membership for voting (even org admins)
  if (!membership) return { status: 403, error: "Forbidden" };

  const poll = ctx.pollMessages.find(
    (m) => m.id === messageId && m.chat_group_id === ctx.groupId
  );
  if (!poll || poll.deleted_at !== null) return { status: 404, error: "Poll not found" };
  if (poll.message_type !== "poll") return { status: 400, error: "Message is not a poll" };

  const isAuthor = poll.author_id === userId;
  const isGroupMod =
    membership.role === "admin" || membership.role === "moderator";
  const canModerate = userIsOrgAdmin || isGroupMod;

  if (poll.status !== "approved" && !isAuthor && !canModerate) {
    return { status: 403, error: "Poll is not yet approved" };
  }

  if (optionIndex >= poll.metadata.options.length) {
    return { status: 400, error: "option_index out of bounds" };
  }

  // 2d: allow_change enforcement
  if (poll.metadata.allow_change === false) {
    const existingVote = ctx.existingVotes.find(
      (v) => v.message_id === messageId && v.user_id === userId
    );
    if (existingVote) {
      return { status: 409, error: "Vote cannot be changed for this poll" };
    }
  }

  return { status: 200 };
}

function simulateRetractVote(
  auth: AuthContext,
  ctx: SimContext,
  messageId: string
): VoteResult {
  if (!isAuthenticated(auth)) return { status: 401, error: "Unauthorized" };
  if (!hasOrgMembership(auth, ctx.organizationId))
    return { status: 403, error: "Forbidden" };

  const userId = auth.user!.id;
  const membership = getGroupMembership(ctx, userId);

  // getChatGroupContext allows org admins through even without membership
  // but 2a: require membership for vote retraction
  if (!membership) return { status: 403, error: "Forbidden" };

  // 2b: validate poll message
  const poll = ctx.pollMessages.find(
    (m) => m.id === messageId && m.chat_group_id === ctx.groupId
  );
  if (!poll || poll.deleted_at !== null) return { status: 404, error: "Poll not found" };
  if (poll.message_type !== "poll") return { status: 400, error: "Message is not a poll" };

  // 2d: block retraction when allow_change is false
  if (poll.metadata.allow_change === false) {
    return { status: 403, error: "Vote cannot be retracted for this poll" };
  }

  return { status: 200 };
}

function simulateFormSubmit(
  auth: AuthContext,
  ctx: SimContext,
  messageId: string,
  body: Record<string, string>
): VoteResult & { filteredResponses?: Record<string, string> } {
  if (!isAuthenticated(auth)) return { status: 401, error: "Unauthorized" };
  if (!hasOrgMembership(auth, ctx.organizationId))
    return { status: 403, error: "Forbidden" };

  const userId = auth.user!.id;
  const membership = getGroupMembership(ctx, userId);
  const userIsOrgAdmin = isOrgAdmin(auth, ctx.organizationId);

  if (!membership && !userIsOrgAdmin) return { status: 403, error: "Forbidden" };
  if (!membership) return { status: 403, error: "Forbidden" };

  const form = ctx.formMessages.find(
    (m) => m.id === messageId && m.chat_group_id === ctx.groupId
  );
  if (!form || form.deleted_at !== null) return { status: 404, error: "Form not found" };
  if (form.message_type !== "form") return { status: 400, error: "Message is not a form" };

  const isAuthor = form.author_id === userId;
  const isGroupMod =
    membership.role === "admin" || membership.role === "moderator";
  const canModerate = userIsOrgAdmin || isGroupMod;

  if (form.status !== "approved" && !isAuthor && !canModerate) {
    return { status: 403, error: "Form is not available" };
  }

  // 2c: strip extra field keys
  const allowedFieldIds = new Set(form.metadata.fields.map((f) => f.id));
  const filteredResponses = Object.fromEntries(
    Object.entries(body).filter(([key]) => allowedFieldIds.has(key))
  );

  // Check required fields
  const missingRequired = form.metadata.fields
    .filter((f) => f.required)
    .filter((f) => !filteredResponses[f.id] || filteredResponses[f.id].trim() === "");

  if (missingRequired.length > 0) {
    return { status: 400, error: "Missing required fields" };
  }

  // Check duplicate
  const existing = ctx.existingFormResponses.find(
    (r) => r.message_id === messageId && r.user_id === userId
  );
  if (existing) return { status: 409, error: "Already submitted" };

  return { status: 201, filteredResponses };
}

/**
 * Simulates the backward-compatible payload normalization (2e).
 * Unwraps { responses: {...} } to flat record.
 */
function normalizeFormPayload(rawBody: unknown): unknown {
  if (
    rawBody &&
    typeof rawBody === "object" &&
    !Array.isArray(rawBody) &&
    "responses" in rawBody &&
    typeof (rawBody as Record<string, unknown>).responses === "object"
  ) {
    return (rawBody as Record<string, unknown>).responses;
  }
  return rawBody;
}

// ─── Test Context Factory ──────────────────────────────────────────────────

function createTestContext(overrides: Partial<SimContext> = {}): SimContext {
  return {
    organizationId: ORG_ID,
    groupId: GROUP_ID,
    groupMembers: [
      { user_id: MEMBER_USER_ID, role: "member" },
      { user_id: AUTHOR_USER_ID, role: "member" },
    ],
    pollMessages: [
      {
        id: POLL_MESSAGE_ID,
        chat_group_id: GROUP_ID,
        author_id: AUTHOR_USER_ID,
        message_type: "poll",
        metadata: {
          question: "Favorite color?",
          options: [{ label: "Red" }, { label: "Blue" }, { label: "Green" }],
          allow_change: true,
        },
        status: "approved",
        deleted_at: null,
      },
    ],
    formMessages: [
      {
        id: FORM_MESSAGE_ID,
        chat_group_id: GROUP_ID,
        author_id: AUTHOR_USER_ID,
        message_type: "form",
        metadata: {
          title: "Feedback",
          fields: [
            { id: "name", label: "Name", type: "text", required: true },
            { id: "rating", label: "Rating", type: "text", required: false },
          ],
        },
        status: "approved",
        deleted_at: null,
      },
    ],
    existingVotes: [],
    existingFormResponses: [],
    ...overrides,
  };
}

// ─── Auth Helpers ──────────────────────────────────────────────────────────

const orgAdminNoGroupMembership = createAuthContext({
  user: { id: ADMIN_USER_ID },
  memberships: [{ organization_id: ORG_ID, role: "admin", status: "active" }],
});

const groupMember = createAuthContext({
  user: { id: MEMBER_USER_ID },
  memberships: [
    { organization_id: ORG_ID, role: "active_member", status: "active" },
  ],
});

const authorMember = createAuthContext({
  user: { id: AUTHOR_USER_ID },
  memberships: [
    { organization_id: ORG_ID, role: "active_member", status: "active" },
  ],
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("2a: Non-member org admin vote/retract blocked", () => {
  test("org admin without group membership cannot vote", () => {
    const ctx = createTestContext();
    const result = simulateVote(orgAdminNoGroupMembership, ctx, POLL_MESSAGE_ID, 0);
    assert.equal(result.status, 403);
  });

  test("org admin without group membership cannot retract vote", () => {
    const ctx = createTestContext();
    const result = simulateRetractVote(orgAdminNoGroupMembership, ctx, POLL_MESSAGE_ID);
    assert.equal(result.status, 403);
  });

  test("group member can vote", () => {
    const ctx = createTestContext();
    const result = simulateVote(groupMember, ctx, POLL_MESSAGE_ID, 0);
    assert.equal(result.status, 200);
  });
});

describe("2b: DELETE vote validates poll message", () => {
  test("retract vote on non-existent message returns 404", () => {
    const ctx = createTestContext();
    const result = simulateRetractVote(groupMember, ctx, "nonexistent-id");
    assert.equal(result.status, 404);
  });

  test("retract vote on deleted poll returns 404", () => {
    const ctx = createTestContext({
      pollMessages: [
        {
          id: POLL_MESSAGE_ID,
          chat_group_id: GROUP_ID,
          author_id: AUTHOR_USER_ID,
          message_type: "poll",
          metadata: {
            question: "Test?",
            options: [{ label: "A" }, { label: "B" }],
            allow_change: true,
          },
          status: "approved",
          deleted_at: new Date().toISOString(),
        },
      ],
    });
    const result = simulateRetractVote(groupMember, ctx, POLL_MESSAGE_ID);
    assert.equal(result.status, 404);
  });

  test("retract vote scoped to group (wrong group returns 404)", () => {
    const ctx = createTestContext({
      pollMessages: [
        {
          id: POLL_MESSAGE_ID,
          chat_group_id: "other-group",
          author_id: AUTHOR_USER_ID,
          message_type: "poll",
          metadata: {
            question: "Test?",
            options: [{ label: "A" }, { label: "B" }],
            allow_change: true,
          },
          status: "approved",
          deleted_at: null,
        },
      ],
    });
    const result = simulateRetractVote(groupMember, ctx, POLL_MESSAGE_ID);
    assert.equal(result.status, 404);
  });
});

describe("2c: Form response strips extra field keys", () => {
  test("extra keys not in form metadata are stripped", () => {
    const ctx = createTestContext();
    const result = simulateFormSubmit(groupMember, ctx, FORM_MESSAGE_ID, {
      name: "Alice",
      rating: "5",
      injected_field: "malicious",
      another_extra: "data",
    });
    assert.equal(result.status, 201);
    assert.ok(result.filteredResponses);
    assert.equal(Object.keys(result.filteredResponses).length, 2);
    assert.equal(result.filteredResponses.name, "Alice");
    assert.equal(result.filteredResponses.rating, "5");
    assert.equal(result.filteredResponses.injected_field, undefined);
    assert.equal(result.filteredResponses.another_extra, undefined);
  });

  test("required field missing after stripping returns 400", () => {
    const ctx = createTestContext();
    const result = simulateFormSubmit(groupMember, ctx, FORM_MESSAGE_ID, {
      injected_field: "only extra keys",
    });
    assert.equal(result.status, 400);
    assert.equal(result.error, "Missing required fields");
  });
});

describe("2d: allow_change: false enforcement", () => {
  test("blocks vote change when allow_change is false", () => {
    const ctx = createTestContext({
      pollMessages: [
        {
          id: POLL_MESSAGE_ID,
          chat_group_id: GROUP_ID,
          author_id: AUTHOR_USER_ID,
          message_type: "poll",
          metadata: {
            question: "Locked poll?",
            options: [{ label: "Yes" }, { label: "No" }],
            allow_change: false,
          },
          status: "approved",
          deleted_at: null,
        },
      ],
      existingVotes: [
        { message_id: POLL_MESSAGE_ID, user_id: MEMBER_USER_ID, option_index: 0 },
      ],
    });
    const result = simulateVote(groupMember, ctx, POLL_MESSAGE_ID, 1);
    assert.equal(result.status, 409);
    assert.match(result.error!, /cannot be changed/);
  });

  test("allows first vote when allow_change is false", () => {
    const ctx = createTestContext({
      pollMessages: [
        {
          id: POLL_MESSAGE_ID,
          chat_group_id: GROUP_ID,
          author_id: AUTHOR_USER_ID,
          message_type: "poll",
          metadata: {
            question: "Locked poll?",
            options: [{ label: "Yes" }, { label: "No" }],
            allow_change: false,
          },
          status: "approved",
          deleted_at: null,
        },
      ],
    });
    const result = simulateVote(groupMember, ctx, POLL_MESSAGE_ID, 0);
    assert.equal(result.status, 200);
  });

  test("blocks vote retraction when allow_change is false", () => {
    const ctx = createTestContext({
      pollMessages: [
        {
          id: POLL_MESSAGE_ID,
          chat_group_id: GROUP_ID,
          author_id: AUTHOR_USER_ID,
          message_type: "poll",
          metadata: {
            question: "Locked poll?",
            options: [{ label: "Yes" }, { label: "No" }],
            allow_change: false,
          },
          status: "approved",
          deleted_at: null,
        },
      ],
    });
    const result = simulateRetractVote(groupMember, ctx, POLL_MESSAGE_ID);
    assert.equal(result.status, 403);
    assert.match(result.error!, /cannot be retracted/);
  });

  test("allows vote change when allow_change is true", () => {
    const ctx = createTestContext({
      existingVotes: [
        { message_id: POLL_MESSAGE_ID, user_id: MEMBER_USER_ID, option_index: 0 },
      ],
    });
    const result = simulateVote(groupMember, ctx, POLL_MESSAGE_ID, 1);
    assert.equal(result.status, 200);
  });
});

describe("Pending poll/form access control", () => {
  test("author can vote on pending poll", () => {
    const ctx = createTestContext({
      pollMessages: [
        {
          id: POLL_MESSAGE_ID,
          chat_group_id: GROUP_ID,
          author_id: AUTHOR_USER_ID,
          message_type: "poll",
          metadata: {
            question: "Pending?",
            options: [{ label: "A" }, { label: "B" }],
            allow_change: true,
          },
          status: "pending",
          deleted_at: null,
        },
      ],
    });
    const result = simulateVote(authorMember, ctx, POLL_MESSAGE_ID, 0);
    assert.equal(result.status, 200);
  });

  test("regular member cannot vote on pending poll", () => {
    const ctx = createTestContext({
      pollMessages: [
        {
          id: POLL_MESSAGE_ID,
          chat_group_id: GROUP_ID,
          author_id: AUTHOR_USER_ID,
          message_type: "poll",
          metadata: {
            question: "Pending?",
            options: [{ label: "A" }, { label: "B" }],
            allow_change: true,
          },
          status: "pending",
          deleted_at: null,
        },
      ],
    });
    const result = simulateVote(groupMember, ctx, POLL_MESSAGE_ID, 0);
    assert.equal(result.status, 403);
    assert.match(result.error!, /not yet approved/);
  });

  test("author can submit to pending form", () => {
    const ctx = createTestContext({
      formMessages: [
        {
          id: FORM_MESSAGE_ID,
          chat_group_id: GROUP_ID,
          author_id: AUTHOR_USER_ID,
          message_type: "form",
          metadata: {
            title: "Pending Form",
            fields: [{ id: "name", label: "Name", type: "text", required: true }],
          },
          status: "pending",
          deleted_at: null,
        },
      ],
    });
    const result = simulateFormSubmit(authorMember, ctx, FORM_MESSAGE_ID, {
      name: "Author",
    });
    assert.equal(result.status, 201);
  });

  test("regular member cannot submit to pending form", () => {
    const ctx = createTestContext({
      formMessages: [
        {
          id: FORM_MESSAGE_ID,
          chat_group_id: GROUP_ID,
          author_id: AUTHOR_USER_ID,
          message_type: "form",
          metadata: {
            title: "Pending Form",
            fields: [{ id: "name", label: "Name", type: "text", required: true }],
          },
          status: "pending",
          deleted_at: null,
        },
      ],
    });
    const result = simulateFormSubmit(groupMember, ctx, FORM_MESSAGE_ID, {
      name: "Member",
    });
    assert.equal(result.status, 403);
    assert.match(result.error!, /not available/);
  });
});

describe("2e: Form payload normalization (backward compat)", () => {
  test("flat body format passes through unchanged", () => {
    const flat = { name: "Alice", rating: "5" };
    const result = normalizeFormPayload(flat);
    assert.deepEqual(result, flat);
  });

  test("wrapped { responses: {...} } is unwrapped", () => {
    const wrapped = { responses: { name: "Alice", rating: "5" } };
    const result = normalizeFormPayload(wrapped);
    assert.deepEqual(result, { name: "Alice", rating: "5" });
  });

  test("non-object responses key is not unwrapped", () => {
    const bad = { responses: "not-an-object" };
    const result = normalizeFormPayload(bad);
    assert.deepEqual(result, bad);
  });

  test("array body is not unwrapped", () => {
    const arr = [1, 2, 3];
    const result = normalizeFormPayload(arr);
    assert.deepEqual(result, arr);
  });

  test("client sends flat body (correct format)", () => {
    const ctx = createTestContext();
    const flat = { name: "Alice" };
    const normalized = normalizeFormPayload(flat) as Record<string, string>;
    const result = simulateFormSubmit(groupMember, ctx, FORM_MESSAGE_ID, normalized);
    assert.equal(result.status, 201);
  });
});

describe("Form response immutability", () => {
  test("duplicate form submission returns 409", () => {
    const ctx = createTestContext({
      existingFormResponses: [
        { message_id: FORM_MESSAGE_ID, user_id: MEMBER_USER_ID },
      ],
    });
    const result = simulateFormSubmit(groupMember, ctx, FORM_MESSAGE_ID, {
      name: "Alice again",
    });
    assert.equal(result.status, 409);
    assert.match(result.error!, /Already submitted/);
  });
});
