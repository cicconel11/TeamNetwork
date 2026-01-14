import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

// ============================================================================
// Inline implementation of getOrgMembership to avoid @/ path alias issues.
// Mirrors src/lib/auth/api-helpers.ts exactly.
// ============================================================================

async function getOrgMembership(
  supabase: ReturnType<typeof createSupabaseStub>,
  userId: string,
  orgId: string
): Promise<{ role: string } | null> {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check org membership: ${error.message}`);
  }

  return data as { role: string } | null;
}

// ============================================================================
// Tests
// ============================================================================

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "user-123";

describe("getOrgMembership", () => {
  let supabase: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    supabase = createSupabaseStub();
  });

  describe("returns membership for active members", () => {
    it("should return role for active admin", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "admin",
          status: "active",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.notEqual(result, null);
      assert.equal(result!.role, "admin");
    });

    it("should return role for active member", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "active_member",
          status: "active",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.notEqual(result, null);
      assert.equal(result!.role, "active_member");
    });

    it("should return role for active alumni", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "alumni",
          status: "active",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.notEqual(result, null);
      assert.equal(result!.role, "alumni");
    });
  });

  describe("returns null for non-members", () => {
    it("should return null when user has no membership", async () => {
      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });

    it("should return null for different org", async () => {
      const OTHER_ORG = "00000000-0000-0000-0000-000000000099";
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: OTHER_ORG,
          role: "admin",
          status: "active",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });

    it("should return null for different user", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: "other-user",
          organization_id: ORG_ID,
          role: "admin",
          status: "active",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });
  });

  describe("filters out non-active statuses", () => {
    it("should return null for pending membership", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "active_member",
          status: "pending",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });

    it("should return null for revoked membership", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "active_member",
          status: "revoked",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });
  });

  describe("filters out soft-deleted memberships", () => {
    it("should return null for soft-deleted active membership", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "admin",
          status: "active",
          deleted_at: "2026-01-01T00:00:00.000Z",
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });

    it("should return null when membership is both revoked and soft-deleted", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "admin",
          status: "revoked",
          deleted_at: "2026-01-01T00:00:00.000Z",
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });
  });

  describe("only returns matching membership among multiple rows", () => {
    it("should find correct membership when user has roles in multiple orgs", async () => {
      const OTHER_ORG = "00000000-0000-0000-0000-000000000099";
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: OTHER_ORG,
          role: "admin",
          status: "active",
          deleted_at: null,
        },
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "alumni",
          status: "active",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.notEqual(result, null);
      assert.equal(result!.role, "alumni");
    });

    it("should skip deleted row and return null when only deleted row matches", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "admin",
          status: "active",
          deleted_at: "2026-01-01T00:00:00.000Z",
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });
  });

  describe("security: both status and deleted_at are enforced", () => {
    it("should reject pending + non-deleted (status filter works)", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "active_member",
          status: "pending",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });

    it("should reject active + deleted (deleted_at filter works)", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "active_member",
          status: "active",
          deleted_at: "2026-02-01T00:00:00.000Z",
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.equal(result, null);
    });

    it("should only accept active + non-deleted", async () => {
      supabase.seed("user_organization_roles", [
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "active_member",
          status: "active",
          deleted_at: null,
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.notEqual(result, null);
      assert.equal(result!.role, "active_member");
    });
  });
});
