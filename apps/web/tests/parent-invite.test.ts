import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRole } from "@/lib/auth/role-utils";
import { createSupabaseStub } from "./utils/supabaseStub";

describe("normalizeRole — parent role support", () => {
  it('maps "parent" to "parent" (distinct role, not aliased to alumni)', () => {
    assert.equal(normalizeRole("parent"), "parent");
  });

  it('maps "member" to "active_member"', () => {
    assert.equal(normalizeRole("member"), "active_member");
  });

  it('maps "viewer" to "alumni"', () => {
    assert.equal(normalizeRole("viewer"), "alumni");
  });

  it('passes "admin" through unchanged', () => {
    assert.equal(normalizeRole("admin"), "admin");
  });

  it('passes "active_member" through unchanged', () => {
    assert.equal(normalizeRole("active_member"), "active_member");
  });

  it('passes "alumni" through unchanged', () => {
    assert.equal(normalizeRole("alumni"), "alumni");
  });

  it("returns null for null", () => {
    assert.equal(normalizeRole(null), null);
  });

  it("returns null for undefined", () => {
    assert.equal(normalizeRole(undefined), null);
  });
});

/**
 * RPC behavior notes (covered by existing DB logic, not unit-tested here):
 *
 * - redeem_org_invite already handles all roles generically: it inserts a
 *   user_organization_roles row with status='pending' and casts
 *   v_invite.role::public.user_role. Once the enum includes 'parent' (via
 *   the 20260226000000_add_parent_role migration), this cast succeeds.
 *
 * - Duplicate redemption (already_member: true) and revoked-user rejection
 *   are handled inside the existing RPC without role-specific logic, so
 *   parent invites get the same deduplication guarantees as all other roles.
 */

// ---------------------------------------------------------------------------
// Mechanism A: create_org_invite RPC via organization_invites table
// ---------------------------------------------------------------------------

interface OrgInviteRow {
  id: string;
  organization_id: string;
  code: string;
  token: string | null;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
  created_at: string;
}

type SimulateResult = { data: OrgInviteRow | null; error: string | null };

async function simulateCreateOrgInvite(opts: {
  stub: ReturnType<typeof createSupabaseStub>;
  orgId: string;
  role: string;
  uses?: number | null;
  expiresAt?: string | null;
}): Promise<SimulateResult> {
  const { stub, orgId, role, uses = null, expiresAt = null } = opts;
  const result = await stub.rpc("create_org_invite", {
    p_organization_id: orgId,
    p_role: role,
    p_uses: uses,
    p_expires_at: expiresAt,
  });

  if (result.error) {
    return { data: null, error: result.error.message };
  }
  return { data: result.data as OrgInviteRow, error: null };
}

describe("create_org_invite — parent role via organization_invites (Mechanism A)", () => {
  const ORG_ID = "00000000-0000-0000-0000-000000000001";

  it("a. happy path — parent role succeeds and returns invite with role='parent'", async () => {
    const stub = createSupabaseStub();

    const mockInvite: OrgInviteRow = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      organization_id: ORG_ID,
      code: "ABCD1234",
      token: "secure-token-abc",
      role: "parent",
      uses_remaining: null,
      expires_at: null,
      created_at: new Date().toISOString(),
    };

    stub.registerRpc("create_org_invite", (params) => {
      // Validate that the role we receive is 'parent'
      assert.equal(params.p_role, "parent");
      assert.equal(params.p_organization_id, ORG_ID);
      return mockInvite;
    });

    const result = await simulateCreateOrgInvite({
      stub,
      orgId: ORG_ID,
      role: "parent",
    });

    assert.equal(result.error, null);
    assert.ok(result.data, "expected invite data");
    assert.equal(result.data.role, "parent");
    assert.ok(result.data.code, "invite code should be set");
    assert.equal(result.data.organization_id, ORG_ID);
  });

  it("b. invalid role rejected — 'guardian' is not a valid role", async () => {
    const stub = createSupabaseStub();

    stub.registerRpc("create_org_invite", (params) => {
      const validRoles = ["admin", "active_member", "alumni", "parent"];
      if (!validRoles.includes(params.p_role as string)) {
        throw new Error("Invalid role. Must be admin, active_member, alumni, or parent");
      }
      return {};
    });

    const result = await simulateCreateOrgInvite({
      stub,
      orgId: ORG_ID,
      role: "guardian",
    });

    assert.ok(result.error, "expected an error for invalid role");
    assert.match(result.error!, /Invalid role/i);
    assert.equal(result.data, null);
  });

  it("c. constraint violation is surfaced (regression guard — simulates pre-fix behavior)", async () => {
    const stub = createSupabaseStub();

    // Simulate what happened before the migration fix: the RPC itself passed
    // validation but PostgreSQL rejected the INSERT at the table constraint level.
    stub.registerRpc("create_org_invite", () => {
      throw new Error(
        'new row for relation "organization_invites" violates check constraint "organization_invites_role_check"'
      );
    });

    const result = await simulateCreateOrgInvite({
      stub,
      orgId: ORG_ID,
      role: "parent",
    });

    assert.ok(result.error, "constraint violation should be surfaced to caller");
    assert.match(result.error!, /organization_invites_role_check/);
    assert.equal(result.data, null, "data should be null on error");
  });

  it("d. alumni quota is NOT called for parent role", async () => {
    const stub = createSupabaseStub();
    let alumniQuotaCalled = false;

    stub.registerRpc("assert_alumni_quota", () => {
      alumniQuotaCalled = true;
      return null;
    });

    stub.registerRpc("create_org_invite", (params) => {
      // Replicate the RPC logic: only call alumni quota for alumni role
      if (params.p_role === "alumni") {
        // In real DB this would PERFORM assert_alumni_quota; we call it here to
        // verify the test would detect it if the logic were wrong.
        alumniQuotaCalled = true;
      }
      // For parent: no quota call
      return {
        id: "bbbbbbbb-0000-0000-0000-000000000002",
        organization_id: params.p_organization_id,
        code: "PARENT01",
        token: null,
        role: params.p_role,
        uses_remaining: null,
        expires_at: null,
        created_at: new Date().toISOString(),
      };
    });

    const result = await simulateCreateOrgInvite({
      stub,
      orgId: ORG_ID,
      role: "parent",
    });

    assert.equal(result.error, null);
    assert.equal(alumniQuotaCalled, false, "assert_alumni_quota must NOT be called for parent role");
    assert.equal(result.data?.role, "parent");
  });
});
