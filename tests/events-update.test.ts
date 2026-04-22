import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { updateEvent } from "@/lib/events/update-event";

// ─── Minimal Supabase stub ──────────────────────────────────────────────
// updateEvent touches exactly two tables: user_organization_roles (via
// getOrgMembership) and events. This stub routes those two and records
// every filter call so tests can assert the exact query shape.

type EventRow = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  location: string | null;
  event_type: string;
  is_philanthropy: boolean | null;
  created_by_user_id: string;
  audience: string | null;
  updated_at: string;
  deleted_at: string | null;
  created_at: string;
  recurrence_group_id: string | null;
  recurrence_index: number | null;
  recurrence_rule: unknown | null;
};

interface StubState {
  membership: { role: string } | null;
  event: EventRow | null;
  fetchError: { message: string } | null;
  updateError: { message: string } | null;
  updateResult: EventRow | null;
  updatePayload: Record<string, unknown> | null;
  updateFilters: Array<{ op: string; column: string; value: unknown }>;
}

type StubChain = {
  eq: (column: string, value: unknown) => StubChain;
  is: (column: string, value: null) => StubChain;
  maybeSingle: () => Promise<{
    data: EventRow | null;
    error: { message: string } | null;
  }>;
};

type StubUpdateChain = {
  eq: (column: string, value: unknown) => StubUpdateChain;
  is: (column: string, value: null) => StubUpdateChain;
  select: () => {
    maybeSingle: () => Promise<{
      data: EventRow | null;
      error: { message: string } | null;
    }>;
  };
};

type StubRolesChain = {
  eq: (column: string, value: unknown) => StubRolesChain;
  maybeSingle: () => Promise<{
    data: { role: string } | null;
    error: { message: string } | null;
  }>;
};

function buildStub(state: StubState) {
  const eventSelectChain = (): StubChain => {
    const chain: StubChain = {
      eq: () => chain,
      is: () => chain,
      maybeSingle: async () => ({
        data: state.event,
        error: state.fetchError,
      }),
    };
    return chain;
  };

  const eventUpdateChain = (): StubUpdateChain => {
    const chain: StubUpdateChain = {
      eq: (column, value) => {
        state.updateFilters.push({ op: "eq", column, value });
        return chain;
      },
      is: (column, value) => {
        state.updateFilters.push({ op: "is", column, value });
        return chain;
      },
      select: () => ({
        maybeSingle: async () => ({
          data: state.updateResult,
          error: state.updateError,
        }),
      }),
    };
    return chain;
  };

  const rolesSelectChain = (): StubRolesChain => {
    const chain: StubRolesChain = {
      eq: () => chain,
      maybeSingle: async () => ({ data: state.membership, error: null }),
    };
    return chain;
  };

  return {
    from(table: string) {
      if (table === "user_organization_roles") {
        return { select: () => rolesSelectChain() };
      }
      if (table === "events") {
        return {
          select: () => eventSelectChain(),
          update: (payload: Record<string, unknown>) => {
            state.updatePayload = payload;
            return eventUpdateChain();
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as Parameters<typeof updateEvent>[0]["supabase"];
}

function baseRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "00000000-0000-0000-0000-0000000000a1",
    organization_id: "00000000-0000-0000-0000-0000000000b1",
    title: "Original Event",
    description: "Original description",
    start_date: "2026-04-22T09:00:00.000Z",
    end_date: "2026-04-22T10:00:00.000Z",
    location: "Gym",
    event_type: "general",
    is_philanthropy: false,
    created_by_user_id: "00000000-0000-0000-0000-0000000000c1",
    audience: "both",
    updated_at: "2026-04-21T10:00:00.000Z",
    deleted_at: null,
    created_at: "2026-04-20T09:00:00.000Z",
    recurrence_group_id: null,
    recurrence_index: null,
    recurrence_rule: null,
    ...overrides,
  };
}

function freshState(): StubState {
  return {
    membership: { role: "admin" },
    event: baseRow(),
    fetchError: null,
    updateError: null,
    updateResult: baseRow({
      title: "Updated Event",
      updated_at: "2026-04-21T10:05:00.000Z",
    }),
    updatePayload: null,
    updateFilters: [],
  };
}

const ORG = "00000000-0000-0000-0000-0000000000b1";
const USER = "00000000-0000-0000-0000-0000000000c1";
const TARGET = "00000000-0000-0000-0000-0000000000a1";

// ─── Tests ──────────────────────────────────────────────────────────────

describe("updateEvent — input validation", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("rejects an empty patch with 400 empty_patch", async () => {
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: {},
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, "empty_patch");
    }
  });

  it("rejects a malformed patch with 400 invalid_patch", async () => {
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "a".repeat(201) },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, "invalid_patch");
    }
  });

  it("rejects an invalid start_date format", async () => {
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { start_date: "tomorrow" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, "invalid_patch");
    }
  });
});

describe("updateEvent — permission check", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 403 forbidden when caller is not an admin", async () => {
    state.membership = { role: "active_member" };
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "New" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error, "forbidden");
    }
  });

  it("returns 403 forbidden when caller is not a member at all", async () => {
    state.membership = null;
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "New" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
    }
  });
});

describe("updateEvent — target lookup", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 404 not_found when the event does not exist", async () => {
    state.event = null;
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "New" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 404);
      assert.equal(result.error, "not_found");
    }
  });
});

describe("updateEvent — recurrence guard (Tier 4 out of scope)", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("rejects a recurring event (non-null recurrence_group_id) with 422", async () => {
    state.event = baseRow({
      recurrence_group_id: "00000000-0000-0000-0000-0000000000d1",
      recurrence_index: 0,
      recurrence_rule: { freq: "WEEKLY" },
    });
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "Move the recurring series" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
      assert.equal(result.error, "recurring_event_unsupported");
    }
  });

  it("rejects a recurring instance (recurrence_index set, rule null) with 422", async () => {
    state.event = baseRow({
      recurrence_group_id: "00000000-0000-0000-0000-0000000000d1",
      recurrence_index: 3,
      recurrence_rule: null,
    });
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "Move this one instance only" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
      assert.equal(result.error, "recurring_event_unsupported");
    }
  });
});

describe("updateEvent — optimistic concurrency", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 409 stale_version when expectedUpdatedAt does not match current", async () => {
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "New" },
      expectedUpdatedAt: "2026-04-21T09:00:00.000Z",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, "stale_version");
    }
  });

  it("proceeds when expectedUpdatedAt matches current", async () => {
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "New title" },
      expectedUpdatedAt: "2026-04-21T10:00:00.000Z",
    });
    assert.equal(result.ok, true);
  });

  it("adds the updated_at filter to the UPDATE when expectedUpdatedAt is supplied", async () => {
    await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "New title" },
      expectedUpdatedAt: "2026-04-21T10:00:00.000Z",
    });
    const updatedAtFilter = state.updateFilters.find(
      (f) => f.op === "eq" && f.column === "updated_at"
    );
    assert.ok(updatedAtFilter, "UPDATE must include eq filter on updated_at");
    assert.equal(updatedAtFilter!.value, "2026-04-21T10:00:00.000Z");
  });

  it("returns 409 stale_version when the UPDATE affects zero rows", async () => {
    state.updateResult = null;
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "New title" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, "stale_version");
    }
  });
});

describe("updateEvent — cross-field invariants", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("rejects a patch that moves end_time before start_time with 422", async () => {
    // Current row: 2026-04-22 09:00 → 10:00. Patch end_time to 08:00 breaks it.
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { end_time: "08:00" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
      assert.equal(result.error, "invariant_violation");
    }
  });

  it("accepts a patch that shifts both start and end coherently", async () => {
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { start_time: "11:00", end_time: "12:00" },
    });
    assert.equal(result.ok, true);
  });
});

describe("updateEvent — happy path", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns the updated row on a title-only patch", async () => {
    state.updateResult = baseRow({
      title: "Edited title",
      updated_at: "2026-04-21T10:05:00.000Z",
    });
    const result = await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "Edited title" },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.title, "Edited title");
    }
  });

  it("writes the merged row (not the raw patch)", async () => {
    await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "Edited title" },
    });
    assert.ok(state.updatePayload);
    // Patched field
    assert.equal(state.updatePayload!.title, "Edited title");
    // Unpatched fields retain current-row values (re-composed to ISO)
    assert.equal(state.updatePayload!.start_date, "2026-04-22T09:00:00.000Z");
    assert.equal(state.updatePayload!.end_date, "2026-04-22T10:00:00.000Z");
    assert.equal(state.updatePayload!.location, "Gym");
    assert.equal(state.updatePayload!.event_type, "general");
  });

  it("recomposes date+time parts into the stored ISO format on a start_time-only patch", async () => {
    // Current row: start 09:00 → end 10:00. Shift start earlier so the
    // end>start invariant still holds after merge. Verifies the
    // decompose-merge-recompose pipeline carries the date component
    // forward unchanged.
    await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { start_time: "08:00" },
    });
    assert.ok(state.updatePayload);
    // Date component retained from current row; time swapped.
    assert.equal(state.updatePayload!.start_date, "2026-04-22T08:00:00.000Z");
  });

  it("scopes the UPDATE by id, organization_id, and deleted_at IS NULL", async () => {
    await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { title: "Edited" },
    });
    const filterKeys = state.updateFilters.map((f) => `${f.op}:${f.column}`);
    assert.ok(filterKeys.includes("eq:id"));
    assert.ok(filterKeys.includes("eq:organization_id"));
    assert.ok(filterKeys.includes("is:deleted_at"));
  });

  it("promotes is_philanthropy to true when the merged event_type is 'philanthropy'", async () => {
    state.updateResult = baseRow({
      event_type: "philanthropy",
      is_philanthropy: true,
      updated_at: "2026-04-21T10:05:00.000Z",
    });
    await updateEvent({
      supabase: buildStub(state),
      orgId: ORG,
      userId: USER,
      targetId: TARGET,
      patch: { event_type: "philanthropy" },
    });
    assert.ok(state.updatePayload);
    assert.equal(state.updatePayload!.is_philanthropy, true);
    assert.equal(state.updatePayload!.event_type, "philanthropy");
  });
});
