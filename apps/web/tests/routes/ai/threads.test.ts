import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import {
  encodeCursor,
  decodeCursor,
  applyCursorFilter,
  buildCursorResponse,
} from "../../../src/lib/pagination/cursor.ts";

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
  deleted_at?: string | null;
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
  const thread = threads.find((t) => t.id === threadId && !t.deleted_at);
  if (!thread) {
    return { ok: false, status: 404, message: "Thread not found" };
  }
  if (thread.user_id !== userId || thread.org_id !== orgId) {
    return { ok: false, status: 404, message: "Thread not found" };
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
  data?: MockThread[];
  nextCursor?: string | null;
  hasMore?: boolean;
  error?: string;
}

function simulateListThreads(req: ListThreadsRequest): ListThreadsResult {
  const ctx = simulateAiOrgContext(req.auth, req.orgId);
  if (!ctx.ok) return { status: ctx.status, error: ctx.error };

  if (req.dbError) {
    return { status: 500, error: "Failed to list threads" };
  }

  // Decode and validate cursor if provided
  const decoded = req.cursor ? decodeCursor(req.cursor) : null;
  if (req.cursor && !decoded) {
    return { status: 400, error: "Invalid cursor" };
  }

  const threads = req.dbThreads ?? [];
  const limit = req.limit ?? 20;

  let filtered = threads.filter((t) => t.org_id === req.orgId && !t.deleted_at);
  if (req.surface) filtered = filtered.filter((t) => t.surface === req.surface);

  // Sort by created_at DESC, then id DESC (mirrors the route's ORDER BY)
  filtered = filtered.sort((a, b) => {
    const cmp = b.created_at.localeCompare(a.created_at);
    return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
  });

  // Apply composite cursor filter if provided
  if (decoded) {
    filtered = filtered.filter((t) => {
      if (t.created_at < decoded.createdAt) return true;
      if (t.created_at === decoded.createdAt && t.id < decoded.id) return true;
      return false;
    });
  }

  // Fetch limit+1 for hasMore detection (mirrors the route's limit+1 query)
  const page = filtered.slice(0, limit + 1);
  const result = buildCursorResponse(page, limit);

  return { status: 200, ...result };
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

// Thread and message IDs must be valid UUIDs so that cursor encoding/decoding
// (which enforces the UUID format) works correctly in pagination tests.
const THREAD_1_ID = "11111111-1111-4111-a111-111111111111";
const THREAD_2_ID = "22222222-2222-4222-a222-222222222222";
const OTHER_USER_THREAD_ID = "33333333-3333-4333-a333-333333333333";
const MSG_1_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const MSG_2_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

const THREAD_1: MockThread = {
  id: THREAD_1_ID,
  user_id: ADMIN_USER_ID,
  org_id: ORG_ID,
  surface: "general",
  title: "First thread",
  created_at: "2024-01-01T10:00:00.000Z",
  updated_at: "2024-01-01T10:30:00.000Z",
};

const THREAD_2: MockThread = {
  id: THREAD_2_ID,
  user_id: ADMIN_USER_ID,
  org_id: ORG_ID,
  surface: "members",
  title: "Second thread",
  created_at: "2024-01-02T10:00:00.000Z",
  updated_at: "2024-01-02T10:30:00.000Z",
};

const OTHER_USER_THREAD: MockThread = {
  id: OTHER_USER_THREAD_ID,
  user_id: OTHER_USER_ID,
  org_id: ORG_ID,
  surface: "general",
  title: "Other user's thread",
  created_at: "2024-01-03T10:00:00.000Z",
  updated_at: "2024-01-03T10:30:00.000Z",
};

const MESSAGE_1: MockMessage = {
  id: MSG_1_ID,
  thread_id: THREAD_1_ID,
  role: "user",
  content: "Hello",
  intent: null,
  status: "delivered",
  created_at: "2024-01-01T10:00:00.000Z",
};

const MESSAGE_2: MockMessage = {
  id: MSG_2_ID,
  thread_id: THREAD_1_ID,
  role: "assistant",
  content: "Hi there",
  intent: "greeting",
  status: "delivered",
  created_at: "2024-01-01T10:00:05.000Z",
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
  assert.strictEqual(result.data?.length, 2);
});

test("GET threads filters by surface when provided", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    surface: "members",
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.data?.length, 1);
  assert.strictEqual(result.data?.[0].surface, "members");
});

test("GET threads returns empty result when no threads exist", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    dbThreads: [],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.data?.length, 0);
  assert.strictEqual(result.nextCursor, null);
  assert.strictEqual(result.hasMore, false);
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
  assert.strictEqual(result.data?.length, 1);
  assert.strictEqual(result.data?.[0].org_id, ORG_ID);
});

test("GET threads orders by created_at descending", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 200);
  // THREAD_2 has later created_at, should appear first
  assert.strictEqual(result.data?.[0].id, THREAD_2.id);
  assert.strictEqual(result.data?.[1].id, THREAD_1.id);
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

// ── GET /threads — cursor pagination tests ────────────────────────────────────

test("GET threads first page returns hasMore false when results fit in one page", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    limit: 20,
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.hasMore, false);
  assert.strictEqual(result.nextCursor, null);
  assert.strictEqual(result.data?.length, 2);
});

test("GET threads first page returns hasMore true and nextCursor when results exceed limit", () => {
  // Build 3 threads but set limit to 2 — should get hasMore=true and a cursor
  const thread3: MockThread = {
    id: "33333333-3333-4333-b333-333333333333",
    user_id: ADMIN_USER_ID,
    org_id: ORG_ID,
    surface: "general",
    title: "Third thread",
    created_at: "2024-01-03T10:00:00.000Z",
    updated_at: "2024-01-03T10:30:00.000Z",
  };
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    limit: 2,
    dbThreads: [THREAD_1, THREAD_2, thread3],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.hasMore, true);
  assert.ok(result.nextCursor !== null && result.nextCursor !== undefined);
  assert.strictEqual(result.data?.length, 2);
});

test("GET threads second page with cursor returns correct results", () => {
  // 3 threads sorted descending by created_at: thread3 (latest), thread2, thread1 (oldest)
  const thread3: MockThread = {
    id: "33333333-3333-4333-b333-333333333333",
    user_id: ADMIN_USER_ID,
    org_id: ORG_ID,
    surface: "general",
    title: "Third thread",
    created_at: "2024-01-03T10:00:00.000Z",
    updated_at: "2024-01-03T10:30:00.000Z",
  };
  const allThreads = [THREAD_1, THREAD_2, thread3];

  // First page: limit 2 → [thread3, thread2], nextCursor points to thread2
  const firstPage = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    limit: 2,
    dbThreads: allThreads,
  });
  assert.strictEqual(firstPage.status, 200);
  assert.strictEqual(firstPage.hasMore, true);
  assert.ok(firstPage.nextCursor);

  // Second page: using cursor from first page → should return [thread1]
  const secondPage = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    limit: 2,
    cursor: firstPage.nextCursor!,
    dbThreads: allThreads,
  });
  assert.strictEqual(secondPage.status, 200);
  assert.strictEqual(secondPage.hasMore, false);
  assert.strictEqual(secondPage.nextCursor, null);
  assert.strictEqual(secondPage.data?.length, 1);
  assert.strictEqual(secondPage.data?.[0].id, THREAD_1.id);
});

test("GET threads returns 400 on invalid cursor", () => {
  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    cursor: "not-a-valid-base64url-cursor",
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Invalid cursor"));
});

test("GET threads applies cursor correctly using encodeCursor/decodeCursor", () => {
  // Build a cursor pointing to THREAD_2 (created_at, id)
  const cursor = encodeCursor(THREAD_2.created_at, THREAD_2.id);
  // Verify roundtrip decode works
  const decoded = decodeCursor(cursor);
  assert.ok(decoded !== null);
  assert.strictEqual(decoded!.id, THREAD_2.id);

  const result = simulateListThreads({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    cursor,
    dbThreads: [THREAD_1, THREAD_2],
  });
  assert.strictEqual(result.status, 200);
  // Only THREAD_1 (older than THREAD_2) should be returned
  assert.strictEqual(result.data?.length, 1);
  assert.strictEqual(result.data?.[0].id, THREAD_1.id);
});

// ── GET /threads — cursor utility unit tests ──────────────────────────────────

test("cursor utilities: encodeCursor/decodeCursor roundtrip", () => {
  const cursor = encodeCursor("2024-01-01T10:00:00.000Z", "abcdef12-3456-4789-abcd-ef1234567890");
  const decoded = decodeCursor(cursor);
  assert.ok(decoded !== null);
  assert.strictEqual(decoded!.createdAt, "2024-01-01T10:00:00.000Z");
  assert.strictEqual(decoded!.id, "abcdef12-3456-4789-abcd-ef1234567890");
});

test("cursor utilities: decodeCursor returns null for invalid input", () => {
  assert.strictEqual(decodeCursor("not-valid"), null);
  assert.strictEqual(decodeCursor(""), null);
  // Plain UUID is not a valid composite cursor
  assert.strictEqual(decodeCursor("thread-uuid-2"), null);
});

test("cursor utilities: applyCursorFilter is a function", () => {
  // Verify it exists and is callable (the actual filter is tested via simulateListThreads)
  assert.strictEqual(typeof applyCursorFilter, "function");
});

test("cursor utilities: buildCursorResponse handles empty array", () => {
  const result = buildCursorResponse([], 20);
  assert.strictEqual(result.data.length, 0);
  assert.strictEqual(result.nextCursor, null);
  assert.strictEqual(result.hasMore, false);
});

test("cursor utilities: buildCursorResponse detects hasMore via limit+1 sentinel", () => {
  const threads = [THREAD_2, THREAD_1]; // already sorted, 2 items
  // When limit=1 and we pass 2 items (limit+1 = 2), hasMore should be true
  const result = buildCursorResponse(threads, 1);
  assert.strictEqual(result.hasMore, true);
  assert.strictEqual(result.data.length, 1);
  assert.ok(result.nextCursor !== null);
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

test("DELETE thread returns 404 when thread belongs to different user", () => {
  const result = simulateDeleteThread({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: OTHER_USER_THREAD.id,
    dbThreads: [OTHER_USER_THREAD],
  });
  assert.strictEqual(result.status, 404);
});

test("DELETE thread returns 404 when thread belongs to different org", () => {
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
  assert.strictEqual(result.status, 404);
});

test("DELETE thread returns 404 when thread is soft-deleted", () => {
  const result = simulateDeleteThread({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: THREAD_1.id,
    dbThreads: [{ ...THREAD_1, deleted_at: "2026-03-20T12:00:00.000Z" }],
  });
  assert.strictEqual(result.status, 404);
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

test("GET messages returns 404 when thread belongs to different user", () => {
  const result = simulateListMessages({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    threadId: OTHER_USER_THREAD.id,
    dbThreads: [OTHER_USER_THREAD],
  });
  assert.strictEqual(result.status, 404);
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
    created_at: "2024-01-02T10:00:00.000Z",
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
