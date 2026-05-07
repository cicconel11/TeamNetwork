/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { createDiscussionThread } from "../src/lib/discussions/create-thread.ts";

const ORG_ID = "org-uuid-1";
const USER_ID = "user-uuid-1";

function createDiscussionSupabaseStub() {
  const softDeletes: Array<{ id: string; deleted_at: string }> = [];

  const threadRow = {
    id: "thread-123",
    organization_id: ORG_ID,
    author_id: USER_ID,
    title: "Spring Fundraising Volunteers",
    body: "Let's organize volunteer assignments for the spring fundraiser.",
    is_pinned: false,
    is_locked: false,
    view_count: 0,
    reply_count: 0,
    last_activity_at: "2026-03-27T00:00:00.000Z",
    created_at: "2026-03-27T00:00:00.000Z",
    updated_at: "2026-03-27T00:00:00.000Z",
    deleted_at: null,
  };

  const supabase = {
    from(table: string) {
      if (table === "organizations") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: {
              slug: "upenn-sprint-football",
              discussion_post_roles: ["admin", "active_member"],
            },
            error: null,
          }),
        };
      }

      if (table === "users") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: { name: "Alex Admin" },
            error: null,
          }),
        };
      }

      if (table === "discussion_threads") {
        return {
          insert() {
            return this;
          },
          select() {
            return this;
          },
          single: async () => ({
            data: threadRow,
            error: null,
          }),
          update(payload: Record<string, unknown>) {
            return {
              eq: async (_column: string, id: string) => {
                softDeletes.push({ id, deleted_at: String(payload.deleted_at ?? "") });
                return { error: null };
              },
            };
          },
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  };

  return { supabase, softDeletes, threadRow };
}

test("createDiscussionThread returns canonical thread URL and notifies listeners", async () => {
  const { supabase, threadRow } = createDiscussionSupabaseStub();
  const notifications: any[] = [];

  const result = await createDiscussionThread({
    supabase: supabase as any,
    serviceSupabase: supabase as any,
    orgId: ORG_ID,
    userId: USER_ID,
    orgSlug: "upenn-sprint-football",
    input: {
      title: "Spring Fundraising Volunteers",
      body: "Let's organize volunteer assignments for the spring fundraiser.",
    },
    deps: {
      getOrgMembership: async () => ({ role: "admin" }),
      linkMediaToEntity: async () => ({ linked: 0 }),
      notifyNewThread: async (payload) => {
        notifications.push(payload);
        return { sent: 1, errors: [] };
      },
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.thread.id, threadRow.id);
  assert.equal(result.threadUrl, "/upenn-sprint-football/messages/threads/thread-123");
  assert.deepEqual(notifications, [
    {
      supabase: supabase,
      organizationId: ORG_ID,
      threadTitle: "Spring Fundraising Volunteers",
      threadUrl: "/upenn-sprint-football/messages/threads/thread-123",
      authorName: "Alex Admin",
    },
  ]);
});

test("createDiscussionThread soft deletes inserted thread when media linking fails", async () => {
  const { supabase, softDeletes } = createDiscussionSupabaseStub();

  const result = await createDiscussionThread({
    supabase: supabase as any,
    serviceSupabase: supabase as any,
    orgId: ORG_ID,
    userId: USER_ID,
    input: {
      title: "Spring Fundraising Volunteers",
      body: "Let's organize volunteer assignments for the spring fundraiser.",
      mediaIds: ["11111111-1111-4111-8111-111111111111"],
    },
    deps: {
      getOrgMembership: async () => ({ role: "admin" }),
      linkMediaToEntity: async () => ({ error: "Media upload is not ready" }),
      notifyNewThread: async () => ({ sent: 0, errors: [] }),
    },
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "Media upload is not ready",
  });
  assert.equal(softDeletes.length, 1);
  assert.equal(softDeletes[0].id, "thread-123");
  assert.match(softDeletes[0].deleted_at, /\d{4}-\d{2}-\d{2}T/);
});

test("createDiscussionThread rejects users without org membership", async () => {
  const { supabase } = createDiscussionSupabaseStub();

  const result = await createDiscussionThread({
    supabase: supabase as any,
    serviceSupabase: supabase as any,
    orgId: ORG_ID,
    userId: USER_ID,
    input: {
      title: "Spring Fundraising Volunteers",
      body: "Let's organize volunteer assignments for the spring fundraiser.",
    },
    deps: {
      getOrgMembership: async () => null,
      linkMediaToEntity: async () => ({ linked: 0 }),
      notifyNewThread: async () => ({ sent: 0, errors: [] }),
    },
  });

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: "Not a member of this organization",
  });
});
