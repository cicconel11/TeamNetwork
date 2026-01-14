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
// Convenience Auth Contexts
// ============================================================================

const ORG_ID = "00000000-0000-0000-0000-000000000001";

const memberAuth = AuthPresets.orgMember(ORG_ID);
const adminAuth = AuthPresets.orgAdmin(ORG_ID);
const nonMemberAuth = AuthPresets.authenticatedNoOrg;
const alumniAuth = AuthPresets.orgAlumni(ORG_ID);

// ============================================================================
// Types
// ============================================================================

interface ListPostsRequest {
  auth: AuthContext;
  orgId?: string;
}

interface CreatePostRequest {
  auth: AuthContext;
  body: {
    orgId?: string;
    body?: string;
  };
  feedPostRoles?: string[];
}

interface GetPostRequest {
  auth: AuthContext;
  postId: string;
}

interface UpdatePostRequest {
  auth: AuthContext;
  postId: string;
  body: { body?: string };
}

interface DeletePostRequest {
  auth: AuthContext;
  postId: string;
}

interface CreateCommentRequest {
  auth: AuthContext;
  postId: string;
  body: { body?: string };
}

interface ToggleLikeRequest {
  auth: AuthContext;
  postId: string;
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function validatePostBody(body: string): boolean {
  return body.length >= 1 && body.length <= 5000;
}

function validateCommentBody(body: string): boolean {
  return body.length >= 1 && body.length <= 2000;
}

// ============================================================================
// Simulation Functions
// ============================================================================

function simulateListPosts(request: ListPostsRequest, ctx: SimulationContext): SimulationResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.orgId) {
    return { status: 400, error: "Organization ID is required" };
  }

  if (!isValidUUID(request.orgId)) {
    return { status: 400, error: "Invalid organization ID format" };
  }

  if (!hasOrgMembership(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  const posts = ctx.supabase
    .getRows("feed_posts")
    .filter((p: any) => p.organization_id === request.orgId && p.deleted_at === null)
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Get user's likes
  const userId = request.auth.user?.id || "";
  const likes = ctx.supabase
    .getRows("feed_likes")
    .filter((l: any) => l.user_id === userId);
  const likedPostIds = new Set(likes.map((l: any) => l.post_id));

  const augmentedPosts = posts.map((p: any) => ({
    ...p,
    liked_by_user: likedPostIds.has(p.id),
  }));

  return { status: 200, data: augmentedPosts };
}

function simulateCreatePost(request: CreatePostRequest, ctx: SimulationContext): SimulationResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const { orgId, body } = request.body;

  if (!orgId || body === undefined || body === null) {
    return { status: 400, error: "Missing required fields: orgId, body" };
  }

  if (!isValidUUID(orgId)) {
    return { status: 400, error: "Invalid organization ID format" };
  }

  if (!validatePostBody(body)) {
    return { status: 400, error: "Body must be between 1 and 5000 characters" };
  }

  if (!hasOrgMembership(request.auth, orgId)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  // Check feed_post_roles
  const allowedRoles = request.feedPostRoles || ["admin", "active_member", "alumni"];
  const userRole = getOrgRole(request.auth, orgId);
  if (!userRole || !allowedRoles.includes(userRole)) {
    return { status: 403, error: "Your role is not allowed to create posts" };
  }

  const post = {
    id: `post-${Date.now()}`,
    organization_id: orgId,
    author_id: request.auth.user?.id || "",
    body,
    like_count: 0,
    comment_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  ctx.supabase.seed("feed_posts", [post]);
  return { status: 201, data: post };
}

function simulateGetPost(request: GetPostRequest, ctx: SimulationContext): SimulationResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const post = ctx.supabase
    .getRows("feed_posts")
    .find((p: any) => p.id === request.postId && p.deleted_at === null);

  if (!post) {
    return { status: 404, error: "Post not found" };
  }

  if (!hasOrgMembership(request.auth, post.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  const comments = ctx.supabase
    .getRows("feed_comments")
    .filter((c: any) => c.post_id === request.postId && c.deleted_at === null)
    .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const userId = request.auth.user?.id || "";
  const liked = ctx.supabase
    .getRows("feed_likes")
    .some((l: any) => l.post_id === request.postId && l.user_id === userId);

  return {
    status: 200,
    data: {
      post: { ...post, liked_by_user: liked },
      comments,
    },
  };
}

function simulateUpdatePost(request: UpdatePostRequest, ctx: SimulationContext): SimulationResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (request.body.body !== undefined && !validatePostBody(request.body.body)) {
    return { status: 400, error: "Body must be between 1 and 5000 characters" };
  }

  const posts = ctx.supabase.getRows("feed_posts");
  const post = posts.find((p: any) => p.id === request.postId && p.deleted_at === null);

  if (!post) {
    return { status: 404, error: "Post not found" };
  }

  if (!hasOrgMembership(request.auth, post.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  const userId = request.auth.user?.id || "";
  const isAdmin = isOrgAdmin(request.auth, post.organization_id);
  const isAuthor = post.author_id === userId;

  if (!isAuthor && !isAdmin) {
    return { status: 403, error: "Forbidden: Only the author or an admin can edit this post" };
  }

  const updatedPost = {
    ...post,
    ...(request.body.body !== undefined && { body: request.body.body }),
    updated_at: new Date().toISOString(),
  };

  const index = posts.findIndex((p: any) => p.id === request.postId);
  posts[index] = updatedPost;

  return { status: 200, data: updatedPost };
}

function simulateDeletePost(request: DeletePostRequest, ctx: SimulationContext): SimulationResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const posts = ctx.supabase.getRows("feed_posts");
  const post = posts.find((p: any) => p.id === request.postId && p.deleted_at === null);

  if (!post) {
    return { status: 404, error: "Post not found" };
  }

  if (!hasOrgMembership(request.auth, post.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  const userId = request.auth.user?.id || "";
  const isAdmin = isOrgAdmin(request.auth, post.organization_id);
  const isAuthor = post.author_id === userId;

  if (!isAuthor && !isAdmin) {
    return { status: 403, error: "Forbidden: Only the author or an admin can delete this post" };
  }

  ctx.supabase
    .from("feed_posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", request.postId)
    .maybeSingle();

  return { status: 200, data: { success: true } };
}

function simulateCreateComment(request: CreateCommentRequest, ctx: SimulationContext): SimulationResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const { body } = request.body;

  if (body === undefined || body === null) {
    return { status: 400, error: "Comment body is required" };
  }

  if (!validateCommentBody(body)) {
    return { status: 400, error: "Body must be between 1 and 2000 characters" };
  }

  const post = ctx.supabase
    .getRows("feed_posts")
    .find((p: any) => p.id === request.postId && p.deleted_at === null);

  if (!post) {
    return { status: 404, error: "Post not found" };
  }

  if (!hasOrgMembership(request.auth, post.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  const comment = {
    id: `comment-${Date.now()}`,
    post_id: request.postId,
    organization_id: post.organization_id,
    author_id: request.auth.user?.id || "",
    body,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  ctx.supabase.seed("feed_comments", [comment]);

  // Update post comment count
  const currentPost = ctx.supabase.getRows("feed_posts").find((p: any) => p.id === request.postId);
  ctx.supabase
    .from("feed_posts")
    .update({ comment_count: (currentPost?.comment_count || 0) + 1 })
    .eq("id", request.postId)
    .maybeSingle();

  return { status: 201, data: comment };
}

function simulateToggleLike(request: ToggleLikeRequest, ctx: SimulationContext): SimulationResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const post = ctx.supabase
    .getRows("feed_posts")
    .find((p: any) => p.id === request.postId && p.deleted_at === null);

  if (!post) {
    return { status: 404, error: "Post not found" };
  }

  if (!hasOrgMembership(request.auth, post.organization_id)) {
    return { status: 403, error: "Forbidden: Not a member of this organization" };
  }

  const userId = request.auth.user?.id || "";
  const likes = ctx.supabase.getRows("feed_likes");
  const existingLikeIndex = likes.findIndex(
    (l: any) => l.post_id === request.postId && l.user_id === userId,
  );

  if (existingLikeIndex >= 0) {
    // Unlike — call .then() to trigger the stub's actual storage mutation
    ctx.supabase
      .from("feed_likes")
      .delete()
      .eq("post_id", request.postId)
      .eq("user_id", userId)
      .then(() => {});
    const currentPost = ctx.supabase.getRows("feed_posts").find((p: any) => p.id === request.postId);
    ctx.supabase
      .from("feed_posts")
      .update({ like_count: Math.max((currentPost?.like_count || 0) - 1, 0) })
      .eq("id", request.postId)
      .maybeSingle();
    return { status: 200, data: { liked: false } };
  } else {
    // Like
    const like = {
      id: `like-${Date.now()}`,
      post_id: request.postId,
      user_id: userId,
      organization_id: post.organization_id,
      created_at: new Date().toISOString(),
    };
    ctx.supabase.seed("feed_likes", [like]);
    const currentPost = ctx.supabase.getRows("feed_posts").find((p: any) => p.id === request.postId);
    ctx.supabase
      .from("feed_posts")
      .update({ like_count: (currentPost?.like_count || 0) + 1 })
      .eq("id", request.postId)
      .maybeSingle();
    return { status: 200, data: { liked: true } };
  }
}

// ============================================================================
// Helper: seed a post
// ============================================================================
function seedPost(ctx: SimulationContext, overrides: Partial<any> = {}) {
  const defaults = {
    id: "post-1",
    organization_id: ORG_ID,
    author_id: "user-1",
    body: "Hello world from the feed!",
    like_count: 0,
    comment_count: 0,
    created_at: "2025-06-01T10:00:00Z",
    updated_at: "2025-06-01T10:00:00Z",
    deleted_at: null,
  };
  const post = { ...defaults, ...overrides };
  ctx.supabase.seed("feed_posts", [post]);
  return post;
}

// ============================================================================
// Tests: GET /api/feed (List posts)
// ============================================================================

describe("GET /api/feed (List posts)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateListPosts({ auth: AuthPresets.unauthenticated, orgId: ORG_ID }, ctx);
    assert.strictEqual(result.status, 401);
  });

  test("returns 400 when orgId is missing", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateListPosts({ auth: memberAuth }, ctx);
    assert.strictEqual(result.status, 400);
  });

  test("returns 400 when orgId is not a valid UUID", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateListPosts({ auth: memberAuth, orgId: "invalid" }, ctx);
    assert.strictEqual(result.status, 400);
  });

  test("returns 403 when user is not a member", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateListPosts({ auth: nonMemberAuth, orgId: ORG_ID }, ctx);
    assert.strictEqual(result.status, 403);
  });

  test("returns posts for valid member request", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { id: "post-1", created_at: "2025-06-01T10:00:00Z" });
    seedPost(ctx, { id: "post-2", created_at: "2025-06-02T10:00:00Z" });

    const result = simulateListPosts({ auth: memberAuth, orgId: ORG_ID }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.length, 2);
    // Most recent first
    assert.strictEqual(result.data[0].id, "post-2");
  });

  test("excludes soft-deleted posts", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { id: "post-1" });
    seedPost(ctx, { id: "post-2", deleted_at: "2025-06-03T10:00:00Z" });

    const result = simulateListPosts({ auth: memberAuth, orgId: ORG_ID }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.length, 1);
    assert.strictEqual(result.data[0].id, "post-1");
  });

  test("includes liked_by_user flag", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { id: "post-1" });

    ctx.supabase.seed("feed_likes", [
      { id: "like-1", post_id: "post-1", user_id: memberAuth.user?.id || "", organization_id: ORG_ID, created_at: "2025-06-01T12:00:00Z" },
    ]);

    const result = simulateListPosts({ auth: memberAuth, orgId: ORG_ID }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data[0].liked_by_user, true);
  });

  test("filters posts by organization", () => {
    const ctx = { supabase: createSupabaseStub() };
    const orgId2 = "00000000-0000-0000-0000-000000000002";
    seedPost(ctx, { id: "post-1", organization_id: ORG_ID });
    seedPost(ctx, { id: "post-2", organization_id: orgId2 });

    const result = simulateListPosts({ auth: memberAuth, orgId: ORG_ID }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.length, 1);
    assert.strictEqual(result.data[0].organization_id, ORG_ID);
  });
});

// ============================================================================
// Tests: POST /api/feed (Create post)
// ============================================================================

describe("POST /api/feed (Create post)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: AuthPresets.unauthenticated,
      body: { orgId: ORG_ID, body: "Hello" },
    }, ctx);
    assert.strictEqual(result.status, 401);
  });

  test("returns 400 when body is missing", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: memberAuth,
      body: { orgId: ORG_ID },
    }, ctx);
    assert.strictEqual(result.status, 400);
  });

  test("returns 400 when body is empty", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: memberAuth,
      body: { orgId: ORG_ID, body: "" },
    }, ctx);
    assert.strictEqual(result.status, 400);
  });

  test("returns 400 when body is too long", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: memberAuth,
      body: { orgId: ORG_ID, body: "A".repeat(5001) },
    }, ctx);
    assert.strictEqual(result.status, 400);
  });

  test("returns 403 when user is not a member", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: nonMemberAuth,
      body: { orgId: ORG_ID, body: "Hello world" },
    }, ctx);
    assert.strictEqual(result.status, 403);
  });

  test("returns 403 when role not in feed_post_roles", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: alumniAuth,
      body: { orgId: ORG_ID, body: "Hello world" },
      feedPostRoles: ["admin", "active_member"], // alumni excluded
    }, ctx);
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.error, "Your role is not allowed to create posts");
  });

  test("creates post successfully for valid member", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: memberAuth,
      body: { orgId: ORG_ID, body: "Hello from the feed!" },
    }, ctx);

    assert.strictEqual(result.status, 201);
    assert.ok(result.data);
    assert.strictEqual(result.data.organization_id, ORG_ID);
    assert.strictEqual(result.data.body, "Hello from the feed!");
    assert.strictEqual(result.data.like_count, 0);
    assert.strictEqual(result.data.comment_count, 0);
    assert.strictEqual(result.data.deleted_at, null);

    const posts = ctx.supabase.getRows("feed_posts");
    assert.strictEqual(posts.length, 1);
  });

  test("accepts post with exactly 1 character", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: memberAuth,
      body: { orgId: ORG_ID, body: "A" },
    }, ctx);
    assert.strictEqual(result.status, 201);
  });

  test("accepts post with exactly 5000 characters", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreatePost({
      auth: memberAuth,
      body: { orgId: ORG_ID, body: "A".repeat(5000) },
    }, ctx);
    assert.strictEqual(result.status, 201);
    assert.strictEqual(result.data.body.length, 5000);
  });
});

// ============================================================================
// Tests: GET /api/feed/[postId] (Post detail)
// ============================================================================

describe("GET /api/feed/[postId] (Post detail)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateGetPost({ auth: AuthPresets.unauthenticated, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 401);
  });

  test("returns 404 when post does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateGetPost({ auth: memberAuth, postId: "nonexistent" }, ctx);
    assert.strictEqual(result.status, 404);
  });

  test("returns 404 when post is soft-deleted", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { id: "post-1", deleted_at: "2025-06-02T10:00:00Z" });

    const result = simulateGetPost({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 404);
  });

  test("returns 403 when user is not a member", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    const result = simulateGetPost({ auth: nonMemberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 403);
  });

  test("returns post with comments and like status", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { comment_count: 1 });

    ctx.supabase.seed("feed_comments", [
      {
        id: "comment-1",
        post_id: "post-1",
        organization_id: ORG_ID,
        author_id: "user-2",
        body: "Great post!",
        created_at: "2025-06-01T11:00:00Z",
        updated_at: "2025-06-01T11:00:00Z",
        deleted_at: null,
      },
    ]);

    const result = simulateGetPost({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 200);
    assert.ok(result.data.post);
    assert.strictEqual(result.data.post.id, "post-1");
    assert.strictEqual(result.data.comments.length, 1);
    assert.strictEqual(result.data.post.liked_by_user, false);
  });

  test("excludes soft-deleted comments", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    ctx.supabase.seed("feed_comments", [
      {
        id: "comment-1", post_id: "post-1", organization_id: ORG_ID,
        author_id: "user-2", body: "Active comment",
        created_at: "2025-06-01T11:00:00Z", updated_at: "2025-06-01T11:00:00Z", deleted_at: null,
      },
      {
        id: "comment-2", post_id: "post-1", organization_id: ORG_ID,
        author_id: "user-3", body: "Deleted comment",
        created_at: "2025-06-01T12:00:00Z", updated_at: "2025-06-01T12:00:00Z", deleted_at: "2025-06-01T13:00:00Z",
      },
    ]);

    const result = simulateGetPost({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.data.comments.length, 1);
    assert.strictEqual(result.data.comments[0].id, "comment-1");
  });
});

// ============================================================================
// Tests: PATCH /api/feed/[postId] (Update post)
// ============================================================================

describe("PATCH /api/feed/[postId] (Update post)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdatePost({
      auth: AuthPresets.unauthenticated,
      postId: "post-1",
      body: { body: "Updated body" },
    }, ctx);
    assert.strictEqual(result.status, 401);
  });

  test("returns 404 when post does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdatePost({
      auth: memberAuth,
      postId: "nonexistent",
      body: { body: "Updated body" },
    }, ctx);
    assert.strictEqual(result.status, 404);
  });

  test("returns 403 when non-author non-admin tries to edit", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { author_id: "different-user" });

    const result = simulateUpdatePost({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "Updated body" },
    }, ctx);
    assert.strictEqual(result.status, 403);
  });

  test("allows author to edit their own post", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { author_id: memberAuth.user?.id || "" });

    const result = simulateUpdatePost({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "Updated body content" },
    }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.body, "Updated body content");
  });

  test("allows admin to edit any post", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { author_id: "different-user" });

    const result = simulateUpdatePost({
      auth: adminAuth,
      postId: "post-1",
      body: { body: "Admin updated this" },
    }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.body, "Admin updated this");
  });

  test("returns 400 when body is too long", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateUpdatePost({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "A".repeat(5001) },
    }, ctx);
    assert.strictEqual(result.status, 400);
  });
});

// ============================================================================
// Tests: DELETE /api/feed/[postId] (Soft delete)
// ============================================================================

describe("DELETE /api/feed/[postId] (Soft delete)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateDeletePost({ auth: AuthPresets.unauthenticated, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 401);
  });

  test("returns 404 when post does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateDeletePost({ auth: memberAuth, postId: "nonexistent" }, ctx);
    assert.strictEqual(result.status, 404);
  });

  test("returns 403 when non-author non-admin tries to delete", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { author_id: "different-user" });

    const result = simulateDeletePost({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 403);
  });

  test("allows author to delete their own post", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { author_id: memberAuth.user?.id || "" });

    const result = simulateDeletePost({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.success, true);

    const posts = ctx.supabase.getRows("feed_posts");
    assert.ok(posts[0].deleted_at);
  });

  test("allows admin to delete any post", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { author_id: "different-user" });

    const result = simulateDeletePost({ auth: adminAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.success, true);
  });
});

// ============================================================================
// Tests: POST /api/feed/[postId]/comments (Add comment)
// ============================================================================

describe("POST /api/feed/[postId]/comments (Add comment)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateComment({
      auth: AuthPresets.unauthenticated,
      postId: "post-1",
      body: { body: "Nice post" },
    }, ctx);
    assert.strictEqual(result.status, 401);
  });

  test("returns 400 when body is missing", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateComment({
      auth: memberAuth,
      postId: "post-1",
      body: {},
    }, ctx);
    assert.strictEqual(result.status, 400);
  });

  test("returns 400 when body is empty", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateComment({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "" },
    }, ctx);
    assert.strictEqual(result.status, 400);
  });

  test("returns 400 when body is too long", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateComment({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "A".repeat(2001) },
    }, ctx);
    assert.strictEqual(result.status, 400);
  });

  test("returns 404 when post does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateCreateComment({
      auth: memberAuth,
      postId: "nonexistent",
      body: { body: "Nice post" },
    }, ctx);
    assert.strictEqual(result.status, 404);
  });

  test("returns 404 when post is soft-deleted", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { deleted_at: "2025-06-02T10:00:00Z" });

    const result = simulateCreateComment({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "Nice post" },
    }, ctx);
    assert.strictEqual(result.status, 404);
  });

  test("returns 403 when user is not a member", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    const result = simulateCreateComment({
      auth: nonMemberAuth,
      postId: "post-1",
      body: { body: "Nice post" },
    }, ctx);
    assert.strictEqual(result.status, 403);
  });

  test("creates comment successfully", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    const result = simulateCreateComment({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "Great post!" },
    }, ctx);

    assert.strictEqual(result.status, 201);
    assert.strictEqual(result.data.body, "Great post!");
    assert.strictEqual(result.data.post_id, "post-1");

    const comments = ctx.supabase.getRows("feed_comments");
    assert.strictEqual(comments.length, 1);
  });

  test("accepts comment with exactly 1 character", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    const result = simulateCreateComment({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "A" },
    }, ctx);
    assert.strictEqual(result.status, 201);
  });

  test("accepts comment with exactly 2000 characters", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    const result = simulateCreateComment({
      auth: memberAuth,
      postId: "post-1",
      body: { body: "A".repeat(2000) },
    }, ctx);
    assert.strictEqual(result.status, 201);
    assert.strictEqual(result.data.body.length, 2000);
  });
});

// ============================================================================
// Tests: POST /api/feed/[postId]/like (Toggle like)
// ============================================================================

describe("POST /api/feed/[postId]/like (Toggle like)", () => {
  test("returns 401 when not authenticated", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateToggleLike({ auth: AuthPresets.unauthenticated, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 401);
  });

  test("returns 404 when post does not exist", () => {
    const ctx = { supabase: createSupabaseStub() };
    const result = simulateToggleLike({ auth: memberAuth, postId: "nonexistent" }, ctx);
    assert.strictEqual(result.status, 404);
  });

  test("returns 403 when user is not a member", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    const result = simulateToggleLike({ auth: nonMemberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 403);
  });

  test("likes a post when not already liked", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    const result = simulateToggleLike({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.liked, true);

    const likes = ctx.supabase.getRows("feed_likes");
    assert.strictEqual(likes.length, 1);
  });

  test("unlikes a post when already liked", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx, { like_count: 1 });

    ctx.supabase.seed("feed_likes", [
      { id: "like-1", post_id: "post-1", user_id: memberAuth.user?.id || "", organization_id: ORG_ID, created_at: "2025-06-01T12:00:00Z" },
    ]);

    const result = simulateToggleLike({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.liked, false);

    const likes = ctx.supabase.getRows("feed_likes");
    assert.strictEqual(likes.length, 0);
  });

  test("like toggle is idempotent (like twice results in like then unlike)", () => {
    const ctx = { supabase: createSupabaseStub() };
    seedPost(ctx);

    // First like
    const result1 = simulateToggleLike({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result1.data.liked, true);

    // Second toggle = unlike
    const result2 = simulateToggleLike({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result2.data.liked, false);

    // Third toggle = like again
    const result3 = simulateToggleLike({ auth: memberAuth, postId: "post-1" }, ctx);
    assert.strictEqual(result3.data.liked, true);
  });
});
