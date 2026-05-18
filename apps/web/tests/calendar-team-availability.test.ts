import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchTeamAvailabilitySources } from "../src/lib/calendar/team-availability.ts";

const ORG_ID = "org-1";
const USER_ID = "user-1";

type Row = Record<string, unknown>;

interface Fixtures {
  schedule_events: Row[];
  events: Row[];
  scheduleError?: unknown;
  orgError?: unknown;
}

function makeStubSb(fixtures: Fixtures) {
  function builder(table: "schedule_events" | "events") {
    const rows = fixtures[table] ?? [];
    let filtered = [...rows];
    const isError =
      (table === "schedule_events" && fixtures.scheduleError) ||
      (table === "events" && fixtures.orgError);

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
      then(resolve: (value: { data: Row[] | null; error: unknown | null }) => void) {
        if (isError) {
          resolve({ data: null, error: isError });
          return;
        }
        resolve({ data: filtered, error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => builder(table as "schedule_events" | "events"),
  };
}

const start = new Date("2026-06-01T00:00:00Z");
const end = new Date("2026-06-08T00:00:00Z");

describe("fetchTeamAvailabilitySources", () => {
  it("returns empty arrays when org has no schedule or events", async () => {
    const result = await fetchTeamAvailabilitySources({
      supabase: makeStubSb({ schedule_events: [], events: [] }) as never,
      orgId: ORG_ID,
      start,
      end,
    });
    assert.deepEqual(result.scheduleEvents, []);
    assert.deepEqual(result.orgEvents, []);
    assert.deepEqual(result.normalized, []);
    assert.equal(result.scheduleError, null);
    assert.equal(result.orgError, null);
  });

  it("normalizes schedule_events with origin schedule", async () => {
    const result = await fetchTeamAvailabilitySources({
      supabase: makeStubSb({
        schedule_events: [
          {
            id: "s1",
            title: "Practice",
            start_at: "2026-06-02T15:00:00Z",
            end_at: "2026-06-02T17:00:00Z",
            location: "Field",
            status: "scheduled",
            org_id: ORG_ID,
          },
        ],
        events: [],
      }) as never,
      orgId: ORG_ID,
      start,
      end,
    });
    assert.equal(result.normalized.length, 1);
    assert.equal(result.normalized[0].origin, "schedule");
    assert.equal(result.normalized[0].id, "schedule:s1");
    assert.equal(result.normalized[0].user_id, `org:${ORG_ID}`);
  });

  it("filters org events by audience based on membership role", async () => {
    const result = await fetchTeamAvailabilitySources({
      supabase: makeStubSb({
        schedule_events: [],
        events: [
          {
            id: "e1",
            title: "Alumni Mixer",
            start_date: "2026-06-03T18:00:00Z",
            end_date: "2026-06-03T20:00:00Z",
            location: null,
            event_type: null,
            organization_id: ORG_ID,
            audience: "alumni",
            target_user_ids: null,
            deleted_at: null,
          },
          {
            id: "e2",
            title: "Team Meeting",
            start_date: "2026-06-04T18:00:00Z",
            end_date: "2026-06-04T19:00:00Z",
            location: null,
            event_type: null,
            organization_id: ORG_ID,
            audience: "all",
            target_user_ids: null,
            deleted_at: null,
          },
        ],
      }) as never,
      orgId: ORG_ID,
      start,
      end,
      membership: { role: "active_member", userId: USER_ID },
    });
    assert.equal(result.normalized.length, 1);
    assert.equal(result.normalized[0].id, "org:e2");
  });

  it("honors target_user_ids when present", async () => {
    const result = await fetchTeamAvailabilitySources({
      supabase: makeStubSb({
        schedule_events: [],
        events: [
          {
            id: "e1",
            title: "1:1",
            start_date: "2026-06-03T18:00:00Z",
            end_date: "2026-06-03T19:00:00Z",
            location: null,
            event_type: null,
            organization_id: ORG_ID,
            audience: "members",
            target_user_ids: ["other-user"],
            deleted_at: null,
          },
        ],
      }) as never,
      orgId: ORG_ID,
      start,
      end,
      membership: { role: "active_member", userId: USER_ID },
    });
    assert.equal(result.normalized.length, 0);
  });

  it("surfaces query errors without throwing", async () => {
    const result = await fetchTeamAvailabilitySources({
      supabase: makeStubSb({
        schedule_events: [],
        events: [],
        scheduleError: new Error("boom"),
      }) as never,
      orgId: ORG_ID,
      start,
      end,
    });
    assert.ok(result.scheduleError);
    assert.deepEqual(result.normalized, []);
  });
});
