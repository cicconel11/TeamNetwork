import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";

/**
 * Tests for AI thread and message routes:
 *
 * GET  /api/ai/[orgId]/threads          — list threads
 * DELETE /api/ai/[orgId]/threads/[threadId]  — soft-delete thread
 * GET  /api/ai/[orgId]/threads/[threadId]/messages — list messages
 *
 * These routes require admin role (via getAiOrgContext) and use
 * resolveOwnThread for ownership checks on per-thread operations.
 */

// ── Simulation types ──────────────────────────────────────────────────────────

interface MockThread {
  id: string;
  user_id: string;
  org_id: string;
  surface: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface MockMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  intent: string | null;
  status: string;
  created_at: string;
}

// ── Simulate getAiOrgContext ───────────────────────────────────────────────────

function simulateAiOrgContext(
  auth: AuthContext,
  orgId: string
): { ok: true; userId: string } | { ok: false; status: number; error: string } {
  if (!isAuthenticated(auth)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!isOrgAdmin(auth, orgId)) {
    return { ok: false, status: 403, error: "AI assistant requires admin role" };
  }
  return { ok: true, userId: auth.user!.id };
}

// ── Simulate resolveOwnThread ─────────────────────────────────────────────────

function simulateResolveThread(
  threadId: string,
  userId: string,
  orgId: string,
  threads: MockThread[]
): { ok: true; thread: MockThread } | { ok: false; status: 404 | 403; message: string } {
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) {
    return { ok: false, status: 404, message: "Thread not found" };
  }
  if (thread.user_id !== userId || thread.org_id !== orgId) {
    return { ok: false, status: 403, message: "Access denied" };
  }
  return { ok: true, thread };
}

// ── GET /api/ai/[orgId]/threads ───────────────────────────────────────────────

interface ListThreadsRequest {
  auth: AuthContext;
  orgId: string;
  surface?: string;
  limit?: number;
  cursor?: string;
  dbThreads?: MockThread[];
  dbError?: { message: string } | null;
}

interface ListThreadsResult {
  status: number;
  threads?: MockThread[];
  error?: string;
}

function simulateListThreads(req: ListThreadsRequest): ListThreadsResult {
  const ctx = simulateAiOrgContext(req.auth, req.orgId);
  if (!ctx.ok) return { status: ctx.status, error: ctx.error };

  if (req.dbError) {
    return { status: 500, error: "Failed to list threads" };
  }

  const threads = req.dbThreads ?? [];
  const limit = req.limit ?? 20;

  let filtered = threads.filter((t) => t.org_id === req.orgId);
  if (req.surface) filtered = filtered.filter((t) => t.surface === req.surface);
  if (req.cursor) filtered = filtered.filter((t) => t.id < req.cursor!);
  filtered = filtered
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);

  return { status: 200, threads: filtered };
}

// ── DELETE /api/ai/[orgId]/threads/[threadId] ─────────────────────────────────

interface DeleteThreadRequest {
  auth: AuthContext;
  orgId: string;
  threadId: string;
  dbThreads?: MockThread[];
  deleteError?: { message: string } | null;
}

interface DeleteThreadResult {
  status: number;
  success?: boolean;
  error?: string;
}

function simulateDeleteThread(req: DeleteThreadRequest): DeleteThreadResult {
  const ctx = simulateAiOrgContext(req.auth, req.orgId);
  if (!ctx.ok) return { status: ctx.status, error: ctx.error };

  const resolution = simulateResolveThread(
    req.threadId,
    ctx.userId,
    req.orgId,
    req.dbThreads ?? []
  );
  if (!resolution.ok) {
    return { status: resolution.status, error: resolution.message };
  }

  if (req.deleteError) {
    return { status: 500, error: "Failed to delete thread" };
  }

  return { status: 200, success: true };
}

// ── GET /api/ai/[orgId]/threads/[threadId]/messages ───────────────────────────

interface ListMessagesRequest {
  auth: AuthContext;
  orgId: string;
  threadId: string;
  dbThreads?: MockThread[];
  dbMessages?: MockMessage[];
  dbError?: { message: string } | null;
}

interface ListMessagesResult {
  status: number;
  messages?: MockMessage[];
  error?: string;
}

function simulateListMessages(req: ListMessagesRequest): ListMessagesResult {
  const ctx = simulateAiOrgContext(req.auth, req.orgId);
  if (!ctx.ok) return { status: ctx.status, error: ctx.error };

  const resolution = simulateResolveThread(
    req.threadId,
    ctx.userId,
    req.orgId,
    req.dbThreads ?? []
  );
  if (!resolution.ok) {
    return { status: resolution.status, error: resolution.message };
  }

  if (req.dbError) {
    return { status: 500, error: "Failed to list messages" };
  }

  const messages = (req.dbMessages ?? [])
    .filter((m) => m.thread_id === req.threadId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return { status: 200, messages };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const OTHER_ORG_ID = "org-uuid-2";
const ADMIN_USER_ID = "admin-user";
const OTHER_USER_ID = "other-user-999";

const THREAD_1: MockThread = {
  id: "thread-uuid-1",
  user_id: ADMIN_USER_ID,
  org_id: ORG_ID,
  surface: "general",
  title: "First thread",
  created_at: "2024-01-01T10:00:00Z",
  updated_at: "2024-01-01T10:30:00Z",
};

const THREAD_2: MockThread = {
  id: "thread-uuid-2",
  user_id: ADMIN_USER_ID,
  org_id: ORG_ID,
  surface: "members",
  title: "Second thread",
  created_at: "2024-01-02T10:00:00Z",
  updated_at: "2024-01-02T10:30:00Z",
};

const OTHER_USER_THREAD: MockThread = {
  id: "thread-uuid-3",
  user_id: OTHER_USER_ID,
  org_id: ORG_ID,
  surface: "general",
  title: "Other user's thread",
  created_at: "2024-01-03T10:00:00Z",
  updated_at: "2024-01-03T10:30:00Z",
};

const MESSAGE_1: MockMessage = {
  id: "msg-uuid-1",
  thread_id: "thread-uuid-1",
  role: "user",
  content: "Hello",
  intent: null,
  status: "delivered",
  created_at: "2024-01-01T10:00:00Z",
};

const MESSAGE_2: MockMessage = {
  id: "msg-uuid-2",
  thread_id: "thread-uuid-1",
  role: "assistant",
  content: "Hi there",
  intent: "greeting",
  status: "delivered",
  created_at: "2024-01-01T10:00:05Z",
};

// ── GET /threads — auth tests ──────────────────────────────────────────────────

test("GET threads returns 401 when unauthenticated", () => {
  const result = simulateListThreads({
    auth: AuthPresets.unauthenticated,
    orgId: ORG_ID,
  });
  assert.strictEqual(result.status, 401);
  assert.ok(result.error?.includes("Unauthorized"));
});

test("GET threads returns 403 when user is not an org admin", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgMember(ORG_ID),
    orgId: ORG_ID,
  });
  assert.strictEqual(result.status, 403);
  assert.ok(result.error?.includes("admin"));
});

test("GET threads returns 403 for alumni users", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAlumni(ORG_ID),
    orgId: ORG_ID,
  });
  assert.strictEqual(result.status, 403);
});

test("GET threads returns 403 when admin of different org", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(OTHER_ORG_ID),
    orgId: ORG_ID,
  });
  assert.strictEqual(result.status, 403);
});

// ── GET /threads — success and filtering tests ────────────────────────────────

test("GET threads returns 200 with thread list for org admin", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.threads?.length, 2);
});

test("GET threads filters by surface when provided", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    surface: "members",
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.threads?.length, 1);
  assert.strictEqual(result.threads?.[0].surface, "members");
});

test("GET threads returns empty list when no threads exist", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    dbThreads: [],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.threads?.length, 0);
});

test("GET threads returns only threads for the requested org", () => {
  const otherOrgThread: MockThread = {
    ...THREAD_1,
    id: "thread-other-org",
    org_id: OTHER_ORG_ID,
  };
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    dbThreads: [THREAD_1, otherOrgThread],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.threads?.length, 1);
  assert.strictEqual(result.threads?.[0].org_id, ORG_ID);
});

test("GET threads orders by updated_at descending", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 200);
  // THREAD_2 has later updated_at, should appear first
  assert.strictEqual(result.threads?.[0].id, THREAD_2.id);
  assert.strictEqual(result.threads?.[1].id, THREAD_1.id);
});

test("GET threads applies cursor for pagination", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    cursor: "thread-uuid-2",
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 200);
  // Only threads with id < cursor
  assert.ok(result.threads?.every((t) => t.id < "thread-uuid-2"));
});

test("GET threads returns 500 when DB query fails", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    dbThreads: [],
    dbError: { message: "connection timeout" },
  });
  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("Failed to list threads"));
});

// ── DELETE /threads/[threadId] — auth tests ────────────────────────────────────

test("DELETE thread returns 401 when unauthenticated", () => {
  const result = simulateDeleteThread({
    auth: AuthPresets.unauthenticated,
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
  });
  assert.strictEqual(result.status, 401);
});

test("DELETE thread returns 403 when user is not an org admin", () => {
  const result = simulateDeleteThread({
    auth: AuthPresets.orgMember(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
  });
  assert.strictEqual(result.status, 403);
  assert.ok(result.error?.includes("admin"));
});

// ── DELETE /threads/[threadId] — ownership tests ───────────────────────────────

test("DELETE thread returns 404 when thread does not exist", () => {
  const result = simulateDeleteThread({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: "nonexistent-thread-uuid",
    dbThreads: [THREAD_1],
  });
  assert.strictEqual(result.status, 404);
  assert.ok(result.error?.includes("not found") || result.error?.includes("Thread"));
});

test("DELETE thread returns 403 when thread belongs to different user", () => {
  const result = simulateDeleteThread({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: OTHER_USER_THREAD.id,
    dbThreads: [OTHER_USER_THREAD],
  });
  assert.strictEqual(result.status, 403);
  assert.ok(result.error?.includes("Access denied") || result.error?.includes("denied"));
});

test("DELETE thread returns 403 when thread belongs to different org", () => {
  const crossOrgThread: MockThread = {
    ...THREAD_1,
    org_id: OTHER_ORG_ID,
  };
  const result = simulateDeleteThread({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: crossOrgThread.id,
    dbThreads: [crossOrgThread],
  });
  assert.strictEqual(result.status, 403);
});

test("DELETE thread returns 200 with success when authorized", () => {
  const result = simulateDeleteThread({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("DELETE thread returns 500 when DB update fails", () => {
  const result = simulateDeleteThread({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
    deleteError: { message: "connection timeout" },
  });
  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("Failed to delete thread"));
});

// ── GET /threads/[threadId]/messages — auth tests ────────────────────────────

test("GET messages returns 401 when unauthenticated", () => {
  const result = simulateListMessages({
    auth: AuthPresets.unauthenticated,
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
  });
  assert.strictEqual(result.status, 401);
});

test("GET messages returns 403 when user is not an org admin", () => {
  const result = simulateListMessages({
    auth: AuthPresets.orgMember(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
  });
  assert.strictEqual(result.status, 403);
});

// ── GET /threads/[threadId]/messages — ownership tests ───────────────────────

test("GET messages returns 404 when thread does not exist", () => {
  const result = simulateListMessages({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: "nonexistent-thread-uuid",
    dbThreads: [THREAD_1],
  });
  assert.strictEqual(result.status, 404);
  assert.ok(result.error?.includes("not found") || result.error?.includes("Thread"));
});

test("GET messages returns 403 when thread belongs to different user", () => {
  const result = simulateListMessages({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: OTHER_USER_THREAD.id,
    dbThreads: [OTHER_USER_THREAD],
  });
  assert.strictEqual(result.status, 403);
});

// ── GET /threads/[threadId]/messages — success tests ─────────────────────────

test("GET messages returns 200 with ordered messages for thread owner", () => {
  const result = simulateListMessages({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
    dbMessages: [MESSAGE_2, MESSAGE_1], // out of order
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.messages?.length, 2);
  // Should be ordered ascending by created_at
  assert.strictEqual(result.messages?.[0].id, MESSAGE_1.id);
  assert.strictEqual(result.messages?.[1].id, MESSAGE_2.id);
});

test("GET messages returns empty list when thread has no messages", () => {
  const result = simulateListMessages({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
    dbMessages: [],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.messages?.length, 0);
});

test("GET messages returns only messages for the requested thread", () => {
  const thread2Message: MockMessage = {
    id: "msg-thread2",
    thread_id: THREAD_2.id,
    role: "user",
    content: "Different thread message",
    intent: null,
    status: "delivered",
    created_at: "2024-01-02T10:00:00Z",
  };
  const result = simulateListMessages({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1, THREAD_2],
    dbMessages: [MESSAGE_1, MESSAGE_2, thread2Message],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.messages?.length, 2);
  assert.ok(result.messages?.every((m) => m.thread_id === THREAD_1.id));
});

test("GET messages returns 500 when DB query fails", () => {
  const result = simulateListMessages({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [THREAD_1],
    dbError: { message: "connection timeout" },
  });
  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("Failed to list messages"));
});
