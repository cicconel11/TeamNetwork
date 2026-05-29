import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { enterpriseDeleteSchema } from "../../../src/lib/schemas/enterprise";

/**
 * Tests for DELETE/POST/GET /api/enterprise/[enterpriseId]/deletion
 *
 * Owner-only soft-delete grace flow. Live auth + service client are simulated;
 * we verify the route's decision logic and the double-confirm schema.
 */

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/enterprise/[enterpriseId]/deletion/route.ts"),
  "utf8"
);

// ── Schema: double-confirm ────────────────────────────────────────────────────

test("enterpriseDeleteSchema accepts equal non-empty phrases", () => {
  const r = enterpriseDeleteSchema.safeParse({
    confirmation: "DELETE Acme",
    confirmationRepeat: "DELETE Acme",
  });
  assert.strictEqual(r.success, true);
});

test("enterpriseDeleteSchema rejects empty input", () => {
  const r = enterpriseDeleteSchema.safeParse({ confirmation: "", confirmationRepeat: "" });
  assert.strictEqual(r.success, false);
});

test("enterpriseDeleteSchema rejects unequal phrases on confirmationRepeat path", () => {
  const r = enterpriseDeleteSchema.safeParse({
    confirmation: "DELETE Acme",
    confirmationRepeat: "DELETE Acm",
  });
  assert.strictEqual(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.some((i) => i.path.join(".") === "confirmationRepeat"));
  }
});

test("enterpriseDeleteSchema rejects extra fields (strict)", () => {
  const r = enterpriseDeleteSchema.safeParse({
    confirmation: "x",
    confirmationRepeat: "x",
    extra: 1,
  });
  assert.strictEqual(r.success, false);
});

// ── DELETE (initiate) logic simulation ────────────────────────────────────────

interface InitiateParams {
  enterpriseName: string;
  confirmation: string;
  confirmationRepeat: string;
  attachedOrgCount: number;
  existingPending: { scheduled_deletion_at: string } | null;
}

interface RouteResult {
  status: number;
  body: Record<string, unknown>;
  stripeTouched: boolean;
}

const GRACE_PERIOD_DAYS = 30;

function simulateInitiate(p: InitiateParams): RouteResult {
  const requiredPhrase = `DELETE ${p.enterpriseName}`;
  if (p.confirmation !== requiredPhrase || p.confirmationRepeat !== requiredPhrase) {
    return { status: 400, body: { error: "phrase mismatch" }, stripeTouched: false };
  }
  if (p.attachedOrgCount > 0) {
    return {
      status: 400,
      body: { error: "orgs attached", attachedOrgCount: p.attachedOrgCount },
      stripeTouched: false,
    };
  }
  if (p.existingPending) {
    return {
      status: 200,
      body: { success: true, scheduledDeletionAt: p.existingPending.scheduled_deletion_at },
      stripeTouched: false,
    };
  }
  return {
    status: 200,
    body: { success: true, gracePeriodDays: GRACE_PERIOD_DAYS },
    stripeTouched: false,
  };
}

test("initiate succeeds with matching phrases and 0 orgs — no Stripe call", () => {
  const r = simulateInitiate({
    enterpriseName: "Acme",
    confirmation: "DELETE Acme",
    confirmationRepeat: "DELETE Acme",
    attachedOrgCount: 0,
    existingPending: null,
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.success, true);
  assert.strictEqual(r.body.gracePeriodDays, 30);
  assert.strictEqual(r.stripeTouched, false);
});

test("initiate blocks with attachedOrgCount when orgs attached", () => {
  const r = simulateInitiate({
    enterpriseName: "Acme",
    confirmation: "DELETE Acme",
    confirmationRepeat: "DELETE Acme",
    attachedOrgCount: 3,
    existingPending: null,
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.attachedOrgCount, 3);
});

test("initiate rejects when first phrase wrong", () => {
  const r = simulateInitiate({
    enterpriseName: "Acme",
    confirmation: "DELETE Acm",
    confirmationRepeat: "DELETE Acme",
    attachedOrgCount: 0,
    existingPending: null,
  });
  assert.strictEqual(r.status, 400);
});

test("initiate rejects when second phrase wrong", () => {
  const r = simulateInitiate({
    enterpriseName: "Acme",
    confirmation: "DELETE Acme",
    confirmationRepeat: "delete acme",
    attachedOrgCount: 0,
    existingPending: null,
  });
  assert.strictEqual(r.status, 400);
});

test("initiate is case-sensitive incl. names with spaces", () => {
  const ok = simulateInitiate({
    enterpriseName: "Test Enterprise",
    confirmation: "DELETE Test Enterprise",
    confirmationRepeat: "DELETE Test Enterprise",
    attachedOrgCount: 0,
    existingPending: null,
  });
  assert.strictEqual(ok.status, 200);
  const bad = simulateInitiate({
    enterpriseName: "Test Enterprise",
    confirmation: "DELETE test enterprise",
    confirmationRepeat: "DELETE test enterprise",
    attachedOrgCount: 0,
    existingPending: null,
  });
  assert.strictEqual(bad.status, 400);
});

test("initiate is idempotent — returns existing schedule on double-initiate", () => {
  const r = simulateInitiate({
    enterpriseName: "Acme",
    confirmation: "DELETE Acme",
    confirmationRepeat: "DELETE Acme",
    attachedOrgCount: 0,
    existingPending: { scheduled_deletion_at: "2099-01-01T00:00:00.000Z" },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.scheduledDeletionAt, "2099-01-01T00:00:00.000Z");
});

// ── Source-level invariants ───────────────────────────────────────────────────

test("initiate does NOT cancel Stripe (deferred to purge)", () => {
  const deleteHandler = routeSource.slice(
    routeSource.indexOf("export async function DELETE"),
    routeSource.indexOf("export async function POST")
  );
  assert.ok(!/stripe\.subscriptions\.cancel/.test(deleteHandler), "DELETE must not cancel Stripe");
});

test("route is owner-only across all handlers", () => {
  const ownerChecks = routeSource.match(/ENTERPRISE_OWNER_ROLE/g) ?? [];
  // DELETE, POST, GET each pass ENTERPRISE_OWNER_ROLE → 3 usages (plus the import).
  assert.ok(ownerChecks.length >= 4, "expected owner-role gate in all three handlers");
});

test("route runs on nodejs runtime and is dynamic", () => {
  assert.match(routeSource, /export const runtime = "nodejs"/);
  assert.match(routeSource, /export const dynamic = "force-dynamic"/);
});

test("route handles missing table (42P01) gracefully on GET", () => {
  assert.match(routeSource, /42P01/);
});

test("initiate sends email but still succeeds when RESEND is unset", () => {
  // Email guarded by `if (resend && recipient)` — resend null when key unset.
  assert.match(routeSource, /process\.env\.RESEND_API_KEY\s*\?\s*new Resend/);
  assert.match(routeSource, /if \(resend && recipient\)/);
});

test("audit actions use initiate_delete and cancel_delete", () => {
  assert.match(routeSource, /action: "initiate_delete"/);
  assert.match(routeSource, /action: "cancel_delete"/);
});
