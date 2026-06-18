import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { audienceFilterForRole } from "../src/lib/ai/rag-retriever";
import type { OrgRole } from "../src/lib/auth/role-utils";

/**
 * Audience-gating invariant for the knowledge_documents RAG source.
 *
 * The search_ai_documents RPC filters chunks with this exact logic
 * (20261220000000_search_ai_documents_audience.sql):
 *
 *   p_audience_filter IS NULL
 *   OR COALESCE(metadata->>'audience', 'all') IN ('all','both')
 *   OR (metadata->>'audience') = ANY(p_audience_filter)
 *
 * We reproduce that predicate here and feed it the outputs of
 * audienceFilterForRole() to prove, in JS, the must-not-leak invariant:
 * an 'admins'-audience knowledge doc is visible ONLY to admins, while an
 * 'all'-audience doc is visible to everyone.
 */
function rpcChunkVisible(
  chunkAudience: string | undefined,
  audienceFilter: string[] | undefined
): boolean {
  // p_audience_filter IS NULL -> no filtering (admin / global callers)
  if (audienceFilter === undefined) return true;
  const effective = chunkAudience ?? "all";
  if (effective === "all" || effective === "both") return true;
  return audienceFilter.includes(effective);
}

const NON_ADMIN_ROLES: OrgRole[] = ["active_member", "alumni", "parent"];

describe("knowledge audience gating", () => {
  describe("'all' audience is universally visible", () => {
    it("is visible to admin", () => {
      assert.equal(rpcChunkVisible("all", audienceFilterForRole("admin")), true);
    });
    for (const role of NON_ADMIN_ROLES) {
      it(`is visible to ${role}`, () => {
        assert.equal(rpcChunkVisible("all", audienceFilterForRole(role)), true);
      });
    }
    it("unset audience defaults to visible for a non-admin", () => {
      assert.equal(
        rpcChunkVisible(undefined, audienceFilterForRole("active_member")),
        true
      );
    });
  });

  describe("'admins' audience is admin-only (must-not-leak)", () => {
    it("is visible to admin (admin filter is undefined = no restriction)", () => {
      assert.equal(audienceFilterForRole("admin"), undefined);
      assert.equal(rpcChunkVisible("admins", audienceFilterForRole("admin")), true);
    });

    for (const role of NON_ADMIN_ROLES) {
      it(`is HIDDEN from ${role}`, () => {
        const filter = audienceFilterForRole(role);
        // Sanity: the admin token must not appear in any non-admin allowlist.
        assert.ok(filter !== undefined);
        assert.ok(!filter!.includes("admins"));
        assert.equal(rpcChunkVisible("admins", filter), false);
      });
    }

    it("default-role caller (empty allowlist) cannot see admin docs", () => {
      // audienceFilterForRole returns [] for unknown roles -> only unrestricted.
      const emptyFilter: string[] = [];
      assert.equal(rpcChunkVisible("admins", emptyFilter), false);
      assert.equal(rpcChunkVisible("all", emptyFilter), true);
    });
  });

  describe("member-targeted audience respects role allowlists", () => {
    it("'members' is visible to active_member but not alumni", () => {
      assert.equal(
        rpcChunkVisible("members", audienceFilterForRole("active_member")),
        true
      );
      assert.equal(
        rpcChunkVisible("members", audienceFilterForRole("alumni")),
        false
      );
    });
  });
});
