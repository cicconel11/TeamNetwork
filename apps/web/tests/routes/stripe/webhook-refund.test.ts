/* eslint-disable @typescript-eslint/no-unused-vars */
import test, { beforeEach, describe } from "node:test";
import assert from "node:assert";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

Object.assign(process.env, {
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_refund",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "sk_test_refund",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "pk_test_refund",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon_test_refund",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "service_test_refund",
  STRIPE_PRICE_BASE_MONTHLY: process.env.STRIPE_PRICE_BASE_MONTHLY || "price_test_base_monthly",
  STRIPE_PRICE_BASE_YEARLY: process.env.STRIPE_PRICE_BASE_YEARLY || "price_test_base_yearly",
  STRIPE_PRICE_ALUMNI_0_250_MONTHLY: process.env.STRIPE_PRICE_ALUMNI_0_250_MONTHLY || "price_test_0_250_monthly",
  STRIPE_PRICE_ALUMNI_0_250_YEARLY: process.env.STRIPE_PRICE_ALUMNI_0_250_YEARLY || "price_test_0_250_yearly",
  STRIPE_PRICE_ALUMNI_251_500_MONTHLY: process.env.STRIPE_PRICE_ALUMNI_251_500_MONTHLY || "price_test_251_500_monthly",
  STRIPE_PRICE_ALUMNI_251_500_YEARLY: process.env.STRIPE_PRICE_ALUMNI_251_500_YEARLY || "price_test_251_500_yearly",
  STRIPE_PRICE_ALUMNI_501_1000_MONTHLY: process.env.STRIPE_PRICE_ALUMNI_501_1000_MONTHLY || "price_test_501_1000_monthly",
  STRIPE_PRICE_ALUMNI_501_1000_YEARLY: process.env.STRIPE_PRICE_ALUMNI_501_1000_YEARLY || "price_test_501_1000_yearly",
  STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY: process.env.STRIPE_PRICE_ALUMNI_1001_2500_MONTHLY || "price_test_1001_2500_monthly",
  STRIPE_PRICE_ALUMNI_1001_2500_YEARLY: process.env.STRIPE_PRICE_ALUMNI_1001_2500_YEARLY || "price_test_1001_2500_yearly",
  STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY: process.env.STRIPE_PRICE_ALUMNI_2500_5000_MONTHLY || "price_test_2500_5000_monthly",
  STRIPE_PRICE_ALUMNI_2500_5000_YEARLY: process.env.STRIPE_PRICE_ALUMNI_2500_5000_YEARLY || "price_test_2500_5000_yearly",
});

const { handleStripeWebhookPost } = await import("../../../src/app/api/stripe/webhook/handler.ts");

const ORG_ID = "org-refund-test";
const SUB_ID = "sub_test_123";
const INVOICE_ID = "in_test_invoice_456";

let supabase = createSupabaseStub();
let event: Record<string, unknown> | null = null;
let cancelCallCount = 0;

const noopReporter = {
  reportError: async () => {},
  reportWarning: async () => {},
  setUserId: () => {},
  getContext: () => ({ apiPath: "/api/stripe/webhook", method: "POST" }),
};

function resetHarness() {
  supabase = createSupabaseStub();
  event = null;
  cancelCallCount = 0;
}

function seedOrg() {
  supabase.seed("organization_subscriptions", [
    { organization_id: ORG_ID, stripe_subscription_id: SUB_ID },
  ]);
  supabase.seed("organizations", [{ id: ORG_ID, name: "Refund Test Org" }]);
}

function createChargeRefundedEvent(
  chargeOverrides: Record<string, unknown>,
  eventId = "evt_charge_refunded_test"
) {
  return {
    id: eventId,
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_test_charge",
        object: "charge",
        ...chargeOverrides,
      },
    },
  };
}

async function postWebhook() {
  const request = new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "sig_test",
    },
    body: JSON.stringify({ id: event && "id" in event ? event.id : "evt_missing" }),
  });

  const response = await handleStripeWebhookPost(request, {
    webhookSecret: "whsec_test_refund",
    stripeClient: {
      webhooks: {
        constructEvent() {
          if (!event) {
            throw new Error("No mock Stripe event configured");
          }
          return event;
        },
      },
      invoices: {
        async retrieve(invoiceId: string) {
          if (invoiceId === INVOICE_ID) {
            return { id: INVOICE_ID, subscription: SUB_ID };
          }
          throw new Error(`Unexpected invoice ID: ${invoiceId}`);
        },
      },
      subscriptions: {
        async cancel(_subId: string) {
          cancelCallCount += 1;
          return {};
        },
      },
    } as never,
    createServiceClientFn: () => supabase as never,
    sendEmailFn: async () => ({ success: true }),
    createTelemetryReporterFn: () => noopReporter,
    getWebhookClientIpFn: () => null,
    checkWebhookRateLimitFn: () => ({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 60,
      headers: {},
    }),
  });

  const body = await response.json();
  return { response, body };
}

beforeEach(() => {
  resetHarness();
});

describe("POST /api/stripe/webhook charge.refunded events", () => {
  test("partial refund does NOT cancel subscription", async () => {
    seedOrg();
    event = createChargeRefundedEvent(
      {
        invoice: INVOICE_ID,
        refunded: false,
        amount_refunded: 500,
        amount: 10000,
      },
      "evt_partial_refund"
    );

    const { response, body } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body, { received: true });

    // Subscription must NOT have been canceled
    assert.strictEqual(cancelCallCount, 0, "subscriptions.cancel should NOT be called for partial refund");

    // Subscription status in DB must remain unchanged
    const rows = supabase.getRows("organization_subscriptions");
    const sub = rows.find((r) => r.stripe_subscription_id === SUB_ID);
    assert.ok(sub, "subscription row should still exist");
    assert.notStrictEqual(sub.status, "canceled", "subscription status should NOT be canceled after partial refund");
  });

  test("full refund DOES cancel subscription and sets grace period", async () => {
    seedOrg();
    event = createChargeRefundedEvent(
      {
        invoice: INVOICE_ID,
        refunded: true,
        amount_refunded: 10000,
        amount: 10000,
      },
      "evt_full_refund"
    );

    const { response, body } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body, { received: true });

    // Subscription MUST have been canceled via Stripe
    assert.strictEqual(cancelCallCount, 1, "subscriptions.cancel should be called exactly once for full refund");

    // Subscription status in DB must be canceled with grace period
    const rows = supabase.getRows("organization_subscriptions");
    const sub = rows.find((r) => r.stripe_subscription_id === SUB_ID);
    assert.ok(sub, "subscription row should exist");
    assert.strictEqual(sub.status, "canceled", "subscription status should be canceled after full refund");
    assert.ok(sub.grace_period_ends_at, "grace_period_ends_at should be set after full refund");
  });

  test("charge with no invoice is gracefully ignored", async () => {
    seedOrg();
    event = createChargeRefundedEvent(
      {
        invoice: null,
        refunded: true,
        amount_refunded: 5000,
        amount: 5000,
      },
      "evt_charge_no_invoice"
    );

    const { response, body } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body, { received: true });

    // No cancellation should happen — no invoice means we can't find the subscription
    assert.strictEqual(cancelCallCount, 0, "subscriptions.cancel should NOT be called when charge has no invoice");

    // Subscription in DB should remain untouched
    const rows = supabase.getRows("organization_subscriptions");
    const sub = rows.find((r) => r.stripe_subscription_id === SUB_ID);
    assert.ok(sub, "subscription row should still exist");
    assert.notStrictEqual(sub.status, "canceled", "subscription status should NOT be changed when charge has no invoice");
  });
});
