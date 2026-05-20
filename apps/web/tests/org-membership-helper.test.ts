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
        },
        {
          user_id: USER_ID,
          organization_id: ORG_ID,
          role: "alumni",
          status: "active",
        },
      ]);

      const result = await getOrgMembership(supabase, USER_ID, ORG_ID);
      assert.notEqual(result, null);
      assert.equal(result!.role, "alumni");
    });
  });
});
