import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { updateAnnouncement } from "@/lib/announcements/update-announcement";

// ─── Minimal Supabase stub ──────────────────────────────────────────────
// updateAnnouncement touches exactly two tables: user_organization_roles
// (via getOrgMembership) and announcements. This stub routes those two and
// records every filter call so tests can assert the exact query shape.

type AnnouncementRow = {
  id: string;
  organization_id: string;
  title: string;
  body: string | null;
  is_pinned: boolean | null;
  audience: string;
  audience_user_ids: string[] | null;
  updated_at: string;
  deleted_at: string | null;
  created_by_user_id: string;
  created_at: string;
  published_at: string | null;
};

interface StubState {
  membership: { role: string } | null;
  announcement: AnnouncementRow | null;
  fetchError: { message: string } | null;
  updateError: { message: string } | null;
  /** Rows returned by the UPDATE (maybeSingle). null = 0 rows, row = 1 row. */
  updateResult: AnnouncementRow | null;
  /** Captured arguments to the UPDATE call. */
  updatePayload: Record<string, unknown> | null;
  /** Captured WHERE-clause filters on the UPDATE query. */
  updateFilters: Array<{ op: string; column: string; value: unknown }>;
}

// Shape-of-stub is deliberately loose — matches the subset of the Supabase
// client that updateAnnouncement actually calls. Casting at the boundary lets
// tests stay focused.
type StubChain = {
  eq: (column: string, value: unknown) => StubChain;
  is: (column: string, value: null) => StubChain;
  maybeSingle: () => Promise<{
    data: AnnouncementRow | null;
    error: { message: string } | null;
  }>;
};

type StubUpdateChain = {
  eq: (column: string, value: unknown) => StubUpdateChain;
  is: (column: string, value: null) => StubUpdateChain;
  select: () => {
    maybeSingle: () => Promise<{
      data: AnnouncementRow | null;
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
  const announcementSelectChain = (): StubChain => {
    const chain: StubChain = {
      eq: () => chain,
      is: () => chain,
      maybeSingle: async () => ({
        data: state.announcement,
        error: state.fetchError,
      }),
    };
    return chain;
  };

  const announcementUpdateChain = (): StubUpdateChain => {
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
      if (table === "announcements") {
        return {
          select: () => announcementSelectChain(),
          update: (payload: Record<string, unknown>) => {
            state.updatePayload = payload;
            return announcementUpdateChain();
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as Parameters<typeof updateAnnouncement>[0]["supabase"];
}

function baseRow(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: "00000000-0000-0000-0000-0000000000a1",
    organization_id: "00000000-0000-0000-0000-0000000000b1",
    title: "Original title",
    body: "Original body",
    is_pinned: false,
    audience: "all",
    audience_user_ids: null,
    updated_at: "2026-04-21T10:00:00.000Z",
    deleted_at: null,
    created_by_user_id: "00000000-0000-0000-0000-0000000000c1",
    created_at: "2026-04-20T09:00:00.000Z",
    published_at: "2026-04-20T09:00:00.000Z",
    ...overrides,
  };
}

function freshState(): StubState {
  return {
    membership: { role: "admin" },
    announcement: baseRow(),
    fetchError: null,
    updateError: null,
    updateResult: baseRow({ title: "New title", updated_at: "2026-04-21T10:05:00.000Z" }),
    updatePayload: null,
    updateFilters: [],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("updateAnnouncement — input validation", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("rejects an empty patch with 400 empty_patch", async () => {
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: {},
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, "empty_patch");
    }
  });

  it("rejects a malformed patch with 400 invalid_patch", async () => {
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      // Title over 200 chars violates safeString(200).
      patch: { title: "a".repeat(201) },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.equal(result.error, "invalid_patch");
    }
  });
});

describe("updateAnnouncement — permission check", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 403 forbidden when caller is not an admin", async () => {
    state.membership = { role: "active_member" };
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
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
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "New" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
    }
  });
});

describe("updateAnnouncement — target lookup", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 404 not_found when the announcement does not exist", async () => {
    state.announcement = null;
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "New" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 404);
      assert.equal(result.error, "not_found");
    }
  });
});

describe("updateAnnouncement — optimistic concurrency", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 409 stale_version when expectedUpdatedAt does not match current", async () => {
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "New" },
      expectedUpdatedAt: "2026-04-21T09:00:00.000Z", // older than current
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, "stale_version");
    }
  });

  it("proceeds when expectedUpdatedAt matches current", async () => {
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "New title" },
      expectedUpdatedAt: "2026-04-21T10:00:00.000Z",
    });
    assert.equal(result.ok, true);
  });

  it("adds the updated_at filter to the UPDATE when expectedUpdatedAt is supplied", async () => {
    await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "New title" },
      expectedUpdatedAt: "2026-04-21T10:00:00.000Z",
    });
    const updatedAtFilter = state.updateFilters.find(
      (f) => f.op === "eq" && f.column === "updated_at"
    );
    assert.ok(updatedAtFilter, "UPDATE must include an eq filter on updated_at when expected stamp supplied");
    assert.equal(updatedAtFilter!.value, "2026-04-21T10:00:00.000Z");
  });

  it("does not add updated_at filter when expectedUpdatedAt is absent", async () => {
    await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "New title" },
    });
    const updatedAtFilter = state.updateFilters.find(
      (f) => f.op === "eq" && f.column === "updated_at"
    );
    assert.equal(updatedAtFilter, undefined);
  });

  it("returns 409 stale_version when the UPDATE affects zero rows", async () => {
    state.updateResult = null; // zero rows
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "New title" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, "stale_version");
    }
  });
});

describe("updateAnnouncement — cross-field invariants", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("rejects audience='individuals' patch when the merged row has no audience_user_ids", async () => {
    // Current row has audience='all', audience_user_ids=null.
    // Patching audience→individuals without supplying ids breaks the invariant.
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { audience: "individuals" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 422);
      assert.equal(result.error, "invariant_violation");
    }
  });

  it("accepts audience='individuals' patch when audience_user_ids are also supplied", async () => {
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: {
        audience: "individuals",
        audience_user_ids: ["00000000-0000-4000-8000-000000000001"],
      },
    });
    assert.equal(result.ok, true);
  });

  it("nulls audience_user_ids on the write when patching audience away from individuals", async () => {
    state.announcement = baseRow({
      audience: "individuals",
      audience_user_ids: ["00000000-0000-4000-8000-000000000001"],
    });
    state.updateResult = baseRow({
      audience: "all",
      audience_user_ids: null,
      updated_at: "2026-04-21T10:05:00.000Z",
    });
    await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { audience: "all" },
    });
    assert.ok(state.updatePayload);
    assert.equal(state.updatePayload!.audience, "all");
    assert.equal(
      state.updatePayload!.audience_user_ids,
      null,
      "audience_user_ids must be nulled when leaving 'individuals' audience"
    );
  });
});

describe("updateAnnouncement — happy path", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns the updated row on a title-only patch", async () => {
    state.updateResult = baseRow({
      title: "Edited title",
      updated_at: "2026-04-21T10:05:00.000Z",
    });
    const result = await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "Edited title" },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.title, "Edited title");
      assert.equal(result.value.updated_at, "2026-04-21T10:05:00.000Z");
    }
  });

  it("writes the merged row (not the raw patch)", async () => {
    await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "Edited title" },
    });
    assert.ok(state.updatePayload);
    // Patched field
    assert.equal(state.updatePayload!.title, "Edited title");
    // Unpatched fields retain current-row values
    assert.equal(state.updatePayload!.is_pinned, false);
    assert.equal(state.updatePayload!.audience, "all");
  });

  it("scopes the UPDATE by id, organization_id, and deleted_at IS NULL", async () => {
    await updateAnnouncement({
      supabase: buildStub(state),
      orgId: "00000000-0000-0000-0000-0000000000b1",
      userId: "00000000-0000-0000-0000-0000000000c1",
      targetId: "00000000-0000-0000-0000-0000000000a1",
      patch: { title: "Edited" },
    });
    const filterKeys = state.updateFilters.map(
      (f) => `${f.op}:${f.column}`
    );
    assert.ok(filterKeys.includes("eq:id"));
    assert.ok(filterKeys.includes("eq:organization_id"));
    assert.ok(filterKeys.includes("is:deleted_at"));
  });
});
