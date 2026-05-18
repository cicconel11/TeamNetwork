import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findFreeMembersModule } from "../src/lib/ai/tools/registry/find-free-members.ts";

const ORG_ID = "org-1";
const USER_ID = "actor-1";

type Row = Record<string, unknown>;

interface TableFixtures {
  members: Row[];
  users: Row[];
  academic_schedules: Row[];
  schedule_events: Row[];
  events: Row[];
}

function makeStubSb(fixtures: TableFixtures) {
  function builder(table: keyof TableFixtures) {
    const rows = fixtures[table] ?? [];
    let filtered = [...rows];
    const chain: Record<string, unknown> = {
      select() {
        return chain;
      },
      eq(col: string, val: unknown) {
        filtered = filtered.filter((row) => row[col] === val);
        return chain;
      },
      neq(col: string, val: unknown) {
        filtered = filtered.filter((row) => row[col] !== val);
        return chain;
      },
      is(col: string, val: unknown) {
        filtered = filtered.filter((row) => row[col] === val);
        return chain;
      },
      in(col: string, values: unknown[]) {
        const set = new Set(values);
        filtered = filtered.filter((row) => set.has(row[col]));
        return chain;
      },
      lte() {
        return chain;
      },
      gte() {
        return chain;
      },
      or() {
        return chain;
      },
      limit() {
        return chain;
      },
      order() {
        return chain;
      },
      then(resolve: (value: { data: Row[]; error: null }) => void) {
        resolve({ data: filtered, error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => builder(table as keyof TableFixtures),
  };
}

const ctx = {
  orgId: ORG_ID,
  userId: USER_ID,
  serviceSupabase: null as never,
  authorization: { kind: "preverified_admin", source: "ai_org_context" } as const,
};

const logContext = { requestId: "req-1", route: "test" } as never;

async function execute(args: Record<string, unknown>, fixtures: TableFixtures) {
  const parsed = findFreeMembersModule.argsSchema.parse(args);
  return findFreeMembersModule.execute(parsed as never, {
    ctx: ctx as never,
    sb: makeStubSb(fixtures) as never,
    logContext,
  });
}

describe("find_free_members", () => {
  it("returns no_data when org has no members", async () => {
    const result = await execute(
      { start: "2026-06-01T15:00:00Z", end: "2026-06-01T22:00:00Z" },
      {
        members: [],
        users: [],
        academic_schedules: [],
        schedule_events: [],
        events: [],
      },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { state: string; total_members: number; hours: unknown[] };
    assert.equal(data.state, "no_data");
    assert.equal(data.total_members, 0);
    assert.deepEqual(data.hours, []);
  });

  it("returns no_data when members exist but no schedules and no org events", async () => {
    const result = await execute(
      { start: "2026-06-01T15:00:00Z", end: "2026-06-01T22:00:00Z" },
      {
        members: [
          {
            user_id: "u1",
            first_name: "Alice",
            last_name: "Smith",
            email: "a@example.com",
            organization_id: ORG_ID,
            status: "active",
            deleted_at: null,
          },
        ],
        users: [{ id: "u1", name: "Alice Smith" }],
        academic_schedules: [],
        schedule_events: [],
        events: [],
      },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { state: string; total_members: number };
    assert.equal(data.state, "no_data");
    assert.equal(data.total_members, 1);
  });

  it("marks user busy when academic_schedules overlaps an hour bucket", async () => {
    // 2026-06-01 is a Monday → day_of_week = 1
    const result = await execute(
      { start: "2026-06-01T15:00:00Z", end: "2026-06-01T22:00:00Z" },
      {
        members: [
          {
            user_id: "u1",
            first_name: "Alice",
            last_name: "Smith",
            email: "a@example.com",
            organization_id: ORG_ID,
            status: "active",
            deleted_at: null,
          },
          {
            user_id: "u2",
            first_name: "Bob",
            last_name: "Jones",
            email: "b@example.com",
            organization_id: ORG_ID,
            status: "active",
            deleted_at: null,
          },
        ],
        users: [
          { id: "u1", name: "Alice Smith" },
          { id: "u2", name: "Bob Jones" },
        ],
        academic_schedules: [
          {
            id: "s1",
            user_id: "u1",
            title: "Tennis Practice",
            start_date: "2026-05-01",
            end_date: "2026-12-31",
            start_time: "16:00",
            end_time: "18:00",
            occurrence_type: "weekly",
            day_of_week: [1],
            day_of_month: null,
            organization_id: ORG_ID,
            deleted_at: null,
          },
        ],
        schedule_events: [],
        events: [],
      },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as {
      state: string;
      total_members: number;
      hours: Array<{ hour_key: string; free: Array<{ user_id: string }>; busy: Array<{ user_id: string }>; free_count: number }>;
    };
    assert.equal(data.state, "resolved");
    assert.equal(data.total_members, 2);
    // 16:00 ET = 20:00 UTC (default org timezone is America/New_York, June = UTC-4)
    const conflictHour = data.hours.find((h) => h.hour_key.endsWith("T20:00"));
    assert.ok(conflictHour, "expected an hour bucket at T20:00 UTC");
    assert.ok(conflictHour.busy.some((b) => b.user_id === "u1"));
    assert.ok(conflictHour.free.some((f) => f.user_id === "u2"));
  });

  it("marks every member busy during org-wide schedule_events overlap", async () => {
    const result = await execute(
      { start: "2026-06-02T17:00:00Z", end: "2026-06-02T21:00:00Z" },
      {
        members: [
          {
            user_id: "u1",
            first_name: "Alice",
            last_name: "Smith",
            email: "a@example.com",
            organization_id: ORG_ID,
            status: "active",
            deleted_at: null,
          },
          {
            user_id: "u2",
            first_name: "Bob",
            last_name: "Jones",
            email: "b@example.com",
            organization_id: ORG_ID,
            status: "active",
            deleted_at: null,
          },
        ],
        users: [],
        academic_schedules: [],
        schedule_events: [
          {
            id: "ev1",
            title: "Team Meeting",
            start_at: "2026-06-02T18:00:00Z",
            end_at: "2026-06-02T20:00:00Z",
            location: null,
            status: "scheduled",
            org_id: ORG_ID,
          },
        ],
        events: [],
      },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as {
      hours: Array<{ hour_key: string; free_count: number; busy: Array<{ reason: string }> }>;
    };
    const meetingHour = data.hours.find((h) => h.hour_key.endsWith("T18:00"));
    assert.ok(meetingHour);
    assert.equal(meetingHour.free_count, 0);
    assert.ok(meetingHour.busy.every((b) => b.reason === "Team Meeting"));
  });

  it("filters academic_schedules by sport substring (title match)", async () => {
    const result = await execute(
      { start: "2026-06-01T15:00:00Z", end: "2026-06-01T22:00:00Z", sport: "golf" },
      {
        members: [
          {
            user_id: "u1",
            first_name: "Alice",
            last_name: "Smith",
            email: "a@example.com",
            organization_id: ORG_ID,
            status: "active",
            deleted_at: null,
          },
        ],
        users: [],
        academic_schedules: [
          {
            id: "s1",
            user_id: "u1",
            title: "Tennis Practice",
            start_date: "2026-05-01",
            end_date: "2026-12-31",
            start_time: "16:00",
            end_time: "18:00",
            occurrence_type: "weekly",
            day_of_week: [1],
            day_of_month: null,
            organization_id: ORG_ID,
            deleted_at: null,
          },
        ],
        // Need org-wide data to avoid no_data shortcut
        schedule_events: [
          {
            id: "ev_filler",
            title: "Filler",
            start_at: "2026-06-01T23:00:00Z",
            end_at: "2026-06-01T23:30:00Z",
            location: null,
            status: "scheduled",
            org_id: ORG_ID,
          },
        ],
        events: [],
      },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as {
      state: string;
      hours: Array<{ hour_key: string; busy: Array<{ user_id: string }>; free: Array<{ user_id: string }> }>;
    };
    assert.equal(data.state, "resolved");
    // Tennis row should be filtered out → user is free at 16:00
    const hourAt16 = data.hours.find((h) => h.hour_key.endsWith("T16:00"));
    assert.ok(hourAt16);
    assert.ok(hourAt16.busy.every((b) => b.user_id !== "u1"));
    assert.ok(hourAt16.free.some((f) => f.user_id === "u1"));
  });

  it("rejects windows exceeding 14 days", async () => {
    const result = await execute(
      { start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" },
      {
        members: [],
        users: [],
        academic_schedules: [],
        schedule_events: [],
        events: [],
      },
    );
    assert.equal(result.kind, "tool_error");
  });

  it("rejects inverted windows", async () => {
    const result = await execute(
      { start: "2026-06-02T00:00:00Z", end: "2026-06-01T00:00:00Z" },
      {
        members: [],
        users: [],
        academic_schedules: [],
        schedule_events: [],
        events: [],
      },
    );
    assert.equal(result.kind, "tool_error");
  });

  it("applies min_free filter", async () => {
    const result = await execute(
      { start: "2026-06-01T15:00:00Z", end: "2026-06-01T18:00:00Z", min_free: 2 },
      {
        members: [
          {
            user_id: "u1",
            first_name: "Alice",
            last_name: "Smith",
            email: "a@example.com",
            organization_id: ORG_ID,
            status: "active",
            deleted_at: null,
          },
        ],
        users: [],
        academic_schedules: [
          {
            id: "s1",
            user_id: "u1",
            title: "Tennis",
            start_date: "2026-05-01",
            end_date: "2026-12-31",
            start_time: "16:00",
            end_time: "17:00",
            occurrence_type: "weekly",
            day_of_week: [1],
            day_of_month: null,
            organization_id: ORG_ID,
            deleted_at: null,
          },
        ],
        schedule_events: [],
        events: [],
      },
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    const data = result.data as { hours: unknown[] };
    // Only 1 member → no hour passes min_free=2
    assert.equal(data.hours.length, 0);
  });
});
