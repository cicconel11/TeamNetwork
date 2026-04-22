import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { softDeleteAnnouncement } from "@/lib/announcements/soft-delete-announcement";

// ─── Minimal Supabase stub ──────────────────────────────────────────────
// softDeleteAnnouncement touches user_organization_roles (via getOrgMembership)
// and announcements (fetch + UPDATE SET deleted_at). This stub routes those
// two and captures every filter + payload for assertion.

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
  updateResult: AnnouncementRow | null;
  updatePayload: Record<string, unknown> | null;
  updateFilters: Array<{ op: string; column: string; value: unknown }>;
}

type StubSelectChain = {
  eq: (column: string, value: unknown) => StubSelectChain;
  is: (column: string, value: null) => StubSelectChain;
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
  const announcementSelectChain = (): StubSelectChain => {
    const chain: StubSelectChain = {
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
  } as unknown as Parameters<typeof softDeleteAnnouncement>[0]["supabase"];
}

function baseRow(overrides: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: "00000000-0000-4000-8000-000000000011",
    organization_id: "00000000-0000-4000-8000-000000000022",
    title: "Original title",
    body: "Original body",
    is_pinned: false,
    audience: "all",
    audience_user_ids: null,
    updated_at: "2026-04-22T09:00:00.000Z",
    deleted_at: null,
    created_by_user_id: "00000000-0000-4000-8000-000000000033",
    created_at: "2026-04-20T08:00:00.000Z",
    published_at: "2026-04-20T08:00:00.000Z",
    ...overrides,
  };
}

function freshState(): StubState {
  return {
    membership: { role: "admin" },
    announcement: baseRow(),
    fetchError: null,
    updateError: null,
    updateResult: baseRow({
      deleted_at: "2026-04-22T09:05:00.000Z",
      updated_at: "2026-04-22T09:05:00.000Z",
    }),
    updatePayload: null,
    updateFilters: [],
  };
}

const orgId = "00000000-0000-4000-8000-000000000022";
const userId = "00000000-0000-4000-8000-000000000033";
const targetId = "00000000-0000-4000-8000-000000000011";

// ─── Tests ──────────────────────────────────────────────────────────────

describe("softDeleteAnnouncement — permission check", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 403 forbidden when caller is not an admin", async () => {
    state.membership = { role: "active_member" };
    const result = await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.equal(result.error, "forbidden");
    }
  });

  it("returns 403 forbidden when caller is not a member at all", async () => {
    state.membership = null;
    const result = await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
    }
  });
});

describe("softDeleteAnnouncement — target lookup", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 404 not_found when the announcement does not exist or is already deleted", async () => {
    state.announcement = null;
    const result = await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 404);
      assert.equal(result.error, "not_found");
    }
  });
});

describe("softDeleteAnnouncement — optimistic concurrency", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns 409 stale_version when expectedUpdatedAt does not match current", async () => {
    const result = await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
      expectedUpdatedAt: "2026-04-22T08:00:00.000Z", // older than current
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, "stale_version");
    }
  });

  it("adds an updated_at eq filter to the UPDATE when expectedUpdatedAt is supplied", async () => {
    await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
      expectedUpdatedAt: "2026-04-22T09:00:00.000Z",
    });
    const updatedAtFilter = state.updateFilters.find(
      (f) => f.op === "eq" && f.column === "updated_at"
    );
    assert.ok(updatedAtFilter, "UPDATE must include eq on updated_at when stamp supplied");
    assert.equal(updatedAtFilter!.value, "2026-04-22T09:00:00.000Z");
  });

  it("does not add updated_at filter when expectedUpdatedAt is absent", async () => {
    await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    const updatedAtFilter = state.updateFilters.find(
      (f) => f.op === "eq" && f.column === "updated_at"
    );
    assert.equal(updatedAtFilter, undefined);
  });

  it("returns 409 stale_version when the UPDATE affects zero rows", async () => {
    state.updateResult = null;
    const result = await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, "stale_version");
    }
  });
});

describe("softDeleteAnnouncement — write shape", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("writes deleted_at as an ISO timestamp", async () => {
    const before = Date.now();
    await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    const after = Date.now();

    assert.ok(state.updatePayload);
    const deletedAtValue = state.updatePayload!.deleted_at;
    assert.equal(typeof deletedAtValue, "string");
    const deletedAtMs = Date.parse(deletedAtValue as string);
    assert.ok(
      deletedAtMs >= before && deletedAtMs <= after,
      `deleted_at ${deletedAtValue} should fall between [${new Date(before).toISOString()}, ${new Date(after).toISOString()}]`
    );
  });

  it("writes updated_at as an ISO timestamp matching deleted_at", async () => {
    await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    assert.ok(state.updatePayload);
    assert.equal(
      state.updatePayload!.updated_at,
      state.updatePayload!.deleted_at,
      "deleted_at and updated_at should agree — the row changed at this instant"
    );
  });

  it("scopes the UPDATE by id, organization_id, and deleted_at IS NULL", async () => {
    await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    const filterKeys = state.updateFilters.map((f) => `${f.op}:${f.column}`);
    assert.ok(filterKeys.includes("eq:id"));
    assert.ok(filterKeys.includes("eq:organization_id"));
    assert.ok(
      filterKeys.includes("is:deleted_at"),
      "deleted_at IS NULL scoping makes the delete idempotent against concurrent deletes"
    );
  });

  it("does not mutate any non-delete fields", async () => {
    await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    assert.ok(state.updatePayload);
    const payloadKeys = Object.keys(state.updatePayload!).sort();
    assert.deepEqual(
      payloadKeys,
      ["deleted_at", "updated_at"],
      "soft-delete must not touch title/body/audience/etc"
    );
  });
});

describe("softDeleteAnnouncement — happy path", () => {
  let state: StubState;
  beforeEach(() => {
    state = freshState();
  });

  it("returns the deleted row on success", async () => {
    const result = await softDeleteAnnouncement({
      supabase: buildStub(state),
      orgId,
      userId,
      targetId,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.id, targetId);
      assert.ok(result.value.deleted_at, "returned row must have deleted_at populated");
    }
  });
});
