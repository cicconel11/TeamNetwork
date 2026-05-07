import test, { beforeEach, describe } from "node:test";
import assert from "node:assert";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { resolveAdminsForSubscription } from "../../../src/lib/stripe/billing-admin-resolver.ts";

Object.assign(process.env, {
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_invoice",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "sk_test_invoice",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "pk_test_invoice",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon_test_invoice",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "service_test_invoice",
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

const ENT_ID = "ent-111";
const ORG_ID = "org-222";
const SUB_ID_ENT = "sub_enterprise_abc";
const SUB_ID_ORG = "sub_org_xyz";
const SUB_ID_UNKNOWN = "sub_unknown_999";

type SendEmailPayload = { to: string; subject: string; body: string };
type SendEmailResult = { success: boolean; error?: string };

let supabase = createSupabaseStub();
let event: Record<string, unknown> | null = null;
let sentEmails: SendEmailPayload[] = [];
let sendEmailImpl: (payload: SendEmailPayload) => Promise<SendEmailResult>;

const noopReporter = {
  reportError: async () => {},
  reportWarning: async () => {},
  setUserId: () => {},
  getContext: () => ({ apiPath: "/api/stripe/webhook", method: "POST" }),
};

function resetHarness() {
  supabase = createSupabaseStub();
  event = null;
  sentEmails = [];
  sendEmailImpl = async () => ({ success: true });
}

function seedEnterprise() {
  supabase.seed("enterprise_subscriptions", [
    { enterprise_id: ENT_ID, stripe_subscription_id: SUB_ID_ENT },
  ]);
  supabase.seed("enterprises", [{ id: ENT_ID, name: "Test Enterprise" }]);
  supabase.seed("user_enterprise_roles", [
    { user_id: "user-a1", enterprise_id: ENT_ID, role: "owner" },
    { user_id: "user-a2", enterprise_id: ENT_ID, role: "billing_admin" },
    { user_id: "user-a3", enterprise_id: ENT_ID, role: "org_admin" },
  ]);
  supabase.seed("users", [
    { id: "user-a1", email: "owner@example.com" },
    { id: "user-a2", email: "billing@example.com" },
    { id: "user-a3", email: "org-admin@example.com" },
  ]);
}

function seedOrg() {
  supabase.seed("organization_subscriptions", [
    { organization_id: ORG_ID, stripe_subscription_id: SUB_ID_ORG },
  ]);
  supabase.seed("organizations", [{ id: ORG_ID, name: "Alpha Chapter" }]);
  supabase.seed("user_organization_roles", [
    { user_id: "user-o1", organization_id: ORG_ID, role: "admin", status: "active" },
  ]);
  supabase.seed("users", [{ id: "user-o1", email: "orgadmin@example.com" }]);
}

function createInvoiceEvent(
  type: string,
  invoiceOverrides: Record<string, unknown>,
  eventId = `evt_${type.replace(/\./g, "_")}`
) {
  return {
    id: eventId,
    type,
    livemode: false,
    data: {
      object: {
        id: `in_${type.replace(/\./g, "_")}`,
        object: "invoice",
        ...invoiceOverrides,
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
    webhookSecret: "whsec_test_invoice",
    stripeClient: {
      webhooks: {
        constructEvent() {
          if (!event) {
            throw new Error("No mock Stripe event configured");
          }
          return event;
        },
      },
      subscriptions: {
        async retrieve() {
          throw new Error("Unexpected subscriptions.retrieve call in invoice webhook test");
        },
      },
    } as never,
    createServiceClientFn: () => supabase as never,
    sendEmailFn: async (payload: SendEmailPayload) => {
      sentEmails.push(payload);
      return sendEmailImpl(payload);
    },
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

function assertWebhookRecorded(eventId: string) {
  const rows = supabase.getRows("stripe_events");
  const row = rows.find((item) => item.event_id === eventId);
  assert.ok(row, `expected stripe_events row for ${eventId}`);
  assert.ok(row.processed_at, `expected processed_at for ${eventId}`);
}

beforeEach(() => {
  resetHarness();
});

describe("resolveAdminsForSubscription", () => {
  test("returns enterprise admins and excludes org_admin", async () => {
    seedEnterprise();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveAdminsForSubscription(supabase as any, SUB_ID_ENT);

    assert.ok(result);
    assert.strictEqual(result.entityType, "enterprise");
    assert.strictEqual(result.entityName, "Test Enterprise");
    assert.deepStrictEqual(
      [...result.adminEmails].sort(),
      ["billing@example.com", "owner@example.com"]
    );
  });

  test("returns organization admins for org subscriptions", async () => {
    seedOrg();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveAdminsForSubscription(supabase as any, SUB_ID_ORG);

    assert.ok(result);
    assert.strictEqual(result.entityType, "org");
    assert.strictEqual(result.entityName, "Alpha Chapter");
    assert.deepStrictEqual(result.adminEmails, ["orgadmin@example.com"]);
  });

  test("returns null when the subscription has no billing admin recipients", async () => {
    supabase.seed("enterprise_subscriptions", [
      { enterprise_id: ENT_ID, stripe_subscription_id: SUB_ID_ENT },
    ]);
    supabase.seed("enterprises", [{ id: ENT_ID, name: "Test Enterprise" }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveAdminsForSubscription(supabase as any, SUB_ID_ENT);

    assert.strictEqual(result, null);
  });
});

describe("POST /api/stripe/webhook invoice events", () => {
  test("invoice.upcoming sends the real renewal reminder email to org admins", async () => {
    seedOrg();
    event = createInvoiceEvent(
      "invoice.upcoming",
      {
        subscription: SUB_ID_ORG,
        amount_due: 9900,
        period_end: Date.UTC(2026, 2, 15, 12, 0, 0) / 1000,
      },
      "evt_invoice_upcoming_org"
    );

    const { response, body } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body, { received: true });
    assert.deepStrictEqual(sentEmails, [
      {
        to: "orgadmin@example.com",
        subject: "Subscription Renewal Reminder - Alpha Chapter",
        body: `Your subscription for Alpha Chapter renews on March 15, 2026 for $99.00.

If you need to update your payment method or make changes to your plan, please check your billing settings before the renewal date.

No action is needed if everything looks correct.`,
      },
    ]);
    assertWebhookRecorded("evt_invoice_upcoming_org");
  });

  test("invoice.upcoming sends only to enterprise owners and billing admins", async () => {
    seedEnterprise();
    event = createInvoiceEvent(
      "invoice.upcoming",
      {
        subscription: SUB_ID_ENT,
        amount_due: 25000,
        period_end: Date.UTC(2026, 6, 1, 12, 0, 0) / 1000,
      },
      "evt_invoice_upcoming_ent"
    );

    const { response } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(
      sentEmails.map((email) => email.to).sort(),
      ["billing@example.com", "owner@example.com"]
    );
    assert.ok(sentEmails.every((email) => email.subject === "Subscription Renewal Reminder - Test Enterprise"));
    assertWebhookRecorded("evt_invoice_upcoming_ent");
  });

  test("invoice.payment_action_required uses the hosted invoice URL from Stripe", async () => {
    seedOrg();
    event = createInvoiceEvent(
      "invoice.payment_action_required",
      {
        subscription: SUB_ID_ORG,
        hosted_invoice_url: "https://invoice.stripe.com/i/acct_123/test_abc",
      },
      "evt_invoice_action_required"
    );

    const { response } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(sentEmails, [
      {
        to: "orgadmin@example.com",
        subject: "[Action Required] Payment Authentication Needed - Alpha Chapter",
        body: `Your recent payment for Alpha Chapter requires additional authentication to complete.

Please complete the payment verification here:
https://invoice.stripe.com/i/acct_123/test_abc

This is typically required by your bank for security purposes (3D Secure). Your subscription may be interrupted if the payment is not completed.`,
      },
    ]);
    assertWebhookRecorded("evt_invoice_action_required");
  });

  test("invoice.finalization_failed includes Stripe's finalization error message", async () => {
    seedOrg();
    event = createInvoiceEvent(
      "invoice.finalization_failed",
      {
        subscription: SUB_ID_ORG,
        last_finalization_error: { message: "Card declined by issuer" },
      },
      "evt_invoice_finalization_failed"
    );

    const { response } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(sentEmails, [
      {
        to: "orgadmin@example.com",
        subject: "[Action Required] Billing Issue - Alpha Chapter",
        body: `An invoice for Alpha Chapter could not be processed.

Error details: Card declined by issuer

Please check your billing settings to ensure your payment information is up to date. If this issue persists, contact support for assistance.`,
      },
    ]);
    assertWebhookRecorded("evt_invoice_finalization_failed");
  });

  test("skips invoice emails when the invoice has no subscription id", async () => {
    seedOrg();
    event = createInvoiceEvent(
      "invoice.upcoming",
      {
        subscription: null,
        amount_due: 9900,
      },
      "evt_invoice_without_subscription"
    );

    const { response, body } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body, { received: true });
    assert.strictEqual(sentEmails.length, 0);
    assertWebhookRecorded("evt_invoice_without_subscription");
  });

  test("skips invoice emails when no admins can be resolved for the subscription", async () => {
    event = createInvoiceEvent(
      "invoice.payment_action_required",
      {
        subscription: SUB_ID_UNKNOWN,
        hosted_invoice_url: "https://invoice.stripe.com/i/unused",
      },
      "evt_invoice_unknown_subscription"
    );

    const { response } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(sentEmails.length, 0);
    assertWebhookRecorded("evt_invoice_unknown_subscription");
  });

  test("continues processing when invoice email delivery rejects or returns an error", async () => {
    seedEnterprise();
    const outcomes = [
      Promise.reject(new Error("Network timeout")),
      Promise.resolve({ success: false, error: "Provider rejected message" }),
    ];
    sendEmailImpl = async () => {
      const next = outcomes.shift();
      if (!next) return { success: true };
      return next;
    };
    event = createInvoiceEvent(
      "invoice.finalization_failed",
      {
        subscription: SUB_ID_ENT,
        last_finalization_error: { message: "Tax calculation unavailable" },
      },
      "evt_invoice_finalization_failed_partial"
    );

    const { response, body } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(body, { received: true });
    assert.deepStrictEqual(
      sentEmails.map((email) => email.to).sort(),
      ["billing@example.com", "owner@example.com"]
    );
    assertWebhookRecorded("evt_invoice_finalization_failed_partial");
  });

  test("invoice.created does not send emails", async () => {
    seedOrg();
    event = createInvoiceEvent(
      "invoice.created",
      {
        subscription: SUB_ID_ORG,
      },
      "evt_invoice_created"
    );

    const { response } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(sentEmails.length, 0);
    assertWebhookRecorded("evt_invoice_created");
  });

  test("invoice.finalized does not send emails", async () => {
    seedOrg();
    event = createInvoiceEvent(
      "invoice.finalized",
      {
        subscription: SUB_ID_ORG,
      },
      "evt_invoice_finalized"
    );

    const { response } = await postWebhook();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(sentEmails.length, 0);
    assertWebhookRecorded("evt_invoice_finalized");
  });
});
