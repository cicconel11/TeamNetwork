import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrgRoleConfigColumn } from "../../src/lib/auth/org-role-config.ts";
import { DEFAULT_ORG_ROLE_CONFIG, getAllowedOrgRoles } from "../../src/lib/auth/org-role-config.ts";

type QueryResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

function makeSupabase(result: QueryResult) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };

  return {
    from(table: string) {
      assert.equal(table, "organizations");
      return chain;
    },
  } as never;
}

describe("getAllowedOrgRoles", () => {
  it("throws when the org config lookup errors", async () => {
    const supabase = makeSupabase({
      data: null,
      error: { message: "connection refused" },
    });

    await assert.rejects(
      () => getAllowedOrgRoles(supabase, "org-1", "feed_post_roles", "feed"),
      /\[feed\] Failed to fetch org config: connection refused/,
    );
  });

  it("throws when the org config row is missing", async () => {
    const supabase = makeSupabase({
      data: null,
      error: null,
    });

    await assert.rejects(
      () => getAllowedOrgRoles(supabase, "org-1", "feed_post_roles", "feed"),
      /\[feed\] Organization config not found for org org-1/,
    );
  });

  it("returns default roles when the org config column is null", async () => {
    const supabase = makeSupabase({
      data: { feed_post_roles: null },
      error: null,
    });

    const roles = await getAllowedOrgRoles(supabase, "org-1", "feed_post_roles", "feed");
    assert.deepEqual(roles, DEFAULT_ORG_ROLE_CONFIG.feed_post_roles);
  });

  it("uses the parent-enabled discussion default when org config is null", async () => {
    const supabase = makeSupabase({
      data: { discussion_post_roles: null },
      error: null,
    });

    const roles = await getAllowedOrgRoles(supabase, "org-1", "discussion_post_roles", "discussions");
    assert.deepEqual(roles, ["admin", "active_member", "alumni", "parent"]);
  });

  it("preserves explicit configured roles", async () => {
    const supabase = makeSupabase({
      data: { discussion_post_roles: ["admin", "parent"] },
      error: null,
    });

    const roles = await getAllowedOrgRoles(
      supabase,
      "org-1",
      "discussion_post_roles",
      "discussions",
    );
    assert.deepEqual(roles, ["admin", "parent"]);
  });

  it("preserves an explicit empty role list instead of widening permissions", async () => {
    const supabase = makeSupabase({
      data: { job_post_roles: [] },
      error: null,
    });

    const roles = await getAllowedOrgRoles(supabase, "org-1", "job_post_roles", "jobs");
    assert.deepEqual(roles, []);
  });

  it("defines defaults for every org role config column used by route guards", () => {
    const columns: OrgRoleConfigColumn[] = [
      "feed_post_roles",
      "discussion_post_roles",
      "job_post_roles",
    ];

    for (const column of columns) {
      assert.ok(DEFAULT_ORG_ROLE_CONFIG[column].length > 0, `${column} should have defaults`);
      assert.ok(DEFAULT_ORG_ROLE_CONFIG[column].includes("admin"), `${column} should include admin`);
    }
  });
});
