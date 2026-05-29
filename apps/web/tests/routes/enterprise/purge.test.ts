import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tests for deleteExpiredEnterprise (lib/enterprise/delete-enterprise.ts).
 *
 * Mirrors deleteExpiredOrganization's Stripe-cancel + halt-on-error invariant.
 * The Stripe/DB I/O is simulated; we verify the decision logic, then assert the
 * source preserves the key invariants (CASCADE-only delete, audit-log survival).
 */

const helperSource = readFileSync(
  join(process.cwd(), "src/lib/enterprise/delete-enterprise.ts"),
  "utf8"
);

interface PurgeParams {
  attachedOrgCount: number;
  stripeSubscriptionId: string | null;
  stripeStatus: "active" | "canceled" | null;
  stripeError: "resource_missing" | "real" | null;
}

interface PurgeResult {
  success: boolean;
  stripeCancelCalled: boolean;
  enterpriseDeleted: boolean;
}

function simulatePurge(p: PurgeParams): PurgeResult {
  // Precondition re-check.
  if (p.attachedOrgCount > 0) {
    return { success: false, stripeCancelCalled: false, enterpriseDeleted: false };
  }

  let stripeCancelCalled = false;
  if (p.stripeSubscriptionId) {
    if (p.stripeError === "real") {
      // Real Stripe error → halt, do not delete.
      return { success: false, stripeCancelCalled: false, enterpriseDeleted: false };
    }
    // resource_missing is swallowed; otherwise cancel only if not already canceled.
    if (p.stripeError !== "resource_missing" && p.stripeStatus !== "canceled") {
      stripeCancelCalled = true;
    }
  }

  return { success: true, stripeCancelCalled, enterpriseDeleted: true };
}

test("happy path: 0 orgs, active sub → cancel + delete", () => {
  const r = simulatePurge({
    attachedOrgCount: 0,
    stripeSubscriptionId: "sub_1",
    stripeStatus: "active",
    stripeError: null,
  });
  assert.deepStrictEqual(r, { success: true, stripeCancelCalled: true, enterpriseDeleted: true });
});

test("null subscription → skip cancel, still delete", () => {
  const r = simulatePurge({
    attachedOrgCount: 0,
    stripeSubscriptionId: null,
    stripeStatus: null,
    stripeError: null,
  });
  assert.strictEqual(r.stripeCancelCalled, false);
  assert.strictEqual(r.enterpriseDeleted, true);
});

test("already-canceled subscription → skip cancel, still delete", () => {
  const r = simulatePurge({
    attachedOrgCount: 0,
    stripeSubscriptionId: "sub_1",
    stripeStatus: "canceled",
    stripeError: null,
  });
  assert.strictEqual(r.stripeCancelCalled, false);
  assert.strictEqual(r.enterpriseDeleted, true);
});

test("resource_missing → swallow, still delete", () => {
  const r = simulatePurge({
    attachedOrgCount: 0,
    stripeSubscriptionId: "sub_gone",
    stripeStatus: null,
    stripeError: "resource_missing",
  });
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.enterpriseDeleted, true);
});

test("real Stripe error → halt, no delete, failure", () => {
  const r = simulatePurge({
    attachedOrgCount: 0,
    stripeSubscriptionId: "sub_1",
    stripeStatus: "active",
    stripeError: "real",
  });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.enterpriseDeleted, false);
});

test("org re-attached during window → skip purge, no delete", () => {
  const r = simulatePurge({
    attachedOrgCount: 2,
    stripeSubscriptionId: "sub_1",
    stripeStatus: "active",
    stripeError: null,
  });
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.enterpriseDeleted, false);
  assert.strictEqual(r.stripeCancelCalled, false);
});

// ── Source-level invariants ───────────────────────────────────────────────────

test("purge deletes the enterprise row directly (CASCADE, no DELETION_ORDER array)", () => {
  assert.match(helperSource, /\.from\("enterprises"\)\s*\.delete\(\)/);
  assert.ok(!/DELETION_ORDER/.test(helperSource), "enterprise purge relies on CASCADE only");
});

test("purge re-checks org count with NO deleted_at filter", () => {
  assert.match(helperSource, /\.from\("organizations"\)/);
  // organizations has no deleted_at column — there must be no .is("deleted_at"…) filter.
  assert.ok(!/\.is\(\s*["']deleted_at["']/.test(helperSource), "must not filter on deleted_at");
});

test("purge halts on real Stripe error before deleting", () => {
  const cancelIdx = helperSource.indexOf("Stripe subscription cancel failed");
  const deleteIdx = helperSource.indexOf('.from("enterprises")');
  assert.ok(cancelIdx >= 0 && deleteIdx >= 0);
  assert.ok(cancelIdx < deleteIdx, "Stripe halt guard precedes enterprise delete");
});

test("purge swallows resource_missing / No such subscription", () => {
  assert.match(helperSource, /resource_missing/);
  assert.match(helperSource, /No such subscription/);
});

test("enterprise_audit_logs is intentionally NOT deleted in the purge", () => {
  assert.ok(!/\.from\("enterprise_audit_logs"\)/.test(helperSource));
});
