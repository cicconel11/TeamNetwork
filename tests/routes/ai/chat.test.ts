import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";

/**
 * Tests for POST /api/ai/[orgId]/chat
 *
 * Simulation-style tests covering the auth/validation/idempotency pipeline:
 *
 * 1. Returns 401 when unauthenticated
 * 2. Returns 403 when not admin
 * 3. Returns 400 on invalid body
 * 4. Returns 409 on duplicate idempotency key (in-flight)
 * 5. Returns 200 with already_completed on duplicate idempotency key (completed)
 * 6. Returns SSE stream (Response with text/event-stream content type) for valid admin
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface MockMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string | null;
  status: "pending" | "streaming" | "complete" | "error";
  idempotency_key?: string;
}

interface MockThread {
  id: string;
  user_id: string;
  org_id: string;
  deleted_at?: string | null;
}

interface ChatRequest {
  auth: AuthContext;
  orgId: string;
  body?: unknown;
  existingMessages?: MockMessage[];
  dbThreads?: MockThread[];
  threadInsertError?: boolean;
  userMsgInsertError?: boolean;
  assistantMsgInsertError?: boolean;
}

interface ChatResult {
  status: number;
  error?: string;
  details?: unknown;
  threadId?: string;
  isStream?: boolean;
  replayed?: boolean;
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

// ── Validate sendMessageSchema inline ────────────────────────────────────────

interface SendMessageBody {
  message: string;
  surface: "general" | "members" | "analytics" | "events";
  threadId?: string;
  idempotencyKey: string;
}

function validateSendMessageBody(
  body: unknown
): { ok: true; data: SendMessageBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid input" };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.message !== "string" || b.message.trim() === "" || b.message.length > 4000) {
    return { ok: false, error: "Invalid input: message is required (max 4000 chars)" };
  }

  const validSurfaces = ["general", "members", "analytics", "events"];
  if (!validSurfaces.includes(b.surface as string)) {
    return { ok: false, error: "Invalid input: surface must be one of general, members, analytics, events" };
  }

  // UUID pattern check for idempotencyKey
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof b.idempotencyKey !== "string" || !uuidPattern.test(b.idempotencyKey)) {
    return { ok: false, error: "Invalid input: idempotencyKey must be a valid UUID" };
  }

  // Optional threadId UUID check
  if (b.threadId !== undefined) {
    if (typeof b.threadId !== "string" || !uuidPattern.test(b.threadId)) {
      return { ok: false, error: "Invalid input: threadId must be a valid UUID" };
    }
  }

  return {
    ok: true,
    data: {
      message: b.message,
      surface: b.surface as SendMessageBody["surface"],
      threadId: b.threadId as string | undefined,
      idempotencyKey: b.idempotencyKey as string,
    },
  };
}

// ── Main route simulation ─────────────────────────────────────────────────────

function simulateChatRoute(req: ChatRequest): ChatResult {
  // 1. Rate limit — always passes in tests (we don't simulate store state here)

  // 2. Auth
  const ctx = simulateAiOrgContext(req.auth, req.orgId);
  if (!ctx.ok) return { status: ctx.status, error: ctx.error };

  // 3. Validate body
  const validation = validateSendMessageBody(req.body);
  if (!validation.ok) return { status: 400, error: validation.error };

  const { message, surface, threadId: existingThreadId, idempotencyKey } = validation.data;

  if (existingThreadId) {
    const thread = (req.dbThreads ?? []).find(
      (candidate) => candidate.id === existingThreadId && !candidate.deleted_at
    );
    if (!thread || thread.user_id !== ctx.userId || thread.org_id !== req.orgId) {
      return { status: 404, error: "Thread not found" };
    }
  }

  // 5. Idempotency check
  const existingMsg = (req.existingMessages ?? []).find(
    (m) => m.idempotency_key === idempotencyKey
  );

  if (existingMsg) {
    if (existingMsg.status === "complete") {
      return {
        status: 200,
        threadId: existingMsg.thread_id,
        isStream: true,
        replayed: true,
      };
    }
    return { status: 409, error: "Request already in progress" };
  }

  // 6. Thread creation — simulate failure
  if (!existingThreadId && req.threadInsertError) {
    return { status: 500, error: "Failed to create thread" };
  }

  const resolvedThreadId = existingThreadId ?? "new-thread-uuid";

  // 7. User message insert — simulate failure
  if (req.userMsgInsertError) {
    return { status: 500, error: "Failed to save message" };
  }

  // 8. Assistant placeholder insert — simulate failure
  if (req.assistantMsgInsertError) {
    return { status: 500, error: "Failed to create response" };
  }

  // Validate that message/surface were parsed
  void message;
  void surface;

  // 9-11. In the real route this returns a streaming SSE Response.
  // We return a sentinel indicating a stream would be returned.
  return { status: 200, isStream: true };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = "org-uuid-1";
const OTHER_ORG_ID = "org-uuid-2";
const ADMIN_USER_ID = "org-admin-user";
const VALID_IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111";
const VALID_THREAD_ID = "22222222-2222-4222-8222-222222222222";

const VALID_BODY: SendMessageBody = {
  message: "What are the member stats?",
  surface: "general",
  idempotencyKey: VALID_IDEMPOTENCY_KEY,
};

const COMPLETED_MESSAGE: MockMessage = {
  id: "msg-completed-uuid",
  thread_id: VALID_THREAD_ID,
  role: "user",
  content: "What are the member stats?",
  status: "complete",
  idempotency_key: VALID_IDEMPOTENCY_KEY,
};

const IN_FLIGHT_MESSAGE: MockMessage = {
  id: "msg-inflight-uuid",
  thread_id: VALID_THREAD_ID,
  role: "assistant",
  content: null,
  status: "pending",
  idempotency_key: VALID_IDEMPOTENCY_KEY,
};

const OWNED_THREAD: MockThread = {
  id: VALID_THREAD_ID,
  user_id: ADMIN_USER_ID,
  org_id: ORG_ID,
  deleted_at: null,
};

// ── Auth tests ────────────────────────────────────────────────────────────────

test("POST /api/ai/[orgId]/chat returns 401 when unauthenticated", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.unauthenticated,
    orgId: ORG_ID,
    body: VALID_BODY,
  });
  assert.strictEqual(result.status, 401);
  assert.ok(result.error?.includes("Unauthorized"));
});

test("POST /api/ai/[orgId]/chat returns 403 when user is an active_member (not admin)", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgMember(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
  });
  assert.strictEqual(result.status, 403);
  assert.ok(result.error?.includes("admin"));
});

test("POST /api/ai/[orgId]/chat returns 403 when user is an alumni (not admin)", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAlumni(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
  });
  assert.strictEqual(result.status, 403);
});

test("POST /api/ai/[orgId]/chat returns 403 when admin of a different org", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(OTHER_ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
  });
  assert.strictEqual(result.status, 403);
});

// ── Validation tests ──────────────────────────────────────────────────────────

test("POST /api/ai/[orgId]/chat returns 400 when body is missing message", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: { surface: "general", idempotencyKey: VALID_IDEMPOTENCY_KEY },
  });
  assert.strictEqual(result.status, 400);
});

test("POST /api/ai/[orgId]/chat returns 400 when surface is invalid", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: { message: "Hello", surface: "invalid-surface", idempotencyKey: VALID_IDEMPOTENCY_KEY },
  });
  assert.strictEqual(result.status, 400);
});

test("POST /api/ai/[orgId]/chat returns 400 when idempotencyKey is missing", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: { message: "Hello", surface: "general" },
  });
  assert.strictEqual(result.status, 400);
});

test("POST /api/ai/[orgId]/chat returns 400 when idempotencyKey is not a UUID", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: { message: "Hello", surface: "general", idempotencyKey: "not-a-uuid" },
  });
  assert.strictEqual(result.status, 400);
});

test("POST /api/ai/[orgId]/chat returns 400 when message is empty", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: { message: "", surface: "general", idempotencyKey: VALID_IDEMPOTENCY_KEY },
  });
  assert.strictEqual(result.status, 400);
});

test("POST /api/ai/[orgId]/chat returns 400 when message exceeds 4000 chars", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: {
      message: "x".repeat(4001),
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    },
  });
  assert.strictEqual(result.status, 400);
});

test("POST /api/ai/[orgId]/chat returns 400 when body is not an object", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: "invalid-body",
  });
  assert.strictEqual(result.status, 400);
});

// ── Idempotency tests ─────────────────────────────────────────────────────────

test("POST /api/ai/[orgId]/chat returns 409 on duplicate idempotency key (in-flight)", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
    existingMessages: [IN_FLIGHT_MESSAGE],
  });
  assert.strictEqual(result.status, 409);
  assert.ok(result.error?.includes("in progress") || result.error?.includes("already"));
});

test("POST /api/ai/[orgId]/chat returns 409 for streaming status duplicate", () => {
  const streamingMsg: MockMessage = { ...IN_FLIGHT_MESSAGE, status: "streaming" };
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
    existingMessages: [streamingMsg],
  });
  assert.strictEqual(result.status, 409);
});

test("POST /api/ai/[orgId]/chat returns 200 with already_completed on completed duplicate", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
    existingMessages: [COMPLETED_MESSAGE],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.isStream, true);
  assert.strictEqual(result.replayed, true);
  assert.strictEqual(result.threadId, VALID_THREAD_ID);
});

// ── Error path tests ──────────────────────────────────────────────────────────

test("POST /api/ai/[orgId]/chat returns 500 when thread creation fails", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
    threadInsertError: true,
  });
  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("thread"));
});

test("POST /api/ai/[orgId]/chat returns 500 when user message insert fails", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
    userMsgInsertError: true,
  });
  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("message") || result.error?.includes("save"));
});

test("POST /api/ai/[orgId]/chat returns 500 when assistant placeholder insert fails", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
    assistantMsgInsertError: true,
  });
  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("response") || result.error?.includes("assistant"));
});

// ── Success / SSE stream test ─────────────────────────────────────────────────

test("POST /api/ai/[orgId]/chat returns SSE stream for valid admin request", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.isStream, true);
});

test("POST /api/ai/[orgId]/chat accepts all valid surface values", () => {
  const surfaces = ["general", "members", "analytics", "events"] as const;
  for (const surface of surfaces) {
    const result = simulateChatRoute({
      auth: AuthPresets.orgAdmin(ORG_ID),
      orgId: ORG_ID,
      body: { ...VALID_BODY, surface },
    });
    assert.strictEqual(
      result.status,
      200,
      `Expected 200 for surface "${surface}", got ${result.status}: ${result.error}`
    );
    assert.strictEqual(result.isStream, true);
  }
});

test("POST /api/ai/[orgId]/chat accepts optional threadId when valid UUID", () => {
  const result = simulateChatRoute({
    auth: {
      ...AuthPresets.orgAdmin(ORG_ID),
      user: { id: ADMIN_USER_ID, email: "admin@example.com" },
    },
    orgId: ORG_ID,
    body: { ...VALID_BODY, threadId: VALID_THREAD_ID },
    dbThreads: [OWNED_THREAD],
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.isStream, true);
});

test("POST /api/ai/[orgId]/chat returns 404 when provided thread belongs to another user", () => {
  const result = simulateChatRoute({
    auth: {
      ...AuthPresets.orgAdmin(ORG_ID),
      user: { id: ADMIN_USER_ID, email: "admin@example.com" },
    },
    orgId: ORG_ID,
    body: { ...VALID_BODY, threadId: VALID_THREAD_ID },
    dbThreads: [{ ...OWNED_THREAD, user_id: "other-user" }],
  });
  assert.strictEqual(result.status, 404);
});

test("POST /api/ai/[orgId]/chat returns 404 when provided thread is soft-deleted", () => {
  const result = simulateChatRoute({
    auth: {
      ...AuthPresets.orgAdmin(ORG_ID),
      user: { id: ADMIN_USER_ID, email: "admin@example.com" },
    },
    orgId: ORG_ID,
    body: { ...VALID_BODY, threadId: VALID_THREAD_ID },
    dbThreads: [{ ...OWNED_THREAD, deleted_at: "2026-03-20T12:00:00.000Z" }],
  });
  assert.strictEqual(result.status, 404);
});

test("POST /api/ai/[orgId]/chat returns 400 when threadId is provided but not a UUID", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: { ...VALID_BODY, threadId: "not-a-uuid" },
  });
  assert.strictEqual(result.status, 400);
});

// ── SSE_HEADERS contract (unit test) ─────────────────────────────────────────

test("SSE_HEADERS constant has correct Content-Type for event-stream", async () => {
  const { SSE_HEADERS } = await import("../../../src/lib/ai/sse.ts");
  assert.strictEqual(SSE_HEADERS["Content-Type"], "text/event-stream");
  assert.ok("Cache-Control" in SSE_HEADERS);
  assert.ok("Connection" in SSE_HEADERS);
});
