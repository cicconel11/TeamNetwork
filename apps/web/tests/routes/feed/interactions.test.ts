/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { AuthPresets, getOrgRole, hasOrgMembership, isAuthenticated } from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_ORG_ID = "00000000-0000-0000-0000-000000000002";

const memberAuth = AuthPresets.orgMember(ORG_ID);
const adminAuth = AuthPresets.orgAdmin(ORG_ID);

type PollMetadata = {
  question: string;
  options: { label: string }[];
  allow_change: boolean;
};

function seedPost(
  supabase: ReturnType<typeof createSupabaseStub>,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const post = {
    id: "post-1",
    organization_id: ORG_ID,
    author_id: memberAuth.user?.id ?? "user-1",
    body: "Hello from feed",
    post_type: "text",
    metadata: null,
    deleted_at: null,
    created_at: "2025-06-01T10:00:00Z",
    updated_at: "2025-06-01T10:00:00Z",
    ...overrides,
  };

  supabase.seed("feed_posts", [post]);
  return post;
}

function seedComment(
  supabase: ReturnType<typeof createSupabaseStub>,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const comment = {
    id: "comment-1",
    post_id: "post-1",
    organization_id: ORG_ID,
    author_id: memberAuth.user?.id ?? "user-1",
    body: "Nice post",
    deleted_at: null,
    created_at: "2025-06-01T10:05:00Z",
    updated_at: "2025-06-01T10:05:00Z",
    ...overrides,
  };

  supabase.seed("feed_comments", [comment]);
  return comment;
}

function simulateCreateFeedPost({
  auth,
  orgId,
  body,
  poll,
}: {
  auth: typeof memberAuth;
  orgId?: string;
  body?: string;
  poll?: { question: string; options: string[]; allow_change?: boolean };
}) {
  const trimmedBody = body?.trim() ?? "";

  if (!isAuthenticated(auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!orgId) {
    return { status: 400, error: "orgId is required" };
  }

  if (!hasOrgMembership(auth, orgId)) {
    return { status: 403, error: "Not a member of this organization" };
  }

  if (!poll && trimmedBody.length === 0) {
    return { status: 400, error: "Post body is required" };
  }

  if (trimmedBody.length > 5000) {
    return { status: 400, error: "Post body is too long" };
  }

  if (poll) {
    if (poll.options.length < 2 || poll.options.length > 6) {
      return { status: 400, error: "Poll options must contain between 2 and 6 choices" };
    }
  }

  const allowedRoles = ["admin", "active_member", "alumni"];
  const role = getOrgRole(auth, orgId);
  if (!role || !allowedRoles.includes(role)) {
    return { status: 403, error: "Your role is not allowed to create posts" };
  }

  return {
    status: 201,
    data: {
      organization_id: orgId,
      author_id: auth.user!.id,
      body: trimmedBody,
      post_type: poll ? "poll" : "text",
      metadata: poll
        ? {
            question: poll.question,
            options: poll.options.map((label) => ({ label })),
            allow_change: poll.allow_change ?? true,
          }
        : null,
    },
  };
}

function simulateFeedList({
  auth,
  orgId,
  page = 1,
  limit = 25,
  supabase,
  mediaMap = new Map<string, Array<{ id: string; url: string }>>(),
}: {
  auth: typeof memberAuth;
  orgId: string;
  page?: number;
  limit?: number;
  supabase: ReturnType<typeof createSupabaseStub>;
  mediaMap?: Map<string, Array<{ id: string; url: string }>>;
}) {
  if (!isAuthenticated(auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!hasOrgMembership(auth, orgId)) {
    return { status: 403, error: "Not a member of this organization" };
  }

  const normalizedPage = Math.max(1, page);
  const normalizedLimit = Math.min(100, Math.max(1, limit));
  const offset = (normalizedPage - 1) * normalizedLimit;

  const posts = supabase
    .getRows("feed_posts")
    .filter((post: any) => post.organization_id === orgId && post.deleted_at === null)
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const pageRows = posts.slice(offset, offset + normalizedLimit);
  const postIds = pageRows.map((post: any) => post.id);

  const userVotes = new Map<string, number>();
  const voteCounts = new Map<string, number[]>();
  const totalVotes = new Map<string, number>();

  for (const vote of supabase.getRows("chat_poll_votes") as any[]) {
    if (!postIds.includes(vote.message_id)) continue;

    const post = pageRows.find((row: any) => row.id === vote.message_id);
    const metadata = post?.metadata as PollMetadata | null;
    if (!metadata) continue;

    if (!voteCounts.has(vote.message_id)) {
      voteCounts.set(vote.message_id, new Array(metadata.options.length).fill(0));
      totalVotes.set(vote.message_id, 0);
    }

    const counts = voteCounts.get(vote.message_id)!;
    if (vote.option_index < counts.length) {
      counts[vote.option_index] += 1;
      totalVotes.set(vote.message_id, (totalVotes.get(vote.message_id) ?? 0) + 1);
    }

    if (vote.user_id === auth.user!.id) {
      userVotes.set(vote.message_id, vote.option_index);
    }
  }

  const data = pageRows.map((post: any) => ({
    ...post,
    media: mediaMap.get(post.id) ?? [],
    ...(post.post_type === "poll"
      ? {
          poll_meta: post.metadata,
          user_vote: userVotes.get(post.id) ?? null,
          vote_counts:
            voteCounts.get(post.id) ??
            new Array(((post.metadata as PollMetadata | null)?.options ?? []).length).fill(0),
          total_votes: totalVotes.get(post.id) ?? 0,
        }
      : {}),
  }));

  return {
    status: 200,
    data,
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total: posts.length,
      totalPages: Math.ceil(posts.length / normalizedLimit),
    },
  };
}

function simulateEditComment({
  auth,
  commentId,
  body,
  supabase,
}: {
  auth: typeof memberAuth;
  commentId: string;
  body: string;
  supabase: ReturnType<typeof createSupabaseStub>;
}) {
  if (!isAuthenticated(auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (body.trim().length === 0 || body.length > 2000) {
    return { status: 400, error: "Invalid comment body" };
  }

  const comments = supabase.getRows("feed_comments");
  const comment = comments.find((row: any) => row.id === commentId && row.deleted_at === null) as any;
  if (!comment) {
    return { status: 404, error: "Comment not found" };
  }

  if (comment.author_id !== auth.user!.id) {
    return { status: 403, error: "Not authorized" };
  }

  const { data: updated } = supabase
    .from("feed_comments")
    .update({ body })
    .eq("id", commentId)
    .maybeSingle();

  return { status: 200, data: updated };
}

function simulateDeleteComment({
  auth,
  commentId,
  supabase,
}: {
  auth: typeof memberAuth;
  commentId: string;
  supabase: ReturnType<typeof createSupabaseStub>;
}) {
  if (!isAuthenticated(auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const comments = supabase.getRows("feed_comments");
  const comment = comments.find((row: any) => row.id === commentId && row.deleted_at === null) as any;
  if (!comment) {
    return { status: 404, error: "Comment not found" };
  }

  if (comment.author_id !== auth.user!.id) {
    return { status: 403, error: "Not authorized" };
  }

  supabase
    .from("feed_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId)
    .maybeSingle();

  return { status: 200, data: { success: true } };
}

function simulateVoteOnPoll({
  auth,
  postId,
  optionIndex,
  supabase,
}: {
  auth: typeof memberAuth;
  postId: string;
  optionIndex: number;
  supabase: ReturnType<typeof createSupabaseStub>;
}) {
  if (!isAuthenticated(auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const post = supabase
    .getRows("feed_posts")
    .find((row: any) => row.id === postId && row.deleted_at === null) as any;

  if (!post) {
    return { status: 404, error: "Post not found" };
  }

  if (!hasOrgMembership(auth, post.organization_id)) {
    return { status: 403, error: "Not a member of this organization" };
  }

  if (post.post_type !== "poll" || !post.metadata) {
    return { status: 400, error: "Post is not a poll" };
  }

  const metadata = post.metadata as PollMetadata;
  if (optionIndex < 0 || optionIndex >= metadata.options.length) {
    return { status: 400, error: "Invalid option index" };
  }

  const votes = supabase.getRows("chat_poll_votes");
  const existingVote = votes.find(
    (row: any) => row.message_id === postId && row.user_id === auth.user!.id,
  ) as any;

  if (existingVote) {
    if (!metadata.allow_change) {
      return { status: 409, error: "Vote cannot be changed on this poll" };
    }

    supabase
      .from("chat_poll_votes")
      .update({ option_index: optionIndex, updated_at: new Date().toISOString() })
      .eq("id", existingVote.id)
      .maybeSingle();

    return { status: 200, data: { success: true, option_index: optionIndex, updated: true } };
  }

  supabase.seed("chat_poll_votes", [
    {
      id: `vote-${Date.now()}`,
      message_id: postId,
      user_id: auth.user!.id,
      option_index: optionIndex,
      organization_id: post.organization_id,
    },
  ]);

  return { status: 200, data: { success: true, option_index: optionIndex, updated: false } };
}

function simulateToggleLikeRace({
  auth,
  postId,
  supabase,
  insertErrorCode,
}: {
  auth: typeof memberAuth;
  postId: string;
  supabase: ReturnType<typeof createSupabaseStub>;
  insertErrorCode?: string;
}) {
  if (!isAuthenticated(auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  const post = supabase
    .getRows("feed_posts")
    .find((row: any) => row.id === postId && row.deleted_at === null) as any;

  if (!post) {
    return { status: 404, error: "Post not found" };
  }

  if (!hasOrgMembership(auth, post.organization_id)) {
    return { status: 403, error: "Not a member of this organization" };
  }

  const existingLike = supabase
    .getRows("feed_likes")
    .find((row: any) => row.post_id === postId && row.user_id === auth.user!.id);

  if (existingLike) {
    return { status: 200, data: { liked: false } };
  }

  if (insertErrorCode === "23505") {
    return { status: 200, data: { liked: true } };
  }

  if (insertErrorCode) {
    return { status: 500, error: "Failed to like post" };
  }

  supabase.seed("feed_likes", [
    {
      id: `like-${Date.now()}`,
      post_id: postId,
      user_id: auth.user!.id,
      organization_id: post.organization_id,
    },
  ]);

  return { status: 200, data: { liked: true } };
}

describe("Feed post creation", () => {
  test("allows poll-only posts with an empty body", () => {
    const result = simulateCreateFeedPost({
      auth: memberAuth,
      orgId: ORG_ID,
      body: "   ",
      poll: {
        question: "Where should we meet?",
        options: ["Gym", "Fieldhouse"],
      },
    });

    assert.equal(result.status, 201);
    assert.equal(result.data.post_type, "poll");
    assert.equal(result.data.body, "");
    assert.deepEqual(result.data.metadata, {
      question: "Where should we meet?",
      options: [{ label: "Gym" }, { label: "Fieldhouse" }],
      allow_change: true,
    });
  });

  test("rejects empty non-poll posts", () => {
    const result = simulateCreateFeedPost({
      auth: memberAuth,
      orgId: ORG_ID,
      body: "   ",
    });

    assert.equal(result.status, 400);
    assert.match(result.error ?? "", /Post body is required/);
  });
});

describe("GET /api/feed important feed state", () => {
  test("returns poll augmentation and media for feed cards", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase, {
      id: "poll-1",
      post_type: "poll",
      metadata: {
        question: "Game day snack?",
        options: [{ label: "Pizza" }, { label: "Fruit" }, { label: "Protein bars" }],
        allow_change: true,
      },
    });
    supabase.seed("chat_poll_votes", [
      { id: "vote-1", message_id: "poll-1", user_id: memberAuth.user!.id, option_index: 1 },
      { id: "vote-2", message_id: "poll-1", user_id: "other-user", option_index: 1 },
      { id: "vote-3", message_id: "poll-1", user_id: "third-user", option_index: 0 },
    ]);

    const result = simulateFeedList({
      auth: memberAuth,
      orgId: ORG_ID,
      supabase,
      mediaMap: new Map([["poll-1", [{ id: "media-1", url: "https://cdn.test/media-1.jpg" }]]]),
    });

    assert.equal(result.status, 200);
    assert.equal(result.data.length, 1);
    assert.deepEqual(result.data[0].vote_counts, [1, 2, 0]);
    assert.equal(result.data[0].total_votes, 3);
    assert.equal(result.data[0].user_vote, 1);
    assert.equal(result.data[0].media[0].id, "media-1");
  });

  test("clamps pagination and reports totals", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase, { id: "post-1", created_at: "2025-06-01T10:00:00Z" });
    seedPost(supabase, { id: "post-2", created_at: "2025-06-02T10:00:00Z" });
    seedPost(supabase, { id: "post-3", created_at: "2025-06-03T10:00:00Z" });

    const result = simulateFeedList({
      auth: memberAuth,
      orgId: ORG_ID,
      page: 0,
      limit: 1,
      supabase,
    });

    assert.equal(result.status, 200);
    assert.equal(result.pagination.page, 1);
    assert.equal(result.pagination.limit, 1);
    assert.equal(result.pagination.total, 3);
    assert.equal(result.pagination.totalPages, 3);
    assert.equal(result.data[0].id, "post-3");
  });
});

describe("Feed comment lifecycle", () => {
  test("only the comment author can edit a comment", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase);
    seedComment(supabase, { author_id: "someone-else" });

    const result = simulateEditComment({
      auth: memberAuth,
      commentId: "comment-1",
      body: "Updated text",
      supabase,
    });

    assert.equal(result.status, 403);
  });

  test("soft deletes a comment for its author", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase);
    seedComment(supabase);

    const result = simulateDeleteComment({
      auth: memberAuth,
      commentId: "comment-1",
      supabase,
    });

    assert.equal(result.status, 200);
    assert.equal(result.data.success, true);

    const [comment] = supabase.getRows("feed_comments") as any[];
    assert.ok(comment.deleted_at);
  });

  test("does not allow org admins to delete someone else's comment", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase);
    seedComment(supabase, { author_id: "someone-else" });

    const result = simulateDeleteComment({
      auth: adminAuth,
      commentId: "comment-1",
      supabase,
    });

    assert.equal(result.status, 403);
    assert.match(result.error ?? "", /Not authorized/);
  });
});

describe("Feed poll voting", () => {
  test("rejects voting on a non-poll post", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase, { post_type: "text", metadata: null });

    const result = simulateVoteOnPoll({
      auth: memberAuth,
      postId: "post-1",
      optionIndex: 0,
      supabase,
    });

    assert.equal(result.status, 400);
    assert.match(result.error ?? "", /not a poll/i);
  });

  test("rejects votes for an option that does not exist", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase, {
      post_type: "poll",
      metadata: {
        question: "Captain?",
        options: [{ label: "A" }, { label: "B" }],
        allow_change: true,
      },
    });

    const result = simulateVoteOnPoll({
      auth: memberAuth,
      postId: "post-1",
      optionIndex: 2,
      supabase,
    });

    assert.equal(result.status, 400);
  });

  test("blocks vote changes when the poll disallows edits", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase, {
      post_type: "poll",
      metadata: {
        question: "Travel bus?",
        options: [{ label: "Early" }, { label: "Late" }],
        allow_change: false,
      },
    });
    supabase.seed("chat_poll_votes", [
      {
        id: "vote-1",
        message_id: "post-1",
        user_id: memberAuth.user!.id,
        option_index: 0,
      },
    ]);

    const result = simulateVoteOnPoll({
      auth: memberAuth,
      postId: "post-1",
      optionIndex: 1,
      supabase,
    });

    assert.equal(result.status, 409);
    assert.match(result.error ?? "", /cannot be changed/i);
  });

  test("updates an existing vote when allow_change is enabled", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase, {
      post_type: "poll",
      metadata: {
        question: "Uniform color?",
        options: [{ label: "Blue" }, { label: "White" }],
        allow_change: true,
      },
    });
    supabase.seed("chat_poll_votes", [
      {
        id: "vote-1",
        message_id: "post-1",
        user_id: memberAuth.user!.id,
        option_index: 0,
      },
    ]);

    const result = simulateVoteOnPoll({
      auth: memberAuth,
      postId: "post-1",
      optionIndex: 1,
      supabase,
    });

    assert.equal(result.status, 200);
    assert.equal(result.data.updated, true);
    const [vote] = supabase.getRows("chat_poll_votes") as any[];
    assert.equal(vote.option_index, 1);
  });

  test("rejects members from another org", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase, {
      organization_id: OTHER_ORG_ID,
      post_type: "poll",
      metadata: {
        question: "Workout slot?",
        options: [{ label: "AM" }, { label: "PM" }],
        allow_change: true,
      },
    });

    const result = simulateVoteOnPoll({
      auth: memberAuth,
      postId: "post-1",
      optionIndex: 0,
      supabase,
    });

    assert.equal(result.status, 403);
  });
});

describe("Feed like toggles", () => {
  test("treats a unique-constraint race as already liked", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase);

    const result = simulateToggleLikeRace({
      auth: memberAuth,
      postId: "post-1",
      supabase,
      insertErrorCode: "23505",
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { liked: true });
  });

  test("surfaces non-race insert failures", () => {
    const supabase = createSupabaseStub();
    seedPost(supabase);

    const result = simulateToggleLikeRace({
      auth: memberAuth,
      postId: "post-1",
      supabase,
      insertErrorCode: "50000",
    });

    assert.equal(result.status, 500);
    assert.match(result.error ?? "", /Failed to like post/);
  });
});
