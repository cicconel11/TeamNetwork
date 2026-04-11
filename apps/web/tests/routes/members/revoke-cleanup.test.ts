/**
 * Tests for the trigger behavior of `handle_org_member_sync` when members are revoked.
 *
 * The cleanup (soft-deleting alumni/members/parents records) happens in a PostgreSQL
 * trigger, not in the route handler. The route handler only writes
 * `user_organization_roles.status = 'revoked'`. The trigger then fires and
 * soft-deletes the related records.
 *
 * Since we cannot test actual Postgres triggers in unit tests, these tests:
 * 1. Simulate the PATCH route updating `user_organization_roles`
 * 2. Simulate the trigger side-effects using the supabaseStub
 * 3. Assert the expected final state of all affected rows
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { randomUUID } from "crypto";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Simulate the route handler updating UOR status to 'revoked'.
 * The real route does: supabase.from("user_organization_roles").update({ status }).eq(...).eq(...)
 */
async function simulateRevoke(
  stub: ReturnType<typeof createSupabaseStub>,
  orgId: string,
  userId: string,
): Promise<void> {
  await stub
    .from("user_organization_roles")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("user_id", userId);
}

/**
 * Simulate the route handler updating UOR role (e.g., alumni → active_member).
 */
async function simulateRoleChange(
  stub: ReturnType<typeof createSupabaseStub>,
  orgId: string,
  userId: string,
  newRole: string,
): Promise<void> {
  await stub
    .from("user_organization_roles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("user_id", userId);
}

/**
 * Simulate the `handle_org_member_sync` trigger's cleanup behavior.
 *
 * Trigger logic (pseudo-SQL):
 *   - Always soft-delete members row for the org/user (all roles)
 *   - If NEW.role = 'alumni', soft-delete alumni row
 *   - If NEW.role = 'parent', soft-delete parents row
 *
 * The `deleted_at IS NULL` guard in each UPDATE mirrors the trigger's
 * WHERE clause to prevent double-updating already-deleted rows.
 */
async function simulateRevocationCleanup(
  stub: ReturnType<typeof createSupabaseStub>,
  orgId: string,
  userId: string,
  role: string,
): Promise<void> {
  const now = new Date().toISOString();

  // Alumni cleanup (trigger: IF NEW.role = 'alumni')
  if (role === "alumni") {
    await stub
      .from("alumni")
      .update({ deleted_at: now, updated_at: now })
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("deleted_at", null);
  }

  // Members cleanup (trigger: unconditional for all roles)
  await stub
    .from("members")
    .update({ deleted_at: now, updated_at: now })
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .is("deleted_at", null);

  // Parents cleanup (trigger: IF NEW.role = 'parent')
  if (role === "parent") {
    await stub
      .from("parents")
      .update({ deleted_at: now, updated_at: now })
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("deleted_at", null);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Revoke cleanup trigger — handle_org_member_sync", () => {
  let stub: ReturnType<typeof createSupabaseStub>;
  let orgId: string;
  let userId: string;

  beforeEach(() => {
    stub = createSupabaseStub();
    orgId = randomUUID();
    userId = randomUUID();
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────

  it("revoking alumni role soft-deletes alumni and members records", async () => {
    // Seed: UOR (alumni, active), alumni row, members row — all live
    stub.seed("user_organization_roles", [
      { organization_id: orgId, user_id: userId, role: "alumni", status: "active" },
    ]);
    stub.seed("alumni", [
      { organization_id: orgId, user_id: userId, deleted_at: null },
    ]);
    stub.seed("members", [
      { organization_id: orgId, user_id: userId, deleted_at: null },
    ]);

    // Route: set status = 'revoked'
    await simulateRevoke(stub, orgId, userId);

    // Trigger: cleanup for alumni role
    await simulateRevocationCleanup(stub, orgId, userId, "alumni");

    // Assert UOR is revoked
    const uorRows = stub.getRows("user_organization_roles");
    assert.strictEqual(uorRows.length, 1);
    assert.strictEqual(uorRows[0].status, "revoked");

    // Assert alumni record is soft-deleted
    const alumniRows = stub.getRows("alumni");
    assert.strictEqual(alumniRows.length, 1);
    assert.notStrictEqual(
      alumniRows[0].deleted_at,
      null,
      "alumni.deleted_at should be set after revocation",
    );

    // Assert members record is soft-deleted
    const memberRows = stub.getRows("members");
    assert.strictEqual(memberRows.length, 1);
    assert.notStrictEqual(
      memberRows[0].deleted_at,
      null,
      "members.deleted_at should be set after revocation",
    );
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────

  it("revoking admin role soft-deletes members record only (no alumni row)", async () => {
    // Seed: UOR (admin, active), members row — no alumni row
    stub.seed("user_organization_roles", [
      { organization_id: orgId, user_id: userId, role: "admin", status: "active" },
    ]);
    stub.seed("members", [
      { organization_id: orgId, user_id: userId, deleted_at: null },
    ]);

    // Route: set status = 'revoked'
    await simulateRevoke(stub, orgId, userId);

    // Trigger: cleanup for admin role (no alumni or parents cleanup)
    await simulateRevocationCleanup(stub, orgId, userId, "admin");

    // Assert UOR is revoked
    const uorRows = stub.getRows("user_organization_roles");
    assert.strictEqual(uorRows[0].status, "revoked");

    // Assert members record is soft-deleted
    const memberRows = stub.getRows("members");
    assert.strictEqual(memberRows.length, 1);
    assert.notStrictEqual(
      memberRows[0].deleted_at,
      null,
      "members.deleted_at should be set for admin revocation",
    );

    // Assert no alumni rows exist (none were seeded, none should appear)
    const alumniRows = stub.getRows("alumni");
    assert.strictEqual(alumniRows.length, 0);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────

  it("revoking parent role soft-deletes parents and members records", async () => {
    // Seed: UOR (parent, active), parents row, members row
    stub.seed("user_organization_roles", [
      { organization_id: orgId, user_id: userId, role: "parent", status: "active" },
    ]);
    stub.seed("parents", [
      { organization_id: orgId, user_id: userId, deleted_at: null },
    ]);
    stub.seed("members", [
      { organization_id: orgId, user_id: userId, deleted_at: null },
    ]);

    // Route: set status = 'revoked'
    await simulateRevoke(stub, orgId, userId);

    // Trigger: cleanup for parent role
    await simulateRevocationCleanup(stub, orgId, userId, "parent");

    // Assert UOR is revoked
    const uorRows = stub.getRows("user_organization_roles");
    assert.strictEqual(uorRows[0].status, "revoked");

    // Assert parents record is soft-deleted
    const parentsRows = stub.getRows("parents");
    assert.strictEqual(parentsRows.length, 1);
    assert.notStrictEqual(
      parentsRows[0].deleted_at,
      null,
      "parents.deleted_at should be set after revocation",
    );

    // Assert members record is soft-deleted
    const memberRows = stub.getRows("members");
    assert.strictEqual(memberRows.length, 1);
    assert.notStrictEqual(
      memberRows[0].deleted_at,
      null,
      "members.deleted_at should be set after revocation",
    );
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────

  it("role change away from alumni soft-deletes alumni record but leaves members active", async () => {
    // Seed: UOR (alumni, active), alumni row, members row
    stub.seed("user_organization_roles", [
      { organization_id: orgId, user_id: userId, role: "alumni", status: "active" },
    ]);
    stub.seed("alumni", [
      { organization_id: orgId, user_id: userId, deleted_at: null },
    ]);
    stub.seed("members", [
      { organization_id: orgId, user_id: userId, deleted_at: null },
    ]);

    // Route: change role from alumni → active_member (not a revocation)
    await simulateRoleChange(stub, orgId, userId, "active_member");

    // This scenario triggers section 4 of the SQL trigger (role change, not revocation).
    // simulateRevocationCleanup is intentionally not used here — it models the
    // status='revoked' path which unconditionally soft-deletes members. For a role
    // change, only the alumni record is cleaned up (IF OLD.role = 'alumni' branch).
    await stub
      .from("alumni")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("deleted_at", null);

    // Assert UOR role updated
    const uorRows = stub.getRows("user_organization_roles");
    assert.strictEqual(uorRows[0].role, "active_member");

    // Assert alumni record is soft-deleted
    const alumniRows = stub.getRows("alumni");
    assert.strictEqual(alumniRows.length, 1);
    assert.notStrictEqual(
      alumniRows[0].deleted_at,
      null,
      "alumni.deleted_at should be set when role changes away from alumni",
    );

    // Assert members row is still active (no revocation, no members cleanup)
    const memberRows = stub.getRows("members");
    assert.strictEqual(memberRows.length, 1);
    assert.strictEqual(
      memberRows[0].deleted_at,
      null,
      "members.deleted_at should remain null — user is still active in the org",
    );
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────

  it("trigger recursion guard — already-deleted records are not double-updated", async () => {
    const existingDeletedAt = "2024-01-01T00:00:00.000Z";

    // Seed: alumni row already soft-deleted
    stub.seed("alumni", [
      { organization_id: orgId, user_id: userId, deleted_at: existingDeletedAt },
    ]);

    // Trigger attempts soft-delete with `deleted_at IS NULL` guard — should match 0 rows
    const result = await stub
      .from("alumni")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("deleted_at", null);

    // The update builder returns the matched rows; already-deleted row must not be touched
    const alumniRows = stub.getRows("alumni");
    assert.strictEqual(alumniRows.length, 1);
    assert.strictEqual(
      alumniRows[0].deleted_at,
      existingDeletedAt,
      "deleted_at should not be overwritten — IS NULL guard prevents double-update",
    );

    // Confirm the result carries no matched rows (stub returns [] for 0-match update)
    assert.ok(result, "update builder returned a value");
    // The resolved data from the thenable reflects the 0 matched rows
    const resolved = await new Promise<{ data: unknown[] | null; error: unknown }>((resolve) => {
      (stub.from("alumni")
        .update({ deleted_at: new Date().toISOString() })
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .is("deleted_at", null) as unknown as PromiseLike<{ data: unknown[] | null; error: unknown }>)
        .then(resolve);
    });

    assert.strictEqual(
      Array.isArray(resolved.data) ? resolved.data.length : 0,
      0,
      "0 rows should be matched when deleted_at IS NULL guard is applied to already-deleted row",
    );
  });
});
