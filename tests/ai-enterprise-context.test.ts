import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";

function createMockServiceSupabase(options: {
  membership?: { role: string; status: string } | null;
  organization?: { enterprise_id: string | null } | null;
  enterpriseRole?: { role: string } | null;
  organizationError?: unknown;
  enterpriseRoleError?: unknown;
}) {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return builder;
        },
        async maybeSingle() {
          if (table === "user_organization_roles") {
            return { data: options.membership ?? null, error: null };
          }
          if (table === "organizations") {
            assert.equal(filters.get("id"), "org-1");
            if (options.organizationError) {
              return { data: null, error: options.organizationError };
            }
            return { data: options.organization ?? null, error: null };
          }
          if (table === "user_enterprise_roles") {
            if (options.enterpriseRoleError) {
              return { data: null, error: options.enterpriseRoleError };
            }
            return { data: options.enterpriseRole ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };

      return builder;
    },
  };
}

const rateLimit = {
  headers: {} as Record<string, string>,
};

describe("enterprise AI org context", () => {
  it("attaches enterprise context when the admin org belongs to an enterprise and the user has an enterprise role", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const result = await getAiOrgContext(
      "org-1",
      { id: "user-1", email: "owner@example.com" } as User,
      rateLimit,
      {
        serviceSupabase: createMockServiceSupabase({
          membership: { role: "admin", status: "active" },
          organization: { enterprise_id: "ent-1" },
          enterpriseRole: { role: "owner" },
        }),
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.enterpriseId, "ent-1");
      assert.equal(result.enterpriseRole, "owner");
    }
  });

  it("leaves enterprise context unset when the admin org is enterprise-managed but the user has no enterprise role", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const result = await getAiOrgContext(
      "org-1",
      { id: "user-1", email: "admin@example.com" } as User,
      rateLimit,
      {
        serviceSupabase: createMockServiceSupabase({
          membership: { role: "admin", status: "active" },
          organization: { enterprise_id: "ent-1" },
          enterpriseRole: null,
        }),
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.enterpriseId, undefined);
      assert.equal(result.enterpriseRole, undefined);
    }
  });

  it("fails closed with 503 when the organizations lookup errors", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const result = await getAiOrgContext(
      "org-1",
      { id: "user-1", email: "admin@example.com" } as User,
      rateLimit,
      {
        serviceSupabase: createMockServiceSupabase({
          membership: { role: "admin", status: "active" },
          organizationError: new Error("db down"),
        }),
      },
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 503);
    }
  });

  it("fails closed with 503 when the enterprise role lookup errors", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const result = await getAiOrgContext(
      "org-1",
      { id: "user-1", email: "admin@example.com" } as User,
      rateLimit,
      {
        serviceSupabase: createMockServiceSupabase({
          membership: { role: "admin", status: "active" },
          organization: { enterprise_id: "ent-1" },
          enterpriseRoleError: new Error("replica lag"),
        }),
      },
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.response.status, 503);
    }
  });

  it("leaves enterprise context unset when the org is not attached to an enterprise", async () => {
    const { getAiOrgContext } = await import("../src/lib/ai/context.ts");
    const result = await getAiOrgContext(
      "org-1",
      { id: "user-1", email: "admin@example.com" } as User,
      rateLimit,
      {
        serviceSupabase: createMockServiceSupabase({
          membership: { role: "admin", status: "active" },
          organization: { enterprise_id: null },
          enterpriseRole: { role: "owner" },
        }),
      },
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.enterpriseId, undefined);
      assert.equal(result.enterpriseRole, undefined);
    }
  });
});
