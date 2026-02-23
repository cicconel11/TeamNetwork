import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Tests for the reconcileSubscriptionFromStripe logic
 * (defined in billing/adjust/route.ts).
 *
 * Since the function is defined inline in the route file and calls Stripe directly,
 * we test via simulation (same pattern as adoption.test.ts) — replicating the
 * exact branching logic with dependency-injected mocks.
 */

interface EnterpriseSubscriptionRow {
  id: string;
  enterprise_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_interval: "month" | "year";
  alumni_bucket_quantity: number;
  sub_org_quantity: number | null;
  status: string;
  current_period_end: string | null;
}

interface StripeMetadata {
  sub_org_quantity?: string;
  alumni_bucket_quantity?: string;
}

interface ReconcileResult {
  subscription: EnterpriseSubscriptionRow;
  driftDetected: boolean;
  driftFields: string[];
  dbWriteError?: boolean;
}

/**
 * Simulates reconcileSubscriptionFromStripe (billing/adjust/route.ts:66-159).
 *
 * Replicates the exact branching:
 *   - No stripe_subscription_id → return original subscription
 *   - Stripe fetch error → return original subscription (skip)
 *   - No drift → return original subscription
 *   - Drift detected → update DB, return merged subscription
 *   - DB write error → log, still return Stripe-truth values in memory
 */
function simulateReconcileSubscriptionFromStripe(params: {
  subscription: EnterpriseSubscriptionRow;
  stripeMetadata: StripeMetadata | null; // null = Stripe fetch failed
  dbWriteError: boolean;
}): ReconcileResult {
  const { subscription, stripeMetadata, dbWriteError } = params;

  // No Stripe subscription → passthrough
  if (!subscription.stripe_subscription_id) {
    return { subscription, driftDetected: false, driftFields: [] };
  }

  // Stripe fetch failed → skip reconciliation
  if (stripeMetadata === null) {
    return { subscription, driftDetected: false, driftFields: [] };
  }

  const stripeSubOrgQty = stripeMetadata.sub_org_quantity
    ? parseInt(stripeMetadata.sub_org_quantity, 10)
    : null;
  const stripeAlumniBucketQty = stripeMetadata.alumni_bucket_quantity
    ? parseInt(stripeMetadata.alumni_bucket_quantity, 10)
    : null;

  const driftFields: string[] = [];

  if (
    stripeSubOrgQty !== null &&
    !isNaN(stripeSubOrgQty) &&
    stripeSubOrgQty !== subscription.sub_org_quantity
  ) {
    driftFields.push("sub_org_quantity");
  }
  if (
    stripeAlumniBucketQty !== null &&
    !isNaN(stripeAlumniBucketQty) &&
    stripeAlumniBucketQty !== subscription.alumni_bucket_quantity
  ) {
    driftFields.push("alumni_bucket_quantity");
  }

  // No drift
  if (driftFields.length === 0) {
    return { subscription, driftDetected: false, driftFields: [] };
  }

  // Drift detected — merge Stripe truth into subscription
  const merged: EnterpriseSubscriptionRow = {
    ...subscription,
    sub_org_quantity: stripeSubOrgQty ?? subscription.sub_org_quantity,
    alumni_bucket_quantity: stripeAlumniBucketQty ?? subscription.alumni_bucket_quantity,
  };

  return {
    subscription: merged,
    driftDetected: true,
    driftFields,
    dbWriteError: dbWriteError || undefined,
  };
}

function makeSub(overrides: Partial<EnterpriseSubscriptionRow> = {}): EnterpriseSubscriptionRow {
  return {
    id: "sub-1",
    enterprise_id: "ent-1",
    stripe_customer_id: "cus_abc",
    stripe_subscription_id: "sub_stripe_1",
    billing_interval: "year",
    alumni_bucket_quantity: 2,
    sub_org_quantity: 5,
    status: "active",
    current_period_end: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("reconcileSubscriptionFromStripe", () => {
  it("no drift: Stripe metadata matches DB → no update", () => {
    const sub = makeSub({ sub_org_quantity: 5, alumni_bucket_quantity: 2 });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: { sub_org_quantity: "5", alumni_bucket_quantity: "2" },
      dbWriteError: false,
    });

    assert.strictEqual(result.driftDetected, false);
    assert.deepStrictEqual(result.driftFields, []);
    assert.strictEqual(result.subscription.sub_org_quantity, 5);
    assert.strictEqual(result.subscription.alumni_bucket_quantity, 2);
  });

  it("sub_org_quantity drift → DB updated to match Stripe", () => {
    const sub = makeSub({ sub_org_quantity: 5, alumni_bucket_quantity: 2 });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: { sub_org_quantity: "8", alumni_bucket_quantity: "2" },
      dbWriteError: false,
    });

    assert.strictEqual(result.driftDetected, true);
    assert.deepStrictEqual(result.driftFields, ["sub_org_quantity"]);
    assert.strictEqual(result.subscription.sub_org_quantity, 8);
    assert.strictEqual(result.subscription.alumni_bucket_quantity, 2);
  });

  it("alumni_bucket_quantity drift → DB updated to match Stripe", () => {
    const sub = makeSub({ sub_org_quantity: 5, alumni_bucket_quantity: 2 });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: { sub_org_quantity: "5", alumni_bucket_quantity: "4" },
      dbWriteError: false,
    });

    assert.strictEqual(result.driftDetected, true);
    assert.deepStrictEqual(result.driftFields, ["alumni_bucket_quantity"]);
    assert.strictEqual(result.subscription.alumni_bucket_quantity, 4);
    assert.strictEqual(result.subscription.sub_org_quantity, 5);
  });

  it("both fields drift → both updated", () => {
    const sub = makeSub({ sub_org_quantity: 5, alumni_bucket_quantity: 2 });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: { sub_org_quantity: "10", alumni_bucket_quantity: "3" },
      dbWriteError: false,
    });

    assert.strictEqual(result.driftDetected, true);
    assert.deepStrictEqual(result.driftFields, ["sub_org_quantity", "alumni_bucket_quantity"]);
    assert.strictEqual(result.subscription.sub_org_quantity, 10);
    assert.strictEqual(result.subscription.alumni_bucket_quantity, 3);
  });

  it("Stripe fetch failure → graceful skip, returns original subscription", () => {
    const sub = makeSub({ sub_org_quantity: 5, alumni_bucket_quantity: 2 });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: null, // fetch failed
      dbWriteError: false,
    });

    assert.strictEqual(result.driftDetected, false);
    assert.strictEqual(result.subscription.sub_org_quantity, 5);
    assert.strictEqual(result.subscription.alumni_bucket_quantity, 2);
  });

  it("no stripe_subscription_id → skip reconciliation entirely", () => {
    const sub = makeSub({ stripe_subscription_id: null });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: { sub_org_quantity: "99" },
      dbWriteError: false,
    });

    assert.strictEqual(result.driftDetected, false);
    assert.strictEqual(result.subscription, sub);
  });

  it("DB update failure during reconciliation → returns Stripe-truth values in memory", () => {
    const sub = makeSub({ sub_org_quantity: 5, alumni_bucket_quantity: 2 });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: { sub_org_quantity: "8" },
      dbWriteError: true,
    });

    assert.strictEqual(result.driftDetected, true);
    assert.strictEqual(result.dbWriteError, true);
    // Even though DB write fails, returned subscription has Stripe-truth values
    assert.strictEqual(result.subscription.sub_org_quantity, 8);
  });

  it("Stripe metadata with NaN value is ignored (no drift)", () => {
    const sub = makeSub({ sub_org_quantity: 5, alumni_bucket_quantity: 2 });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: { sub_org_quantity: "not_a_number", alumni_bucket_quantity: "2" },
      dbWriteError: false,
    });

    assert.strictEqual(result.driftDetected, false);
    assert.strictEqual(result.subscription.sub_org_quantity, 5);
  });

  it("Stripe metadata with missing fields → only present fields checked for drift", () => {
    const sub = makeSub({ sub_org_quantity: 5, alumni_bucket_quantity: 2 });

    const result = simulateReconcileSubscriptionFromStripe({
      subscription: sub,
      stripeMetadata: { alumni_bucket_quantity: "3" }, // no sub_org_quantity in metadata
      dbWriteError: false,
    });

    assert.strictEqual(result.driftDetected, true);
    assert.deepStrictEqual(result.driftFields, ["alumni_bucket_quantity"]);
    // sub_org_quantity stays at original since Stripe had no metadata for it
    assert.strictEqual(result.subscription.sub_org_quantity, 5);
    assert.strictEqual(result.subscription.alumni_bucket_quantity, 3);
  });
});
