import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  transitionToAlumni,
  revokeMemberAccess,
  reinstateToActiveMember,
  getMembersToReinstate,
  getGraduationDryRun,
  getMembersPastGraduation,
} from "../src/lib/graduation/queries.ts";

/**
 * Graduation Date Mover tests.
 *
 * These tests verify the transactional RPC-based graduation lifecycle:
 * - Active → Alumni transition
 * - Active → Revoked (quota exceeded)
 * - Alumni → Active reverse flow (graduation date moved forward)
 * - Admin skip, idempotency, dry-run
 */

// Helper to create a stub with standard RPC handlers that simulate
// the PostgreSQL RPC functions defined in the migration.
function createStubWithRpcs() {
  const stub = createSupabaseStub();

  stub.registerRpc(
    "transition_member_to_alumni",
    (params: Record<string, unknown>) => {
      const memberId = params.p_member_id as string;
      const userId = params.p_user_id as string;
      const orgId = params.p_org_id as string;

      // Find role row
      const roles = stub.getRows("user_organization_roles");
      const roleRow = roles.find(
        (r) => r.user_id === userId && r.organization_id === orgId
      );
      if (!roleRow) return { success: false, error: "Role row not found" };

      // Guard: skip admins
      if (roleRow.role === "admin") {
        return { success: false, skipped: true, error: "Admin members are not graduated" };
      }

      // Guard: skip already-graduated
      const members = stub.getRows("members");
      const member = members.find((m) => m.id === memberId);
      if (member?.graduated_at) {
        return { success: true, skipped: true };
      }

      // Guard: check alumni quota (simplified: check capacity via org subscription)
      const subs = stub.getRows("organization_subscriptions");
      const sub = subs.find((s) => s.organization_id === orgId);
      if (sub?.alumni_bucket === "none") {
        return { success: false, error: "Alumni quota exceeded" };
      }

      // Apply transition atomically via stub
      stub.from("user_organization_roles" as never)
        .update({ role: "alumni" } as never)
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();

      stub.from("members" as never)
        .update({ graduated_at: new Date().toISOString() } as never)
        .eq("id", memberId)
        .maybeSingle();

      return { success: true };
    }
  );

  stub.registerRpc(
    "reinstate_alumni_to_active",
    (params: Record<string, unknown>) => {
      const memberId = params.p_member_id as string;
      const userId = params.p_user_id as string;
      const orgId = params.p_org_id as string;
      const status = (params.p_status as string) || "active";

      const roles = stub.getRows("user_organization_roles");
      const roleRow = roles.find(
        (r) => r.user_id === userId && r.organization_id === orgId
      );
      if (!roleRow) return { success: false, error: "Role row not found" };

      if (roleRow.role === "admin") {
        return { success: false, skipped: true, error: "Admin members cannot be reinstated" };
      }

      if (roleRow.role === "active_member") {
        return { success: true, skipped: true };
      }

      // Apply reinstatement atomically
      stub.from("members" as never)
        .update({ graduated_at: null, graduation_warning_sent_at: null } as never)
        .eq("id", memberId)
        .maybeSingle();

      stub.from("user_organization_roles" as never)
        .update({ role: "active_member", status } as never)
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();

      stub.from("alumni" as never)
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();

      return { success: true };
    }
  );

  stub.registerRpc(
    "revoke_graduated_member",
    (params: Record<string, unknown>) => {
      const memberId = params.p_member_id as string;
      const userId = params.p_user_id as string;
      const orgId = params.p_org_id as string;

      const roles = stub.getRows("user_organization_roles");
      const roleRow = roles.find(
        (r) => r.user_id === userId && r.organization_id === orgId
      );
      if (!roleRow) return { success: false, error: "Role row not found" };

      if (roleRow.role === "admin") {
        return { success: false, skipped: true, error: "Admin members are not revoked" };
      }

      const members = stub.getRows("members");
      const member = members.find((m) => m.id === memberId);
      if (member?.graduated_at) {
        return { success: true, skipped: true };
      }

      // Apply revocation atomically
      stub.from("user_organization_roles" as never)
        .update({ status: "revoked" } as never)
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();

      stub.from("members" as never)
        .update({ graduated_at: new Date().toISOString() } as never)
        .eq("id", memberId)
        .maybeSingle();

      return { success: true };
    }
  );

  return stub;
}

// Date helpers
function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split("T")[0];
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

describe("Graduation Date Mover", () => {
  let stub: ReturnType<typeof createStubWithRpcs>;

  beforeEach(() => {
    stub = createStubWithRpcs();
  });

  describe("Active → Alumni transition", () => {
    it("transitions member with past graduation date to alumni", async () => {
      stub.seed("members", [{
        id: "m1",
        user_id: "u1",
        organization_id: "org1",
        expected_graduation_date: pastDate(5),
        graduated_at: null,
        deleted_at: null,
      }]);
      stub.seed("user_organization_roles", [{
        user_id: "u1",
        organization_id: "org1",
        role: "active_member",
        status: "active",
      }]);
      stub.seed("organization_subscriptions", [{
        organization_id: "org1",
        alumni_bucket: "0-250",
      }]);

      const result = await transitionToAlumni(stub as never, "m1", "u1", "org1");

      assert.strictEqual(result.success, true, "Transition should succeed");
      assert.strictEqual(result.skipped, undefined, "Should not be skipped");

      const roles = stub.getRows("user_organization_roles");
      assert.strictEqual(roles[0].role, "alumni", "Role should be alumni");

      const members = stub.getRows("members");
      assert.ok(members[0].graduated_at, "graduated_at should be set");
    });
  });

  describe("Idempotency", () => {
    it("returns skipped: true when transition is called twice", async () => {
      stub.seed("members", [{
        id: "m1",
        user_id: "u1",
        organization_id: "org1",
        expected_graduation_date: pastDate(5),
        graduated_at: null,
        deleted_at: null,
      }]);
      stub.seed("user_organization_roles", [{
        user_id: "u1",
        organization_id: "org1",
        role: "active_member",
        status: "active",
      }]);
      stub.seed("organization_subscriptions", [{
        organization_id: "org1",
        alumni_bucket: "0-250",
      }]);

      // First call
      const result1 = await transitionToAlumni(stub as never, "m1", "u1", "org1");
      assert.strictEqual(result1.success, true);

      // Second call — already graduated
      const result2 = await transitionToAlumni(stub as never, "m1", "u1", "org1");
      assert.strictEqual(result2.success, true);
      assert.strictEqual(result2.skipped, true, "Second transition should be skipped");
    });
  });

  describe("Alumni → Active reverse flow", () => {
    it("reinstates member with future expected_graduation_date", async () => {
      stub.seed("members", [{
        id: "m1",
        user_id: "u1",
        organization_id: "org1",
        expected_graduation_date: futureDate(30),
        graduated_at: "2026-01-01T00:00:00Z",
        graduation_warning_sent_at: "2025-12-01T00:00:00Z",
        deleted_at: null,
      }]);
      stub.seed("user_organization_roles", [{
        user_id: "u1",
        organization_id: "org1",
        role: "alumni",
        status: "active",
      }]);
      stub.seed("alumni", [{
        user_id: "u1",
        organization_id: "org1",
        deleted_at: null,
      }]);

      // Verify getMembersToReinstate finds this member
      const toReinstate = await getMembersToReinstate(stub as never);
      assert.strictEqual(toReinstate.length, 1, "Should find 1 member to reinstate");
      assert.strictEqual(toReinstate[0].id, "m1");

      // Perform reinstatement
      const result = await reinstateToActiveMember(stub as never, "m1", "u1", "org1", "active");
      assert.strictEqual(result.success, true);

      const members = stub.getRows("members");
      assert.strictEqual(members[0].graduated_at, null, "graduated_at should be cleared");
      assert.strictEqual(members[0].graduation_warning_sent_at, null, "warning should be cleared");

      const roles = stub.getRows("user_organization_roles");
      assert.strictEqual(roles[0].role, "active_member", "Role should be active_member");
      assert.strictEqual(roles[0].status, "active", "Status should be active (cron path)");

      const alumni = stub.getRows("alumni");
      assert.ok(alumni[0].deleted_at, "Alumni record should be soft-deleted");
    });
  });

  describe("Admin skip", () => {
    it("does not graduate admin members", async () => {
      stub.seed("members", [{
        id: "m1",
        user_id: "u1",
        organization_id: "org1",
        expected_graduation_date: pastDate(5),
        graduated_at: null,
        deleted_at: null,
      }]);
      stub.seed("user_organization_roles", [{
        user_id: "u1",
        organization_id: "org1",
        role: "admin",
        status: "active",
      }]);
      stub.seed("organization_subscriptions", [{
        organization_id: "org1",
        alumni_bucket: "0-250",
      }]);

      const result = await transitionToAlumni(stub as never, "m1", "u1", "org1");

      assert.strictEqual(result.success, false, "Should not succeed for admins");
      assert.strictEqual(result.skipped, true, "Should be skipped");
      assert.ok(result.error?.includes("Admin"), "Error should mention admin");

      // State should be unchanged
      const roles = stub.getRows("user_organization_roles");
      assert.strictEqual(roles[0].role, "admin", "Role should remain admin");
      const members = stub.getRows("members");
      assert.strictEqual(members[0].graduated_at, null, "graduated_at should remain null");
    });
  });

  describe("No user_id skip", () => {
    it("members without user_id appear in past graduation but are skipped in cron loop", async () => {
      stub.seed("members", [{
        id: "m1",
        user_id: null,
        organization_id: "org1",
        expected_graduation_date: pastDate(5),
        graduated_at: null,
        deleted_at: null,
      }]);

      // getMembersPastGraduation returns all past-graduation members (even without user_id)
      const pastMembers = await getMembersPastGraduation(stub as never);
      assert.strictEqual(pastMembers.length, 1, "Should find member in past graduation query");
      assert.strictEqual(pastMembers[0].user_id, null, "user_id should be null");

      // The cron loop skips members without user_id — this is tested
      // at the cron level (member.user_id check), not in the RPC
    });
  });

  describe("Quota exceeded → revoke", () => {
    it("revokes member when alumni capacity is exhausted", async () => {
      stub.seed("members", [{
        id: "m1",
        user_id: "u1",
        organization_id: "org1",
        expected_graduation_date: pastDate(5),
        graduated_at: null,
        deleted_at: null,
      }]);
      stub.seed("user_organization_roles", [{
        user_id: "u1",
        organization_id: "org1",
        role: "active_member",
        status: "active",
      }]);
      stub.seed("organization_subscriptions", [{
        organization_id: "org1",
        alumni_bucket: "none",
      }]);

      // transitionToAlumni should fail because quota = 0
      const transitionResult = await transitionToAlumni(stub as never, "m1", "u1", "org1");
      assert.strictEqual(transitionResult.success, false, "Transition should fail — quota exceeded");
      assert.ok(transitionResult.error?.includes("quota"), "Error should mention quota");

      // Revoke should succeed
      const revokeResult = await revokeMemberAccess(stub as never, "m1", "u1", "org1");
      assert.strictEqual(revokeResult.success, true, "Revoke should succeed");

      const roles = stub.getRows("user_organization_roles");
      assert.strictEqual(roles[0].status, "revoked", "Status should be revoked");
      const members = stub.getRows("members");
      assert.ok(members[0].graduated_at, "graduated_at should be set even when revoked");
    });
  });

  describe("Date exactly today", () => {
    it("member IS graduated (lte) and is NOT reinstated (gt)", async () => {
      const today = todayStr();
      stub.seed("members", [{
        id: "m1",
        user_id: "u1",
        organization_id: "org1",
        expected_graduation_date: today,
        graduated_at: null,
        deleted_at: null,
      }]);

      // getMembersPastGraduation uses lte — today should match
      const pastMembers = await getMembersPastGraduation(stub as never);
      assert.strictEqual(pastMembers.length, 1, "Member with date=today should be in past graduation");

      // Now test reinstatement side: graduated member with date=today should NOT be reinstated
      stub.clear("members");
      stub.seed("members", [{
        id: "m2",
        user_id: "u2",
        organization_id: "org1",
        expected_graduation_date: today,
        graduated_at: "2026-02-01T00:00:00Z",
        deleted_at: null,
      }]);

      // getMembersToReinstate uses gt — today should NOT match
      const toReinstate = await getMembersToReinstate(stub as never);
      const m2Reinstate = toReinstate.find((m) => m.id === "m2");
      assert.strictEqual(m2Reinstate, undefined, "Member with date=today should NOT be reinstated");
    });
  });

  describe("Dry run", () => {
    it("returns correct counts without mutating state", async () => {
      // Past graduation member (should transition)
      stub.seed("members", [
        {
          id: "m1",
          user_id: "u1",
          organization_id: "org1",
          expected_graduation_date: pastDate(5),
          graduated_at: null,
          deleted_at: null,
        },
        // Future graduation member (should be reinstated)
        {
          id: "m2",
          user_id: "u2",
          organization_id: "org1",
          expected_graduation_date: futureDate(30),
          graduated_at: "2026-01-01T00:00:00Z",
          deleted_at: null,
        },
      ]);
      stub.seed("organization_subscriptions", [{
        organization_id: "org1",
        alumni_bucket: "0-250",
      }]);

      const dryRun = await getGraduationDryRun(stub as never);

      assert.strictEqual(dryRun.toAlumni.length, 1, "1 member should transition to alumni");
      assert.strictEqual(dryRun.toAlumni[0].id, "m1");
      assert.strictEqual(dryRun.toReinstate.length, 1, "1 member should be reinstated");
      assert.strictEqual(dryRun.toReinstate[0].id, "m2");
      assert.strictEqual(dryRun.toRevoke.length, 0, "No members should be revoked");

      // Verify no mutation happened
      const members = stub.getRows("members");
      const m1 = members.find((m) => m.id === "m1");
      assert.strictEqual(m1?.graduated_at, null, "graduated_at should remain null after dry run");
    });
  });

  describe("Reverse flow idempotency", () => {
    it("returns skipped: true for already-active member", async () => {
      stub.seed("members", [{
        id: "m1",
        user_id: "u1",
        organization_id: "org1",
        expected_graduation_date: futureDate(30),
        graduated_at: null,
        deleted_at: null,
      }]);
      stub.seed("user_organization_roles", [{
        user_id: "u1",
        organization_id: "org1",
        role: "active_member",
        status: "active",
      }]);

      const result = await reinstateToActiveMember(stub as never, "m1", "u1", "org1", "active");

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.skipped, true, "Should skip already-active member");
    });
  });

  describe("Manual reinstate uses pending status", () => {
    it("passes pending status through the RPC", async () => {
      stub.seed("members", [{
        id: "m1",
        user_id: "u1",
        organization_id: "org1",
        expected_graduation_date: futureDate(30),
        graduated_at: "2026-01-01T00:00:00Z",
        deleted_at: null,
      }]);
      stub.seed("user_organization_roles", [{
        user_id: "u1",
        organization_id: "org1",
        role: "alumni",
        status: "active",
      }]);
      stub.seed("alumni", [{
        user_id: "u1",
        organization_id: "org1",
        deleted_at: null,
      }]);

      const result = await reinstateToActiveMember(stub as never, "m1", "u1", "org1", "pending");
      assert.strictEqual(result.success, true);

      const roles = stub.getRows("user_organization_roles");
      assert.strictEqual(roles[0].role, "active_member");
      assert.strictEqual(roles[0].status, "pending", "Manual reinstate should set status to pending");
    });
  });
});
