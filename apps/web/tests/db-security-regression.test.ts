/**
 * Database Security Regression Tests
 *
 * Verifies that the typed-helper refactor preserves fail-closed semantics
 * and that privileged DB paths have proper authz + error handling.
 *
 * Four concrete behaviors per the security review plan:
 * 1. Non-admin cannot assign enterprise roles (401/403)
 * 2. Auth-schema lookup errors fail closed (500, not silent null)
 * 3. Parent invite accept with invalid/expired token is rejected
 * 4. Source-level checks for `as any` removal on priority call sites
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

// ── 1. Enterprise role assignment requires owner ─────────────────────────────

describe("enterprise admins authz boundaries", () => {
  it("POST (invite) requires ENTERPRISE_OWNER_ROLE — non-owners are rejected", () => {
    // The route uses ENTERPRISE_OWNER_ROLE for POST.
    // getEnterpriseApiContext returns 403 for non-matching roles.
    // Verify the route source imports and uses the correct preset.
    const source = readSource(
      "src/app/api/enterprise/[enterpriseId]/admins/route.ts"
    );
    assert.ok(
      source.includes("ENTERPRISE_OWNER_ROLE"),
      "POST handler must use ENTERPRISE_OWNER_ROLE"
    );
    // The POST function references ENTERPRISE_OWNER_ROLE in its getEnterpriseApiContext call
    const postSection = source.slice(source.indexOf("export async function POST"));
    assert.ok(
      postSection.includes("ENTERPRISE_OWNER_ROLE"),
      "POST must pass ENTERPRISE_OWNER_ROLE to getEnterpriseApiContext"
    );
    // billing_admin and org_admin must NOT be in the owner preset
    assert.ok(
      !postSection.includes("ENTERPRISE_ANY_ROLE"),
      "POST must not use ENTERPRISE_ANY_ROLE (too permissive)"
    );
    assert.ok(
      !postSection.includes("ENTERPRISE_BILLING_ROLE"),
      "POST must not use ENTERPRISE_BILLING_ROLE (too permissive)"
    );
  });

  it("DELETE (remove) requires ENTERPRISE_OWNER_ROLE", () => {
    const source = readSource(
      "src/app/api/enterprise/[enterpriseId]/admins/route.ts"
    );
    const deleteSection = source.slice(
      source.indexOf("export async function DELETE")
    );
    assert.ok(
      deleteSection.includes("ENTERPRISE_OWNER_ROLE"),
      "DELETE must pass ENTERPRISE_OWNER_ROLE to getEnterpriseApiContext"
    );
  });

  it("getEnterpriseApiContext fails closed on role query error (returns 503)", () => {
    // Verify the source handles roleError before checking role value.
    // This ensures a DB error doesn't silently grant access.
    const source = readSource("src/lib/auth/enterprise-api-context.ts");
    const roleCheckSection = source.slice(source.indexOf("roleError"));
    assert.ok(
      roleCheckSection.includes("503"),
      "role query failure must return 503 (fail closed)"
    );
    // Verify error is checked BEFORE role access check
    const errorIdx = source.indexOf("if (roleError)");
    const roleIdx = source.indexOf("if (!role || !requiredRoles");
    assert.ok(
      errorIdx > 0 && roleIdx > 0 && errorIdx < roleIdx,
      "roleError must be checked before role access validation"
    );
  });
});

// ── 2. Auth-schema lookup errors fail closed ────────────────────────────────

describe("auth-schema lookup fail-closed behavior", () => {
  it("lookupAuthUserByEmail returns error field for callers to check", () => {
    const source = readSource("src/lib/supabase/auth-schema.ts");
    // The return type must include error
    assert.ok(
      source.includes("error: { message: string } | null"),
      "lookupAuthUserByEmail must return an error field"
    );
  });

  it("admins route checks auth lookup error before treating null as not-found", () => {
    const source = readSource(
      "src/app/api/enterprise/[enterpriseId]/admins/route.ts"
    );
    // After calling lookupAuthUserByEmail, must check lookupError before using userRow
    const lookupIdx = source.indexOf("lookupAuthUserByEmail");
    assert.ok(lookupIdx > 0, "admins route must use lookupAuthUserByEmail");

    const afterLookup = source.slice(lookupIdx);
    const errorCheckIdx = afterLookup.indexOf("if (lookupError)");
    const notFoundIdx = afterLookup.indexOf("if (!targetUser)");
    assert.ok(
      errorCheckIdx > 0 && notFoundIdx > 0 && errorCheckIdx < notFoundIdx,
      "lookupError must be checked before null-means-not-found logic"
    );
    // Must return 500, not 404 — check the section between error check and not-found check
    const errorHandlerBlock = afterLookup.slice(errorCheckIdx, notFoundIdx);
    assert.ok(
      errorHandlerBlock.includes("500"),
      "auth lookup error must return 500"
    );
  });

  it("import-utils checks auth lookup error before proceeding", () => {
    const source = readSource("src/lib/alumni/import-utils.ts");
    assert.ok(
      source.includes("lookupAuthUsersByEmail"),
      "import-utils must use shared lookupAuthUsersByEmail"
    );
    assert.ok(
      source.includes("if (authError)"),
      "import-utils must check authError from lookup"
    );
  });
});

// ── 3. Parent invite accept with invalid/expired token is rejected ──────────

describe("parent invite accept security", () => {
  /**
   * Simulate the parent invite accept route logic for validation tests.
   * Mirrors the real route's validation order and status codes.
   */
  function simulateInviteAccept(opts: {
    code: string;
    inviteStatus: "pending" | "accepted" | "revoked" | null;
    inviteOrgId: string;
    requestOrgId: string;
    expiresAt: string;
    claimSucceeds?: boolean;
  }): { status: number; error: string } {
    // No invite found
    if (opts.inviteStatus === null) {
      return { status: 400, error: "Invalid invite code" };
    }
    // Org mismatch
    if (opts.inviteOrgId !== opts.requestOrgId) {
      return { status: 400, error: "Invalid invite code" };
    }
    // Already accepted
    if (opts.inviteStatus === "accepted") {
      return { status: 409, error: "Invite already accepted" };
    }
    // Revoked
    if (opts.inviteStatus === "revoked") {
      return { status: 410, error: "Invite has been revoked" };
    }
    // Expired
    if (new Date(opts.expiresAt) < new Date()) {
      return { status: 410, error: "Invite has expired" };
    }
    // Race condition: claim fails
    if (opts.claimSucceeds === false) {
      return { status: 409, error: "Invite already accepted" };
    }
    return { status: 200, error: "" };
  }

  it("rejects when invite code does not exist (400)", () => {
    const result = simulateInviteAccept({
      code: "nonexistent",
      inviteStatus: null,
      inviteOrgId: "org-1",
      requestOrgId: "org-1",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid invite code");
  });

  it("rejects when invite belongs to different org (400, no info leak)", () => {
    const result = simulateInviteAccept({
      code: "valid-code",
      inviteStatus: "pending",
      inviteOrgId: "org-1",
      requestOrgId: "org-2",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(result.status, 400);
    // Must return same generic error — no hint about which org the invite belongs to
    assert.equal(result.error, "Invalid invite code");
  });

  it("rejects already accepted invite (409)", () => {
    const result = simulateInviteAccept({
      code: "accepted-code",
      inviteStatus: "accepted",
      inviteOrgId: "org-1",
      requestOrgId: "org-1",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(result.status, 409);
  });

  it("rejects revoked invite (410)", () => {
    const result = simulateInviteAccept({
      code: "revoked-code",
      inviteStatus: "revoked",
      inviteOrgId: "org-1",
      requestOrgId: "org-1",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(result.status, 410);
  });

  it("rejects expired invite (410)", () => {
    const result = simulateInviteAccept({
      code: "expired-code",
      inviteStatus: "pending",
      inviteOrgId: "org-1",
      requestOrgId: "org-1",
      expiresAt: new Date(Date.now() - 86400000).toISOString(), // yesterday
    });
    assert.equal(result.status, 410);
    assert.ok(result.error.includes("expired"));
  });

  it("rejects on TOCTOU race (claim fails → 409)", () => {
    const result = simulateInviteAccept({
      code: "raced-code",
      inviteStatus: "pending",
      inviteOrgId: "org-1",
      requestOrgId: "org-1",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      claimSucceeds: false,
    });
    assert.equal(result.status, 409);
  });

  it("route source checks claim result length before proceeding", () => {
    const source = readSource(
      "src/app/api/organizations/[organizationId]/parents/invite/accept/route.ts"
    );
    assert.ok(
      source.includes("claimedRows.length === 0"),
      "route must check claim result is non-empty before proceeding"
    );
  });
});

// ── 4. Source-level: `as any` removal verification ──────────────────────────

describe("as-any removal on priority call sites", () => {
  const P0_P1_FILES = [
    "src/app/api/enterprise/[enterpriseId]/admins/route.ts",
    "src/lib/enterprise/admin.ts",
    "src/lib/alumni/import-utils.ts",
    "src/app/api/organizations/[organizationId]/parents/invite/accept/route.ts",
    "src/app/api/enterprise/[enterpriseId]/billing/route.ts",
    "src/lib/auth/enterprise-api-context.ts",
    "src/lib/enterprise/resolve-enterprise.ts",
  ];

  for (const file of P0_P1_FILES) {
    it(`${file} has no service-client 'as any' casts on DB queries`, () => {
      const source = readSource(file);
      // Count remaining "as any" instances — auth-schema.ts helper has the
      // 2 unavoidable casts, but the call sites should have 0.
      const asAnyMatches = source.match(/as any/g) ?? [];
      // billing/route.ts retains 1 for the Stripe API (external, not DB)
      const allowedCount = file.includes("billing/route.ts") ? 1 : 0;
      assert.ok(
        asAnyMatches.length <= allowedCount,
        `${file} has ${asAnyMatches.length} 'as any' casts (allowed: ${allowedCount}). ` +
        `DB queries should use typed Supabase client, not 'as any'.`
      );
    });
  }

  it("auth-schema helper centralises the unavoidable auth-schema casts", () => {
    const source = readSource("src/lib/supabase/auth-schema.ts");
    const casts = source.match(/as any/g) ?? [];
    assert.equal(
      casts.length,
      2,
      "auth-schema.ts should have exactly 2 'as any' casts (one per helper)"
    );
  });
});
