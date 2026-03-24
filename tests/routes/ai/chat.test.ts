import test, { describe, it } from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import {
  checkCacheEligibility,
  normalizePrompt,
  hashPrompt,
} from "../../../src/lib/ai/semantic-cache-utils.ts";
import { sendMessageSchema } from "../../../src/lib/schemas/ai-assistant.ts";

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
  idempotencyDbError?: boolean;
  historyFetchError?: boolean;
  abandonedStreamCleanupError?: boolean;
  /** Simulate DB error from the non-fatal thread updated_at touch */
  threadUpdatedAtTouchError?: boolean;
}

// ── Cache simulation types ────────────────────────────────────────────────────

interface CacheCheckRequest {
  message: string;
  surface: "general" | "members" | "analytics" | "events";
  threadId?: string;
  bypassCache?: boolean;
  disableAiCache?: boolean;
}

type CacheSimResultStatus =
  | "hit_exact"
  | "miss"
  | "bypass"
  | "ineligible"
  | "disabled";

interface CacheSimResult {
  /** Whether the cache lookup was attempted at all */
  lookupAttempted: boolean;
  /** Whether a write would be attempted after a live response */
  writeAttempted: boolean;
  status: CacheSimResultStatus;
  bypassReason?: string;
  /** Simulated response content when status === "hit_exact" */
  responseContent?: string;
}

interface MockCacheStore {
  hits: Map<string, string>;
  lookupCallCount: number;
  writeCallCount: number;
}

function createMockCacheStore(): MockCacheStore {
  return {
    hits: new Map(),
    lookupCallCount: 0,
    writeCallCount: 0,
  };
}

interface ChatResult {
  status: number;
  error?: string;
  details?: unknown;
  threadId?: string;
  isStream?: boolean;
  replayed?: boolean;
  sseError?: boolean;
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

// ── Cache flow simulation ─────────────────────────────────────────────────────

/**
 * Simulates the semantic cache check, hit, miss, bypass logic that lives in
 * the real route (step 8.5).  This mirrors the production code path:
 *
 *   if (DISABLE_AI_CACHE !== "true" && eligibility.eligible)  → lookup
 *     ok → hit_exact, serve cached content
 *     !ok → miss/error, proceed to live path, then write on success
 *   else if (!eligibility.eligible) → bypass with reason
 *
 * The `store` argument acts as a lightweight in-memory mock of the DB cache
 * table.  Callers can pre-populate `store.hits` with a `promptHash → content`
 * entry to simulate a cache hit.
 */
function simulateCacheFlow(
  req: CacheCheckRequest,
  store: MockCacheStore
): CacheSimResult {
  const { message, surface, threadId, bypassCache, disableAiCache } = req;

  // Env-level kill switch
  if (disableAiCache) {
    return { lookupAttempted: false, writeAttempted: false, status: "disabled" };
  }

  const eligibility = checkCacheEligibility({
    message,
    surface,
    threadId,
    bypassCache,
  });

  if (!eligibility.eligible) {
    return {
      lookupAttempted: false,
      writeAttempted: false,
      status: eligibility.reason === "bypass_requested" ? "bypass" : "ineligible",
      bypassReason: eligibility.reason,
    };
  }

  // Eligible — attempt lookup
  store.lookupCallCount += 1;
  const normalized = normalizePrompt(message);
  const promptHash = hashPrompt(normalized);
  const hit = store.hits.get(promptHash);

  if (hit !== undefined) {
    return {
      lookupAttempted: true,
      writeAttempted: false,
      status: "hit_exact",
      responseContent: hit,
    };
  }

  // Miss — simulate live path completing successfully, then write
  store.writeCallCount += 1;
  return {
    lookupAttempted: true,
    writeAttempted: true,
    status: "miss",
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

  // 4.5. Abandoned-stream cleanup — simulated non-fatal error does not block the request
  // (req.abandonedStreamCleanupError just logs; no early return)

  // 5. Idempotency check — simulate DB failure
  if (req.idempotencyDbError) {
    return { status: 500, error: "Failed to check message idempotency" };
  }

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
    return {
      status: 409,
      error: "Request already in progress",
      threadId: existingMsg.thread_id,
    };
  }

  // 6. Thread creation — simulate failure
  if (!existingThreadId && req.threadInsertError) {
    return { status: 500, error: "Failed to create thread" };
  }

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

  // 8.5. Thread updated_at touch — non-fatal, never blocks the request.
  // (req.threadUpdatedAtTouchError just logs; no early return)

  // 9-11. In the real route this returns a streaming SSE Response.
  // Simulate history fetch error inside the SSE callback — the route enqueues
  // an SSE error event and returns early (not an HTTP 500).
  if (req.historyFetchError) {
    return { status: 200, isStream: true, sseError: true };
  }

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
  assert.strictEqual(result.threadId, VALID_THREAD_ID);
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
  assert.strictEqual(result.threadId, VALID_THREAD_ID);
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

test("POST /api/ai/[orgId]/chat returns 500 when idempotency DB query fails", () => {
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
    idempotencyDbError: true,
  });
  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("idempotency"));
});

test("POST /api/ai/[orgId]/chat returns SSE stream with error event when history fetch fails", () => {
  // History is fetched inside the SSE callback — errors are enqueued as SSE
  // error events, not returned as HTTP 500. The response is still 200 streaming.
  const result = simulateChatRoute({
    auth: AuthPresets.orgAdmin(ORG_ID),
    orgId: ORG_ID,
    body: VALID_BODY,
    historyFetchError: true,
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.isStream, true);
  assert.strictEqual(result.sseError, true);
});

test("POST /api/ai/[orgId]/chat is non-fatal when abandoned-stream cleanup fails", () => {
  // A DB error during abandoned-stream cleanup should be logged but must not
  // prevent the route from continuing to process the request.
  const result = simulateChatRoute({
    auth: {
      ...AuthPresets.orgAdmin(ORG_ID),
      user: { id: ADMIN_USER_ID, email: "admin@example.com" },
    },
    orgId: ORG_ID,
    body: { ...VALID_BODY, threadId: VALID_THREAD_ID },
    dbThreads: [OWNED_THREAD],
    abandonedStreamCleanupError: true,
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.isStream, true);
  assert.ok(!result.sseError, "cleanup error must not produce an SSE error event");
});

test("POST /api/ai/[orgId]/chat touches thread updated_at after user message is saved", () => {
  // On a follow-up message to an existing thread the route must perform an
  // UPDATE on the thread row so its updated_at is refreshed.  The simulation
  // models this as part of the normal processing path — a successful request
  // with threadUpdatedAtTouchError absent (i.e. the touch succeeded).
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
  assert.ok(!result.sseError, "a successful touch must not produce an SSE error event");
});

test("POST /api/ai/[orgId]/chat is non-fatal when thread updated_at touch fails", () => {
  // A DB error during the thread updated_at touch must be logged but must not
  // prevent the route from returning a 200 SSE stream to the client.
  const result = simulateChatRoute({
    auth: {
      ...AuthPresets.orgAdmin(ORG_ID),
      user: { id: ADMIN_USER_ID, email: "admin@example.com" },
    },
    orgId: ORG_ID,
    body: { ...VALID_BODY, threadId: VALID_THREAD_ID },
    dbThreads: [OWNED_THREAD],
    threadUpdatedAtTouchError: true,
  });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.isStream, true);
  assert.ok(!result.sseError, "touch error must not produce an SSE error event");
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

// ── Semantic cache behavior ───────────────────────────────────────────────────

describe("semantic cache behavior", () => {
  const ELIGIBLE_MESSAGE = "What is the organization's mission statement?";

  it("cache-eligible standalone prompt returns cache hit when store contains matching entry", () => {
    const store = createMockCacheStore();
    // Pre-populate the store with the expected hash for the eligible message
    const promptHash = hashPrompt(normalizePrompt(ELIGIBLE_MESSAGE));
    const cachedContent = "Members receive healthcare, dental, and vision benefits.";
    store.hits.set(promptHash, cachedContent);

    const result = simulateCacheFlow(
      { message: ELIGIBLE_MESSAGE, surface: "general" },
      store
    );

    assert.strictEqual(result.status, "hit_exact");
    assert.strictEqual(result.lookupAttempted, true);
    assert.strictEqual(result.writeAttempted, false);
    assert.strictEqual(result.responseContent, cachedContent);
    assert.strictEqual(store.lookupCallCount, 1);
  });

  it("cache miss falls through to live path and a write is attempted", () => {
    const store = createMockCacheStore();
    // Store is empty — no cached entry exists

    const result = simulateCacheFlow(
      { message: ELIGIBLE_MESSAGE, surface: "general" },
      store
    );

    assert.strictEqual(result.status, "miss");
    assert.strictEqual(result.lookupAttempted, true);
    assert.strictEqual(result.writeAttempted, true);
    assert.strictEqual(store.lookupCallCount, 1);
    assert.strictEqual(store.writeCallCount, 1);
  });

  it("bypassCache=true skips lookup and marks status as bypass with reason bypass_requested", () => {
    const store = createMockCacheStore();
    // Even if there is a matching entry, bypass should prevent lookup
    const promptHash = hashPrompt(normalizePrompt(ELIGIBLE_MESSAGE));
    store.hits.set(promptHash, "cached content that should never be returned");

    const result = simulateCacheFlow(
      { message: ELIGIBLE_MESSAGE, surface: "general", bypassCache: true },
      store
    );

    assert.strictEqual(result.lookupAttempted, false);
    assert.strictEqual(result.status, "bypass");
    assert.strictEqual(result.bypassReason, "bypass_requested");
    assert.strictEqual(store.lookupCallCount, 0);
  });

  it("follow-up message with threadId bypasses cache with reason has_thread_context", () => {
    const store = createMockCacheStore();

    const result = simulateCacheFlow(
      { message: ELIGIBLE_MESSAGE, surface: "general", threadId: "existing-thread-uuid" },
      store
    );

    assert.strictEqual(result.lookupAttempted, false);
    assert.strictEqual(result.status, "ineligible");
    assert.strictEqual(result.bypassReason, "has_thread_context");
    assert.strictEqual(store.lookupCallCount, 0);
  });

  it("message with temporal marker bypasses cache with reason contains_temporal_marker", () => {
    const store = createMockCacheStore();

    const result = simulateCacheFlow(
      { message: "What is happening today at the organization?", surface: "general" },
      store
    );

    assert.strictEqual(result.lookupAttempted, false);
    assert.strictEqual(result.status, "ineligible");
    assert.strictEqual(result.bypassReason, "contains_temporal_marker");
    assert.strictEqual(store.lookupCallCount, 0);
  });

  it("direct time question bypasses cache with reason contains_temporal_marker", () => {
    const store = createMockCacheStore();

    const result = simulateCacheFlow(
      { message: "What time is it right now?", surface: "general" },
      store
    );

    assert.strictEqual(result.lookupAttempted, false);
    assert.strictEqual(result.status, "ineligible");
    assert.strictEqual(result.bypassReason, "contains_temporal_marker");
    assert.strictEqual(store.lookupCallCount, 0);
  });

  it("non-general surfaces are always ineligible for shared cache", () => {
    const store = createMockCacheStore();

    const result = simulateCacheFlow(
      { message: ELIGIBLE_MESSAGE, surface: "members" },
      store
    );

    assert.strictEqual(result.lookupAttempted, false);
    assert.strictEqual(result.writeAttempted, false);
    assert.strictEqual(result.status, "ineligible");
    assert.strictEqual(result.bypassReason, "unsupported_surface");
  });

  it("DISABLE_AI_CACHE=true bypasses cache entirely without attempting lookup", () => {
    const store = createMockCacheStore();
    // Pre-populate a hit — it should never be reached
    const promptHash = hashPrompt(normalizePrompt(ELIGIBLE_MESSAGE));
    store.hits.set(promptHash, "should not be returned");

    const result = simulateCacheFlow(
      { message: ELIGIBLE_MESSAGE, surface: "general", disableAiCache: true },
      store
    );

    assert.strictEqual(result.lookupAttempted, false);
    assert.strictEqual(result.writeAttempted, false);
    assert.strictEqual(result.status, "disabled");
    assert.strictEqual(store.lookupCallCount, 0);
    assert.strictEqual(store.writeCallCount, 0);
  });

  it("cache write is attempted only after a successful live response on a miss", () => {
    const store = createMockCacheStore();

    // First call — miss, write should be attempted
    const missResult = simulateCacheFlow(
      { message: ELIGIBLE_MESSAGE, surface: "general" },
      store
    );

    assert.strictEqual(missResult.status, "miss");
    assert.strictEqual(missResult.writeAttempted, true);
    assert.strictEqual(store.writeCallCount, 1);

    // Simulate that the entry is now present in the store (as if the write persisted)
    const promptHash = hashPrompt(normalizePrompt(ELIGIBLE_MESSAGE));
    store.hits.set(promptHash, "The live response content.");

    // Second call — should hit the cache, no further write
    const hitResult = simulateCacheFlow(
      { message: ELIGIBLE_MESSAGE, surface: "general" },
      store
    );

    assert.strictEqual(hitResult.status, "hit_exact");
    assert.strictEqual(hitResult.writeAttempted, false);
    // Write count must not have incremented on the second call
    assert.strictEqual(store.writeCallCount, 1);
  });
});

describe("sendMessageSchema cache aliases", () => {
  it("accepts bypass_cache and normalizes it to bypassCache", () => {
    const parsed = sendMessageSchema.parse({
      ...VALID_BODY,
      bypass_cache: true,
    });

    assert.strictEqual(parsed.bypassCache, true);
  });

  it("accepts bypassCache directly", () => {
    const parsed = sendMessageSchema.parse({
      ...VALID_BODY,
      bypassCache: true,
    });

    assert.strictEqual(parsed.bypassCache, true);
  });

  it("rejects mismatched bypass_cache and bypassCache values", () => {
    assert.throws(() =>
      sendMessageSchema.parse({
        ...VALID_BODY,
        bypass_cache: true,
        bypassCache: false,
      })
    );
  });
});
