import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import {
  AuthPresets,
  type AuthContext,
} from "../../utils/authMock.ts";

/**
 * Tests for POST /api/organizations/[organizationId]/alumni/bulk-delete
 *
 * Simulates the route handler logic against a SupabaseStub to validate:
 * - Request validation (UUID format, array bounds)
 * - Auth + admin role check
 * - Org-scoped soft-delete semantics (deleted_at, not hard delete)
 * - createdRecords → deletedIds round-trip
 * - Cross-org isolation
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface BulkDeleteRequest {
  auth: AuthContext;
  organizationId: string;
  alumniIds: string[];
  isReadOnly?: boolean;
}

interface BulkDeleteResult {
  status: number;
  error?: string;
  deleted?: number;
  deletedIds?: string[];
}

// ─── Simulation ─────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function simulateBulkDelete(
  supabase: ReturnType<typeof createSupabaseStub>,
  req: BulkDeleteRequest,
): BulkDeleteResult {
  // 1. Validate organizationId
  if (!UUID_REGEX.test(req.organizationId)) {
    return { status: 400, error: "Invalid organization ID" };
  }

  // 2. Auth check
  if (!req.auth.user) {
    return { status: 401, error: "Unauthorized" };
  }

  // 3. Admin role check — query user_organization_roles
  const roleRows = supabase.getRows("user_organization_roles").filter(
    (r) =>
      r.user_id === req.auth.user!.id &&
      r.organization_id === req.organizationId &&
      r.status === "active",
  );
  if (!roleRows.length || roleRows[0].role !== "admin") {
    return { status: 403, error: "Only admins can bulk-delete alumni" };
  }

  // 4. Read-only check
  if (req.isReadOnly) {
    return { status: 403, error: "Organization is in read-only mode" };
  }

  // 5. Validate body
  if (!Array.isArray(req.alumniIds) || req.alumniIds.length === 0) {
    return { status: 400, error: "alumniIds must have at least 1 item" };
  }
  if (req.alumniIds.length > 500) {
    return { status: 400, error: "alumniIds must have at most 500 items" };
  }
  for (const id of req.alumniIds) {
    if (!UUID_REGEX.test(id)) {
      return { status: 400, error: `Invalid UUID: ${id}` };
    }
  }

  // 6. Soft-delete: set deleted_at on matching alumni within this org
  const now = new Date().toISOString();
  const allAlumni = supabase.getRows("alumni");
  const deletedIds: string[] = [];

  for (const alum of allAlumni) {
    if (
      req.alumniIds.includes(alum.id as string) &&
      alum.organization_id === req.organizationId &&
      (alum.deleted_at === null || alum.deleted_at === undefined)
    ) {
      // Perform soft delete via stub
      deletedIds.push(alum.id as string);
    }
  }

  // Actually apply the update via the stub
  if (deletedIds.length > 0) {
    for (const id of deletedIds) {
      supabase
        .from("alumni")
        .update({ deleted_at: now })
        .eq("id", id)
        .eq("organization_id", req.organizationId)
        .is("deleted_at", null);
    }
  }

  return {
    status: 200,
    deleted: deletedIds.length,
    deletedIds,
  };
}

// ─── Test helpers ───────────────────────────────────────────────────────────

const ORG_ID = randomUUID();
const OTHER_ORG_ID = randomUUID();

function seedAdminRole(supabase: ReturnType<typeof createSupabaseStub>, userId: string) {
  supabase.seed("user_organization_roles", [
    { user_id: userId, organization_id: ORG_ID, role: "admin", status: "active" },
  ]);
}

function seedAlumni(
  supabase: ReturnType<typeof createSupabaseStub>,
  overrides: Array<{ id?: string; organization_id?: string; deleted_at?: string | null }>,
) {
  const rows = overrides.map((o) => ({
    id: o.id ?? randomUUID(),
    organization_id: o.organization_id ?? ORG_ID,
    first_name: "Test",
    last_name: "Alumni",
    email: `${randomUUID()}@test.com`,
    deleted_at: o.deleted_at ?? null,
  }));
  supabase.seed("alumni", rows);
  return rows;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("alumni bulk-delete: validation", () => {
  it("rejects invalid organizationId (not UUID)", () => {
    const supabase = createSupabaseStub();
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: "bad-org-id",
      alumniIds: [randomUUID()],
    });
    assert.equal(result.status, 400);
    assert.match(result.error!, /Invalid organization ID/);
  });

  it("rejects empty alumniIds array (min 1)", () => {
    const supabase = createSupabaseStub();
    seedAdminRole(supabase, "admin-user");
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [],
    });
    assert.equal(result.status, 400);
  });

  it("rejects arrays exceeding 500 items (max 500)", () => {
    const supabase = createSupabaseStub();
    seedAdminRole(supabase, "admin-user");
    const ids = Array.from({ length: 501 }, () => randomUUID());
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: ids,
    });
    assert.equal(result.status, 400);
  });

  it("rejects non-UUID values in alumniIds", () => {
    const supabase = createSupabaseStub();
    seedAdminRole(supabase, "admin-user");
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: ["not-a-uuid"],
    });
    assert.equal(result.status, 400);
  });
});

describe("alumni bulk-delete: auth & authorization", () => {
  it("returns 401 for unauthenticated request", () => {
    const supabase = createSupabaseStub();
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.unauthenticated,
      organizationId: ORG_ID,
      alumniIds: [randomUUID()],
    });
    assert.equal(result.status, 401);
  });

  it("returns 403 for non-admin role (active_member)", () => {
    const supabase = createSupabaseStub();
    supabase.seed("user_organization_roles", [
      { user_id: "member-user", organization_id: ORG_ID, role: "active_member", status: "active" },
    ]);
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgMember(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [randomUUID()],
    });
    assert.equal(result.status, 403);
  });

  it("returns 403 for alumni role", () => {
    const supabase = createSupabaseStub();
    supabase.seed("user_organization_roles", [
      { user_id: "alumni-user", organization_id: ORG_ID, role: "alumni", status: "active" },
    ]);
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAlumni(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [randomUUID()],
    });
    assert.equal(result.status, 403);
  });

  it("returns 403 for read-only org", () => {
    const supabase = createSupabaseStub();
    seedAdminRole(supabase, "admin-user");
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [randomUUID()],
      isReadOnly: true,
    });
    assert.equal(result.status, 403);
  });

  it("allows admin in non-read-only org", () => {
    const supabase = createSupabaseStub();
    seedAdminRole(supabase, "admin-user");
    const alumni = seedAlumni(supabase, [{}]);
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [alumni[0].id],
    });
    assert.equal(result.status, 200);
    assert.equal(result.deleted, 1);
  });
});

describe("alumni bulk-delete: soft-delete semantics", () => {
  let supabase: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    supabase = createSupabaseStub();
    seedAdminRole(supabase, "admin-user");
  });

  it("soft-deletes matching alumni (sets deleted_at, not hard delete)", () => {
    const alumni = seedAlumni(supabase, [{ id: randomUUID() }, { id: randomUUID() }]);
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: alumni.map((a) => a.id),
    });

    assert.equal(result.status, 200);
    assert.equal(result.deleted, 2);
    assert.deepEqual(result.deletedIds!.sort(), alumni.map((a) => a.id).sort());

    // Verify rows still exist in storage (not hard-deleted)
    const rows = supabase.getRows("alumni");
    assert.equal(rows.length, 2);
  });

  it("skips already soft-deleted alumni", () => {
    const alreadyDeleted = randomUUID();
    seedAlumni(supabase, [
      { id: alreadyDeleted, deleted_at: new Date().toISOString() },
    ]);

    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [alreadyDeleted],
    });

    assert.equal(result.status, 200);
    assert.equal(result.deleted, 0);
    assert.deepEqual(result.deletedIds, []);
  });

  it("scopes delete to organization_id — ignores alumni from other orgs", () => {
    const myAlumni = seedAlumni(supabase, [{}]);
    const otherAlumni = seedAlumni(supabase, [{ organization_id: OTHER_ORG_ID }]);

    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [myAlumni[0].id, otherAlumni[0].id],
    });

    assert.equal(result.status, 200);
    assert.equal(result.deleted, 1);
    assert.deepEqual(result.deletedIds, [myAlumni[0].id]);
  });

  it("returns actual deletedIds (not the requested IDs)", () => {
    const existing = seedAlumni(supabase, [{}]);
    const nonExistent = randomUUID();

    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [existing[0].id, nonExistent],
    });

    assert.equal(result.deleted, 1);
    assert.deepEqual(result.deletedIds, [existing[0].id]);
    assert.ok(!result.deletedIds!.includes(nonExistent));
  });
});

describe("bulk import → bulk delete round-trip", () => {
  it("createdRecords IDs can be passed to bulk-delete", () => {
    const supabase = createSupabaseStub();
    seedAdminRole(supabase, "admin-user");

    // Simulate import creating records
    const createdRecords = [
      { id: randomUUID(), email: "a@test.com", firstName: "Alice", lastName: "Smith" },
      { id: randomUUID(), firstName: "Bob", lastName: "Jones" },
    ];

    // Seed them as alumni
    seedAlumni(
      supabase,
      createdRecords.map((r) => ({ id: r.id })),
    );

    // Bulk delete all created records
    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: createdRecords.map((r) => r.id),
    });

    assert.equal(result.status, 200);
    assert.equal(result.deleted, 2);
    assert.deepEqual(result.deletedIds!.sort(), createdRecords.map((r) => r.id).sort());
  });

  it("handles partial delete (some already deleted by another user)", () => {
    const supabase = createSupabaseStub();
    seedAdminRole(supabase, "admin-user");

    const id1 = randomUUID();
    const id2 = randomUUID();
    seedAlumni(supabase, [
      { id: id1 },
      { id: id2, deleted_at: new Date().toISOString() },
    ]);

    const result = simulateBulkDelete(supabase, {
      auth: AuthPresets.orgAdmin(ORG_ID),
      organizationId: ORG_ID,
      alumniIds: [id1, id2],
    });

    assert.equal(result.deleted, 1);
    assert.deepEqual(result.deletedIds, [id1]);
  });

  it("quota_exceeded rows (null out_id) are excluded from createdRecords", () => {
    // This tests the import-side contract, not the delete route itself
    const rpcRows = [
      { out_id: randomUUID(), out_email: "a@test.com", out_first_name: "A", out_last_name: "B", out_status: "created" },
      { out_id: null, out_email: "blocked@test.com", out_first_name: "C", out_last_name: "D", out_status: "quota_exceeded" },
    ];

    const createdRecords = rpcRows
      .filter((r) => r.out_status === "created" && r.out_id)
      .map((r) => ({ id: r.out_id!, email: r.out_email || undefined, firstName: r.out_first_name, lastName: r.out_last_name }));

    assert.equal(createdRecords.length, 1);
    assert.ok(createdRecords[0].id);
  });
});
