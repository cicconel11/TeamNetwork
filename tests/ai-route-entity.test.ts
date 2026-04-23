import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCurrentDiscussionThreadRouteId,
  extractCurrentMemberRouteId,
  extractRouteEntity,
} from "../src/lib/ai/route-entity.ts";
import { loadRouteEntityContext } from "../src/lib/ai/route-entity-loaders.ts";

const ORG_ID = "org-current";

test("extractRouteEntity resolves supported detail routes and aliases", () => {
  assert.deepEqual(extractRouteEntity("/acme/members/member-1"), {
    kind: "member",
    id: "member-1",
  });
  assert.deepEqual(extractRouteEntity("/acme/messages/threads/thread-1"), {
    kind: "discussion_thread",
    id: "thread-1",
  });
  assert.deepEqual(extractRouteEntity("/acme/discussions/thread-1"), {
    kind: "discussion_thread",
    id: "thread-1",
  });
  assert.deepEqual(extractRouteEntity("/acme/calendar/events/event-1"), {
    kind: "event",
    id: "event-1",
  });
  assert.deepEqual(extractRouteEntity("/acme/events/event-1"), {
    kind: "event",
    id: "event-1",
  });
  assert.deepEqual(extractRouteEntity("/acme/jobs/job-1"), {
    kind: "job_posting",
    id: "job-1",
  });
  assert.deepEqual(extractRouteEntity("/acme/announcements/announcement-1/edit"), {
    kind: "announcement",
    id: "announcement-1",
  });
});

test("extractRouteEntity rejects list, create, malformed, and enterprise routes", () => {
  assert.equal(extractRouteEntity("/acme/members"), null);
  assert.equal(extractRouteEntity("/acme/members/new"), null);
  assert.equal(extractRouteEntity("/acme/announcements/announcement-1"), null);
  assert.equal(extractRouteEntity("/acme/calendar/events"), null);
  assert.equal(extractRouteEntity("//acme/members/member-1"), null);
  assert.equal(extractRouteEntity("/enterprise/acme/members/member-1"), null);
});

test("legacy current-route helpers delegate to the shared route parser", () => {
  assert.equal(extractCurrentMemberRouteId("/acme/members/member-1"), "member-1");
  assert.equal(
    extractCurrentDiscussionThreadRouteId("/acme/messages/threads/thread-1"),
    "thread-1"
  );
  assert.equal(extractCurrentMemberRouteId("/acme/jobs/job-1"), null);
});

test("loadRouteEntityContext loads visible org-scoped member context", async () => {
  const context = await loadRouteEntityContext({
    supabase: createRouteEntitySupabaseStub({
      members: [
        {
          id: "member-1",
          organization_id: ORG_ID,
          deleted_at: null,
          first_name: "Jane",
          last_name: "Captain",
          email: "jane@example.com",
          role: "Captain",
          status: "active",
        },
      ],
    }),
    organizationId: ORG_ID,
    currentPath: "/acme/members/member-1",
    routeEntity: { kind: "member", id: "member-1" },
  });

  assert.equal(context?.kind, "member");
  assert.equal(context?.displayName, "Jane Captain");
  assert.match(context?.nextActions.join(" ") ?? "", /direct message/);
});

test("loadRouteEntityContext rejects cross-org URL spoofing", async () => {
  const context = await loadRouteEntityContext({
    supabase: createRouteEntitySupabaseStub({
      members: [
        {
          id: "member-1",
          organization_id: "other-org",
          deleted_at: null,
          first_name: "Other",
          last_name: "Member",
          email: "other@example.com",
        },
      ],
    }),
    organizationId: ORG_ID,
    currentPath: "/other-org/members/member-1",
    routeEntity: { kind: "member", id: "member-1" },
  });

  assert.equal(context, null);
});

test("loadRouteEntityContext rejects soft-deleted and inactive entities", async () => {
  const deleted = await loadRouteEntityContext({
    supabase: createRouteEntitySupabaseStub({
      events: [
        {
          id: "event-1",
          organization_id: ORG_ID,
          deleted_at: "2026-04-01T00:00:00Z",
          title: "Deleted Event",
        },
      ],
    }),
    organizationId: ORG_ID,
    currentPath: "/acme/calendar/events/event-1",
    routeEntity: { kind: "event", id: "event-1" },
  });
  const inactive = await loadRouteEntityContext({
    supabase: createRouteEntitySupabaseStub({
      job_postings: [
        {
          id: "job-1",
          organization_id: ORG_ID,
          deleted_at: null,
          title: "Archived Job",
          is_active: false,
        },
      ],
    }),
    organizationId: ORG_ID,
    currentPath: "/acme/jobs/job-1",
    routeEntity: { kind: "job_posting", id: "job-1" },
  });

  assert.equal(deleted, null);
  assert.equal(inactive, null);
});

function createRouteEntitySupabaseStub(
  tables: Record<string, Array<Record<string, unknown>>>
) {
  return {
    from: (table: string) => {
      const query = {
        filters: [] as Array<{ column: string; value: unknown; kind: "eq" | "is" }>,
        select(...args: unknown[]) {
          void args;
          return this;
        },
        eq(column: string, value: unknown) {
          this.filters.push({ column, value, kind: "eq" });
          return this;
        },
        is(column: string, value: unknown) {
          this.filters.push({ column, value, kind: "is" });
          return this;
        },
        async maybeSingle() {
          const rows = tables[table] ?? [];
          const data =
            rows.find((row) =>
              this.filters.every((filter) => row[filter.column] === filter.value)
            ) ?? null;
          return { data, error: null };
        },
      };
      return query;
    },
  };
}
