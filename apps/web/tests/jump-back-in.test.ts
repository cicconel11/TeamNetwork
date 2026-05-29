/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createSupabaseStub } from "./utils/supabaseStub";
import { loadJumpBackInData } from "../src/lib/feed/load-jump-back-in";

const ORG_ID = "00000000-0000-4000-a000-000000000001";
const USER_ID = "00000000-0000-4000-a000-000000000099";
const OTHER_USER = "00000000-0000-4000-a000-000000000098";

const JOINED = "2026-01-01T00:00:00.000Z";
const LAST_SEEN = "2026-05-17T00:00:00.000Z";

let stub = createSupabaseStub();

/** Seed a membership row for the viewer with a given last-seen value. */
function seedViewer(opts: { feedLastSeenAt: string | null; createdAt?: string }) {
  stub.seed("user_organization_roles", [
    {
      id: "membership-self",
      organization_id: ORG_ID,
      user_id: USER_ID,
      role: "active_member",
      status: "active",
      created_at: opts.createdAt ?? JOINED,
      feed_last_seen_at: opts.feedLastSeenAt,
    },
  ]);
}

function seedPost(id: string, createdAt: string, deletedAt: string | null = null) {
  stub.seed("feed_posts", [
    { id, organization_id: ORG_ID, created_at: createdAt, deleted_at: deletedAt },
  ]);
}

function seedRsvp(id: string, createdAt: string) {
  stub.seed("event_rsvps", [{ id, organization_id: ORG_ID, created_at: createdAt }]);
}

function seedMember(id: string, userId: string, createdAt: string, status = "active") {
  stub.seed("user_organization_roles", [
    {
      id,
      organization_id: ORG_ID,
      user_id: userId,
      role: "active_member",
      status,
      created_at: createdAt,
      feed_last_seen_at: null,
    },
  ]);
}

beforeEach(() => {
  stub = createSupabaseStub();
});

test("returns null when there is no userId", async () => {
  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: null,
    dataClient: stub as any,
  });
  assert.equal(result, null);
});

test("returns null when the user has no membership row", async () => {
  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: USER_ID,
    dataClient: stub as any,
  });
  assert.equal(result, null);
});

test("counts only activity created after feed_last_seen_at", async () => {
  seedViewer({ feedLastSeenAt: LAST_SEEN });
  // Before last-seen — must NOT count.
  seedPost("p-old", "2026-05-16T00:00:00.000Z");
  seedRsvp("r-old", "2026-05-16T12:00:00.000Z");
  // After last-seen — must count.
  seedPost("p-new-1", "2026-05-18T00:00:00.000Z");
  seedPost("p-new-2", "2026-05-19T00:00:00.000Z");
  seedRsvp("r-new", "2026-05-27T00:00:00.000Z");

  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: USER_ID,
    dataClient: stub as any,
  });

  assert.ok(result);
  assert.equal(result.since, LAST_SEEN);
  assert.equal(result.newPosts, 2);
  assert.equal(result.newRsvps, 1);
  assert.equal(result.newMembers, 0);
  assert.equal(result.total, 3);
});

test("excludes soft-deleted posts from the count", async () => {
  seedViewer({ feedLastSeenAt: LAST_SEEN });
  seedPost("p-live", "2026-05-18T00:00:00.000Z");
  seedPost("p-deleted", "2026-05-18T00:00:00.000Z", "2026-05-19T00:00:00.000Z");

  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: USER_ID,
    dataClient: stub as any,
  });

  assert.ok(result);
  assert.equal(result.newPosts, 1);
});

test("floors a NULL last-seen to the membership created_at (no backlog inflation)", async () => {
  // Brand-new member joined 2026-05-20, never acknowledged the feed.
  seedViewer({ feedLastSeenAt: null, createdAt: "2026-05-20T00:00:00.000Z" });
  // Posts predating the join must NOT count.
  seedPost("p-before-join", "2026-05-10T00:00:00.000Z");
  // A post after the join counts.
  seedPost("p-after-join", "2026-05-21T00:00:00.000Z");

  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: USER_ID,
    dataClient: stub as any,
  });

  assert.ok(result);
  assert.equal(result.since, "2026-05-20T00:00:00.000Z");
  assert.equal(result.newPosts, 1);
});

test("excludes the viewer's own membership from the new-members count", async () => {
  // Viewer joined after their (older) last-seen, so their own row is created_at > since.
  seedViewer({ feedLastSeenAt: LAST_SEEN, createdAt: "2026-05-18T00:00:00.000Z" });
  // One genuinely-new other member after last-seen.
  seedMember("m-other", OTHER_USER, "2026-05-19T00:00:00.000Z");

  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: USER_ID,
    dataClient: stub as any,
  });

  assert.ok(result);
  // Raw count after `since` is 2 (viewer + other); viewer is subtracted → 1.
  assert.equal(result.newMembers, 1);
});

test("does not count revoked memberships as new members", async () => {
  seedViewer({ feedLastSeenAt: LAST_SEEN });
  seedMember("m-active", OTHER_USER, "2026-05-19T00:00:00.000Z", "active");
  seedMember("m-revoked", "00000000-0000-4000-a000-000000000097", "2026-05-19T00:00:00.000Z", "revoked");

  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: USER_ID,
    dataClient: stub as any,
  });

  assert.ok(result);
  assert.equal(result.newMembers, 1);
});

test("total is zero when nothing is new", async () => {
  seedViewer({ feedLastSeenAt: LAST_SEEN });
  seedPost("p-old", "2026-05-01T00:00:00.000Z");

  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: USER_ID,
    dataClient: stub as any,
  });

  assert.ok(result);
  assert.equal(result.total, 0);
});

test("returns null when the membership query errors", async () => {
  stub.simulateError("user_organization_roles", { code: "57014", message: "boom" });

  const result = await loadJumpBackInData({
    orgId: ORG_ID,
    userId: USER_ID,
    dataClient: stub as any,
  });

  assert.equal(result, null);
});
