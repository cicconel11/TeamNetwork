import test, { describe } from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
  createAuthContext,
  isAuthenticated,
  hasOrgMembership,
  isOrgAdmin,
  getOrgRole,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

// ============================================================================
// Convenience Auth Contexts (wrapping real AuthPresets)
// ============================================================================

const ORG_ID = "00000000-0000-0000-0000-000000000001";

// Authenticated member of ORG_ID (user id: "member-user")
const memberAuth = AuthPresets.orgMember(ORG_ID);
// Authenticated admin of ORG_ID (user id: "admin-user")
const adminAuth = AuthPresets.orgAdmin(ORG_ID);
// Authenticated user with NO org memberships
const nonMemberAuth = AuthPresets.authenticatedNoOrg;
// Alumni member of ORG_ID
const alumniAuth = AuthPresets.orgAlumni(ORG_ID);

// ============================================================================
// Types
// ============================================================================

interface ListThreadsRequest {
  auth: AuthContext;
  orgId?: string;
}

interface CreateThreadRequest {
  auth: AuthContext;
  body: {
    orgId?: string;
    title?: string;
    body?: string;
  };
}

interface GetThreadRequest {
  auth: AuthContext;
  threadId: string;
}

interface UpdateThreadRequest {
  auth: AuthContext;
  threadId: string;
  body: {
    title?: string;
    body?: string;
    is_pinned?: boolean;
    is_locked?: boolean;
  };
}

interface DeleteThreadRequest {
  auth: AuthContext;
  threadId: string;
}

interface CreateReplyRequest {
  auth: AuthContext;
  threadId: string;
  body: {
    body?: string;
  };
}

interface SimulationResult {
  status: number;
  error?: string;
  data?: any;
}

interface SimulationContext {
  supabase: ReturnType<typeof createSupabaseStub>;
}

// ============================================================================
// Validation Helpers
// ============================================================================

function isValidUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function validateThreadTitle(title: string): boolean {
  return title.length >= 5 && title.length <= 200;
}

function validateThreadBody(body: string): boolean {
  return body.length >= 10 && body.length <= 10000;
}

function validateReplyBody(body: string): boolean {
  return body.length >= 1 && body.length <= 5000;
}

// ============================================================================
// Simulation Functions
// ============================================================================

function simulateListThreads(
  request: ListThreadsRequest,
  ctx: SimulationContext
): SimulationResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // orgId required
  if (!request.orgId) {
    return { status: 400, error: "Organization ID is required" };
  }

  // Validate UUID format
  if (!isValidUUID(request.orgId)) {
    return { status: 400, error: "Invalid organization ID format" };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  // Fetch threads
  const threads = ctx.supabase
    .getRows("discussion_threads")
    .filter(
      (t: any) =>
        t.organization_id === request.orgId && t.deleted_at === null
    )
    .sort((a: any, b: any) => {
      // Sort by is_pinned DESC, then last_activity_at DESC
      if (a.is_pinned !== b.is_pinned) {
        return b.is_pinned ? 1 : -1;
      }
      return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime();
    });

  return { status: 200, data: threads };
}

function simulateCreateThread(
  request: CreateThreadRequest,
  ctx: SimulationContext
): SimulationResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const { orgId, title, body } = request.body;

  // Validation
  if (!orgId || !title || !body) {
    return { status: 400, error: "Missing required fields: orgId, title, body" };
  }

  if (!isValidUUID(orgId)) {
    return { status: 400, error: "Invalid organization ID format" };
  }

  if (!validateThreadTitle(title)) {
    return { status: 400, error: "Title must be between 5 and 200 characters" };
  }

  if (!validateThreadBody(body)) {
    return { status: 400, error: "Body must be between 10 and 10000 characters" };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, orgId)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  // Create thread
  const thread = {
    id: `thread-${Date.now()}`,
    organization_id: orgId,
    author_id: request.auth.user?.id || "",
    title,
    body,
    is_pinned: false,
    is_locked: false,
    view_count: 0,
    reply_count: 0,
    last_activity_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  ctx.supabase.seed("discussion_threads", [thread]);

  return { status: 201, data: thread };
}

function simulateGetThread(
  request: GetThreadRequest,
  ctx: SimulationContext
): SimulationResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Fetch thread
  const thread = ctx.supabase
    .getRows("discussion_threads")
    .find(
      (t: any) => t.id === request.threadId && t.deleted_at === null
    );

  if (!thread) {
    return { status: 404, error: "Thread not found" };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, thread.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  // Fetch replies
  const replies = ctx.supabase
    .getRows("discussion_replies")
    .filter(
      (r: any) =>
        r.thread_id === request.threadId && r.deleted_at === null
    )
    .sort((a: any, b: any) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  return { status: 200, data: { thread, replies } };
}

function simulateUpdateThread(
  request: UpdateThreadRequest,
  ctx: SimulationContext
): SimulationResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const { title, body, is_pinned, is_locked } = request.body;

  // Validate if title provided
  if (title !== undefined && !validateThreadTitle(title)) {
    return { status: 400, error: "Title must be between 5 and 200 characters" };
  }

  // Validate if body provided
  if (body !== undefined && !validateThreadBody(body)) {
    return { status: 400, error: "Body must be between 10 and 10000 characters" };
  }

  // Fetch thread
  const threads = ctx.supabase.getRows("discussion_threads");
  const thread = threads.find(
    (t: any) => t.id === request.threadId && t.deleted_at === null
  );

  if (!thread) {
    return { status: 404, error: "Thread not found" };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, thread.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  const userId = request.auth.user?.id || "";
  const isAdmin = isOrgAdmin(request.auth, thread.organization_id);
  const isAuthor = thread.author_id === userId;

  // Title/body edits: only author or admin
  if ((title !== undefined || body !== undefined) && !isAuthor && !isAdmin) {
    return {
      status: 403,
      error: "Forbidden: Only the author or an admin can edit this thread",
    };
  }

  // Pin/lock: only admin
  if ((is_pinned !== undefined || is_locked !== undefined) && !isAdmin) {
    return {
      status: 403,
      error: "Forbidden: Only admins can pin or lock threads",
    };
  }

  // Update thread
  const updatedThread = {
    ...thread,
    ...(title !== undefined && { title }),
    ...(body !== undefined && { body }),
    ...(is_pinned !== undefined && { is_pinned }),
    ...(is_locked !== undefined && { is_locked }),
    updated_at: new Date().toISOString(),
  };

  // Update in stub
  const index = threads.findIndex((t: any) => t.id === request.threadId);
  threads[index] = updatedThread;

  return { status: 200, data: updatedThread };
}

function simulateDeleteThread(
  request: DeleteThreadRequest,
  ctx: SimulationContext
): SimulationResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Fetch thread
  const threads = ctx.supabase.getRows("discussion_threads");
  const thread = threads.find(
    (t: any) => t.id === request.threadId && t.deleted_at === null
  );

  if (!thread) {
    return { status: 404, error: "Thread not found" };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, thread.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  const userId = request.auth.user?.id || "";
  const isAdmin = isOrgAdmin(request.auth, thread.organization_id);
  const isAuthor = thread.author_id === userId;

  // Only author or admin can delete
  if (!isAuthor && !isAdmin) {
    return {
      status: 403,
      error: "Forbidden: Only the author or an admin can delete this thread",
    };
  }

  // Soft delete - use the stub's update method (maybeSingle triggers execution)
  ctx.supabase
    .from("discussion_threads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", request.threadId)
    .maybeSingle();

  return { status: 200, data: { success: true } };
}

function simulateCreateReply(
  request: CreateReplyRequest,
  ctx: SimulationContext
): SimulationResult {
  // Auth check
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const { body } = request.body;

  // Validation
  if (body === undefined || body === null) {
    return { status: 400, error: "Reply body is required" };
  }

  if (!validateReplyBody(body)) {
    return { status: 400, error: "Body must be between 1 and 5000 characters" };
  }

  // Fetch thread
  const thread = ctx.supabase
    .getRows("discussion_threads")
    .find(
      (t: any) => t.id === request.threadId && t.deleted_at === null
    );

  if (!thread) {
    return { status: 404, error: "Thread not found" };
  }

  // Check if thread is locked
  if (thread.is_locked) {
    return { status: 403, error: "Thread is locked" };
  }

  // Check org membership
  if (!hasOrgMembership(request.auth, thread.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  // Create reply
  const reply = {
    id: `reply-${Date.now()}`,
    thread_id: request.threadId,
    organization_id: thread.organization_id,
    author_id: request.auth.user?.id || "",
    body,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  ctx.supabase.seed("discussion_replies", [reply]);

  // Update thread reply count and last activity via stub (maybeSingle triggers execution)
  const currentThread = ctx.supabase.getRows("discussion_threads").find(
    (t: any) => t.id === request.threadId
  );
  ctx.supabase
    .from("discussion_threads")
    .update({
      reply_count: (currentThread?.reply_count || 0) + 1,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", request.threadId)
    .maybeSingle();

  return { status: 201, data: reply };
}

// ============================================================================
// Tests: GET /api/discussions (List threads)
// ============================================================================

describe("GET /api/discussions (List threads)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateListThreads(
      { auth: AuthPresets.unauthenticated, orgId: "org-1" },
      ctx
    );
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.error, "Unauthorized");
  });

  test("returns 400 when orgId is missing", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateListThreads(
      { auth: memberAuth },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Organization ID is required");
  });

  test("returns 400 when orgId is not a valid UUID", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateListThreads(
      { auth: memberAuth, orgId: "invalid-uuid" },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Invalid organization ID format");
  });

  test("returns 403 when user is not a member of the organization", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";
    const result = simulateListThreads(
      { auth: nonMemberAuth, orgId },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Not a member of this organization");
  });

  test("returns threads for valid member request", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "First Thread",
        body: "This is the first thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
      {
        id: "thread-2",
        organization_id: orgId,
        author_id: "user-2",
        title: "Second Thread",
        body: "This is the second thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-16T10:00:00Z",
        created_at: "2025-01-16T10:00:00Z",
        updated_at: "2025-01-16T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateListThreads(
      { auth: memberAuth, orgId },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.length, 2);
  });

  test("excludes soft-deleted threads", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Active Thread",
        body: "This thread is active",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
      {
        id: "thread-2",
        organization_id: orgId,
        author_id: "user-2",
        title: "Deleted Thread",
        body: "This thread is deleted",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-16T10:00:00Z",
        created_at: "2025-01-16T10:00:00Z",
        updated_at: "2025-01-16T10:00:00Z",
        deleted_at: "2025-01-17T10:00:00Z",
      },
    ]);

    const result = simulateListThreads(
      { auth: memberAuth, orgId },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.length, 1);
    assert.strictEqual(result.data[0].id, "thread-1");
  });

  test("sorts threads by pinned status then last activity", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Old Thread",
        body: "Old unpinned thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-10T10:00:00Z",
        created_at: "2025-01-10T10:00:00Z",
        updated_at: "2025-01-10T10:00:00Z",
        deleted_at: null,
      },
      {
        id: "thread-2",
        organization_id: orgId,
        author_id: "user-2",
        title: "Recent Thread",
        body: "Recent unpinned thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-16T10:00:00Z",
        created_at: "2025-01-16T10:00:00Z",
        updated_at: "2025-01-16T10:00:00Z",
        deleted_at: null,
      },
      {
        id: "thread-3",
        organization_id: orgId,
        author_id: "user-3",
        title: "Pinned Thread",
        body: "Pinned thread",
        is_pinned: true,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-05T10:00:00Z",
        created_at: "2025-01-05T10:00:00Z",
        updated_at: "2025-01-05T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateListThreads(
      { auth: memberAuth, orgId },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.length, 3);
    // Pinned thread first
    assert.strictEqual(result.data[0].id, "thread-3");
    // Then most recent activity
    assert.strictEqual(result.data[1].id, "thread-2");
    assert.strictEqual(result.data[2].id, "thread-1");
  });

  test("filters threads by organization", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId1 = "00000000-0000-0000-0000-000000000001";
    const orgId2 = "00000000-0000-0000-0000-000000000002";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId1,
        author_id: "user-1",
        title: "Org 1 Thread",
        body: "Thread for org 1",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
      {
        id: "thread-2",
        organization_id: orgId2,
        author_id: "user-2",
        title: "Org 2 Thread",
        body: "Thread for org 2",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-16T10:00:00Z",
        created_at: "2025-01-16T10:00:00Z",
        updated_at: "2025-01-16T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateListThreads(
      { auth: memberAuth, orgId: orgId1 },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.length, 1);
    assert.strictEqual(result.data[0].organization_id, orgId1);
  });
});

// ============================================================================
// Tests: POST /api/discussions (Create thread)
// ============================================================================

describe("POST /api/discussions (Create thread)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: AuthPresets.unauthenticated,
        body: {
          orgId: "00000000-0000-0000-0000-000000000001",
          title: "Test Thread",
          body: "This is a test thread body",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.error, "Unauthorized");
  });

  test("returns 400 when orgId is missing", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          title: "Test Thread",
          body: "This is a test thread body",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Missing required fields: orgId, title, body");
  });

  test("returns 400 when title is missing", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          orgId: "00000000-0000-0000-0000-000000000001",
          body: "This is a test thread body",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Missing required fields: orgId, title, body");
  });

  test("returns 400 when body is missing", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          orgId: "00000000-0000-0000-0000-000000000001",
          title: "Test Thread",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Missing required fields: orgId, title, body");
  });

  test("returns 400 when orgId is not a valid UUID", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          orgId: "invalid-uuid",
          title: "Test Thread",
          body: "This is a test thread body",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Invalid organization ID format");
  });

  test("returns 400 when title is too short", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          orgId: "00000000-0000-0000-0000-000000000001",
          title: "Test",
          body: "This is a test thread body",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Title must be between 5 and 200 characters");
  });

  test("returns 400 when title is too long", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          orgId: "00000000-0000-0000-0000-000000000001",
          title: "A".repeat(201),
          body: "This is a test thread body",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Title must be between 5 and 200 characters");
  });

  test("returns 400 when body is too short", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          orgId: "00000000-0000-0000-0000-000000000001",
          title: "Test Thread",
          body: "Short",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Body must be between 10 and 10000 characters");
  });

  test("returns 400 when body is too long", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          orgId: "00000000-0000-0000-0000-000000000001",
          title: "Test Thread",
          body: "A".repeat(10001),
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Body must be between 10 and 10000 characters");
  });

  test("returns 403 when user is not a member of the organization", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateThread(
      {
        auth: nonMemberAuth,
        body: {
          orgId: "00000000-0000-0000-0000-000000000001",
          title: "Test Thread",
          body: "This is a test thread body",
        },
      },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Not a member of this organization");
  });

  test("creates thread successfully for valid member", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";
    const result = simulateCreateThread(
      {
        auth: memberAuth,
        body: {
          orgId,
          title: "Test Thread",
          body: "This is a test thread body with enough characters",
        },
      },
      ctx
    );

    assert.strictEqual(result.status, 201);
    assert.ok(result.data);
    assert.strictEqual(result.data.organization_id, orgId);
    assert.strictEqual(result.data.title, "Test Thread");
    assert.strictEqual(result.data.body, "This is a test thread body with enough characters");
    assert.strictEqual(result.data.is_pinned, false);
    assert.strictEqual(result.data.is_locked, false);
    assert.strictEqual(result.data.deleted_at, null);

    // Verify it was added to the stub
    const threads = ctx.supabase.getRows("discussion_threads");
    assert.strictEqual(threads.length, 1);
  });
});

// ============================================================================
// Tests: GET /api/discussions/[threadId] (Thread detail)
// ============================================================================

describe("GET /api/discussions/[threadId] (Thread detail)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateGetThread(
      { auth: AuthPresets.unauthenticated, threadId: "thread-1" },
      ctx
    );
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.error, "Unauthorized");
  });

  test("returns 404 when thread does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateGetThread(
      { auth: memberAuth, threadId: "nonexistent" },
      ctx
    );
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.error, "Thread not found");
  });

  test("returns 404 when thread is soft-deleted", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Deleted Thread",
        body: "This thread is deleted",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: "2025-01-16T10:00:00Z",
      },
    ]);

    const result = simulateGetThread(
      { auth: memberAuth, threadId: "thread-1" },
      ctx
    );
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.error, "Thread not found");
  });

  test("returns 403 when user is not a member of the organization", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateGetThread(
      { auth: nonMemberAuth, threadId: "thread-1" },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Not a member of this organization");
  });

  test("returns thread with replies for valid member", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 2,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    ctx.supabase.seed("discussion_replies", [
      {
        id: "reply-1",
        thread_id: "thread-1",
        organization_id: orgId,
        author_id: "user-2",
        body: "First reply",
        created_at: "2025-01-15T11:00:00Z",
        updated_at: "2025-01-15T11:00:00Z",
        deleted_at: null,
      },
      {
        id: "reply-2",
        thread_id: "thread-1",
        organization_id: orgId,
        author_id: "user-3",
        body: "Second reply",
        created_at: "2025-01-15T12:00:00Z",
        updated_at: "2025-01-15T12:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateGetThread(
      { auth: memberAuth, threadId: "thread-1" },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.ok(result.data.thread);
    assert.strictEqual(result.data.thread.id, "thread-1");
    assert.ok(result.data.replies);
    assert.strictEqual(result.data.replies.length, 2);
    // Replies should be sorted by created_at ASC
    assert.strictEqual(result.data.replies[0].id, "reply-1");
    assert.strictEqual(result.data.replies[1].id, "reply-2");
  });

  test("excludes soft-deleted replies", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 2,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    ctx.supabase.seed("discussion_replies", [
      {
        id: "reply-1",
        thread_id: "thread-1",
        organization_id: orgId,
        author_id: "user-2",
        body: "Active reply",
        created_at: "2025-01-15T11:00:00Z",
        updated_at: "2025-01-15T11:00:00Z",
        deleted_at: null,
      },
      {
        id: "reply-2",
        thread_id: "thread-1",
        organization_id: orgId,
        author_id: "user-3",
        body: "Deleted reply",
        created_at: "2025-01-15T12:00:00Z",
        updated_at: "2025-01-15T12:00:00Z",
        deleted_at: "2025-01-15T13:00:00Z",
      },
    ]);

    const result = simulateGetThread(
      { auth: memberAuth, threadId: "thread-1" },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.replies.length, 1);
    assert.strictEqual(result.data.replies[0].id, "reply-1");
  });
});

// ============================================================================
// Tests: PATCH /api/discussions/[threadId] (Update thread)
// ============================================================================

describe("PATCH /api/discussions/[threadId] (Update thread)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdateThread(
      {
        auth: AuthPresets.unauthenticated,
        threadId: "thread-1",
        body: { title: "Updated Title" },
      },
      ctx
    );
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.error, "Unauthorized");
  });

  test("returns 400 when title is too short", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { title: "Test" },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Title must be between 5 and 200 characters");
  });

  test("returns 400 when title is too long", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { title: "A".repeat(201) },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Title must be between 5 and 200 characters");
  });

  test("returns 400 when body is too short", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: "Short" },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Body must be between 10 and 10000 characters");
  });

  test("returns 400 when body is too long", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: "A".repeat(10001) },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Body must be between 10 and 10000 characters");
  });

  test("returns 404 when thread does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "nonexistent",
        body: { title: "Updated Title" },
      },
      ctx
    );
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.error, "Thread not found");
  });

  test("returns 403 when user is not a member of the organization", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateUpdateThread(
      {
        auth: nonMemberAuth,
        threadId: "thread-1",
        body: { title: "Updated Title" },
      },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Not a member of this organization");
  });

  test("returns 403 when non-author non-admin tries to edit title", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "different-user",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { title: "Updated Title" },
      },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Only the author or an admin can edit this thread");
  });

  test("returns 403 when non-admin tries to pin thread", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: memberAuth.user?.id || "",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { is_pinned: true },
      },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Only admins can pin or lock threads");
  });

  test("returns 403 when non-admin tries to lock thread", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: memberAuth.user?.id || "",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { is_locked: true },
      },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Only admins can pin or lock threads");
  });

  test("allows author to edit their own thread", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";
    const userId = memberAuth.user?.id || "";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: userId,
        title: "Original Title",
        body: "Original body content here",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateUpdateThread(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { title: "Updated Title", body: "Updated body content here" },
      },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.title, "Updated Title");
    assert.strictEqual(result.data.body, "Updated body content here");
  });

  test("allows admin to edit any thread", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "different-user",
        title: "Original Title",
        body: "Original body content here",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateUpdateThread(
      {
        auth: adminAuth,
        threadId: "thread-1",
        body: { title: "Admin Updated Title" },
      },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.title, "Admin Updated Title");
  });

  test("allows admin to pin thread", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateUpdateThread(
      {
        auth: adminAuth,
        threadId: "thread-1",
        body: { is_pinned: true },
      },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.is_pinned, true);
  });

  test("allows admin to lock thread", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateUpdateThread(
      {
        auth: adminAuth,
        threadId: "thread-1",
        body: { is_locked: true },
      },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.is_locked, true);
  });
});

// ============================================================================
// Tests: DELETE /api/discussions/[threadId] (Soft delete)
// ============================================================================

describe("DELETE /api/discussions/[threadId] (Soft delete)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateDeleteThread(
      { auth: AuthPresets.unauthenticated, threadId: "thread-1" },
      ctx
    );
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.error, "Unauthorized");
  });

  test("returns 404 when thread does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateDeleteThread(
      { auth: memberAuth, threadId: "nonexistent" },
      ctx
    );
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.error, "Thread not found");
  });

  test("returns 403 when user is not a member of the organization", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateDeleteThread(
      { auth: nonMemberAuth, threadId: "thread-1" },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Not a member of this organization");
  });

  test("returns 403 when non-author non-admin tries to delete", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "different-user",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateDeleteThread(
      { auth: memberAuth, threadId: "thread-1" },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Only the author or an admin can delete this thread");
  });

  test("allows author to delete their own thread", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";
    const userId = memberAuth.user?.id || "";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: userId,
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateDeleteThread(
      { auth: memberAuth, threadId: "thread-1" },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.success, true);

    // Verify soft delete
    const threads = ctx.supabase.getRows("discussion_threads");
    assert.ok(threads[0].deleted_at);
  });

  test("allows admin to delete any thread", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "different-user",
        title: "Test Thread",
        body: "This is a test thread body",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateDeleteThread(
      { auth: adminAuth, threadId: "thread-1" },
      ctx
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.success, true);

    // Verify soft delete
    const threads = ctx.supabase.getRows("discussion_threads");
    assert.ok(threads[0].deleted_at);
  });
});

// ============================================================================
// Tests: POST /api/discussions/[threadId]/replies (Add reply)
// ============================================================================

describe("POST /api/discussions/[threadId]/replies (Add reply)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateReply(
      {
        auth: AuthPresets.unauthenticated,
        threadId: "thread-1",
        body: { body: "Test reply" },
      },
      ctx
    );
    assert.strictEqual(result.status, 401);
    assert.strictEqual(result.error, "Unauthorized");
  });

  test("returns 400 when body is missing", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: {},
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Reply body is required");
  });

  test("returns 400 when body is empty", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: "" },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Body must be between 1 and 5000 characters");
  });

  test("returns 400 when body is too long", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: "A".repeat(5001) },
      },
      ctx
    );
    assert.strictEqual(result.status, 400);
    assert.strictEqual(result.error, "Body must be between 1 and 5000 characters");
  });

  test("returns 404 when thread does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "nonexistent",
        body: { body: "Test reply" },
      },
      ctx
    );
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.error, "Thread not found");
  });

  test("returns 404 when thread is soft-deleted", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Deleted Thread",
        body: "This thread is deleted",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: "2025-01-16T10:00:00Z",
      },
    ]);

    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: "Test reply" },
      },
      ctx
    );
    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.error, "Thread not found");
  });

  test("returns 403 when thread is locked", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Locked Thread",
        body: "This thread is locked",
        is_pinned: false,
        is_locked: true,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: "Test reply" },
      },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Thread is locked");
  });

  test("returns 403 when user is not a member of the organization", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateCreateReply(
      {
        auth: nonMemberAuth,
        threadId: "thread-1",
        body: { body: "Test reply" },
      },
      ctx
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Forbidden: Not a member of this organization");
  });

  test("creates reply successfully for valid member", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: "This is a test reply" },
      },
      ctx
    );

    assert.strictEqual(result.status, 201);
    assert.ok(result.data);
    assert.strictEqual(result.data.thread_id, "thread-1");
    assert.strictEqual(result.data.organization_id, orgId);
    assert.strictEqual(result.data.body, "This is a test reply");
    assert.strictEqual(result.data.deleted_at, null);

    // Verify reply was added
    const replies = ctx.supabase.getRows("discussion_replies");
    assert.strictEqual(replies.length, 1);

    // Verify thread reply count and last activity were updated
    const threads = ctx.supabase.getRows("discussion_threads");
    assert.strictEqual(threads[0].reply_count, 1);
    assert.ok(new Date(threads[0].last_activity_at) > new Date("2025-01-15T10:00:00Z"));
  });

  test("accepts reply with exactly 1 character", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: "A" },
      },
      ctx
    );

    assert.strictEqual(result.status, 201);
    assert.strictEqual(result.data.body, "A");
  });

  test("accepts reply with exactly 5000 characters", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId = "00000000-0000-0000-0000-000000000001";

    ctx.supabase.seed("discussion_threads", [
      {
        id: "thread-1",
        organization_id: orgId,
        author_id: "user-1",
        title: "Test Thread",
        body: "This is a test thread",
        is_pinned: false,
        is_locked: false,
        view_count: 0,
        reply_count: 0,
        last_activity_at: "2025-01-15T10:00:00Z",
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
        deleted_at: null,
      },
    ]);

    const longBody = "A".repeat(5000);
    const result = simulateCreateReply(
      {
        auth: memberAuth,
        threadId: "thread-1",
        body: { body: longBody },
      },
      ctx
    );

    assert.strictEqual(result.status, 201);
    assert.strictEqual(result.data.body.length, 5000);
  });
});
