import test, { beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

Object.assign(process.env, {
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_trial",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "sk_test_trial",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "pk_test_trial",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon_test_trial",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "service_test_trial",
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

type SendEmailPayload = { to: string; subject: string; body: string };
type SendEmailResult = { success: boolean; error?: string };

let supabase = createSupabaseStub();
let event: Record<string, unknown> | null = null;
let sentEmails: SendEmailPayload[] = [];

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
}

async function postWebhook(subscriptionOverrides?: Record<string, unknown>) {
  const request = new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "sig_test",
    },
    body: JSON.stringify({ id: event && "id" in event ? event.id : "evt_missing" }),
  });

  const response = await handleStripeWebhookPost(request, {
    webhookSecret: "whsec_test_trial",
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
        async retrieve(subscriptionId: string) {
          return {
            id: subscriptionId,
            status: "trialing",
            customer: "cus_trial_123",
            cancel_at_period_end: false,
            current_period_end: Date.UTC(2026, 3, 22, 12, 0, 0) / 1000,
            items: { data: [] },
            metadata: {
              is_trial: "true",
            },
            ...subscriptionOverrides,
          };
        },
      },
    } as never,
    createServiceClientFn: () => supabase as never,
    sendEmailFn: async (payload: SendEmailPayload): Promise<SendEmailResult> => {
      sentEmails.push(payload);
      return { success: true };
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

beforeEach(() => {
  resetHarness();
});

describe("POST /api/stripe/webhook trial flows", () => {
  test("enterprise subscription upsert failure returns 500 and leaves the event retryable", async () => {
    supabase.simulateError("enterprise_subscriptions", { message: "unique constraint violation" });

    event = {
      id: "evt_enterprise_sub_failure",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_enterprise_123",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "paid",
          customer: "cus_enterprise_123",
          subscription: "sub_enterprise_123",
          metadata: {
            type: "enterprise",
            creatorId: "user_enterprise_1",
            enterpriseName: "Acme Enterprise",
            enterpriseSlug: "acme-enterprise",
            billingInterval: "year",
          },
        },
      },
    };

    const { response, body } = await postWebhook();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: "Enterprise subscription provisioning failed" });

    const eventRows = supabase.getRows("stripe_events");
    assert.equal(eventRows.length, 1);
    assert.equal(eventRows[0].event_id, "evt_enterprise_sub_failure");
    assert.equal(eventRows[0].processed_at ?? null, null);
  });

  test("checkout.session.completed returns 500 when admin grant fails for a new org", async () => {
    supabase.seed("payment_attempts", [
      {
        id: "attempt_trial_admin_fail",
        idempotency_key: "idem_trial_admin_fail",
        user_id: "user_trial_admin_fail",
        flow_type: "subscription_checkout",
        status: "processing",
        currency: "usd",
        amount_cents: 0,
        is_trial: true,
      },
    ]);
    supabase.simulateError("user_organization_roles", { message: "admin role write failed" });

    event = {
      id: "evt_trial_admin_grant_failure",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_trial_admin_fail",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "no_payment_required",
          customer: "cus_trial_admin_fail",
          subscription: "sub_trial_admin_fail",
          metadata: {
            organization_id: "org_trial_admin_fail",
            organization_slug: "trial-admin-fail",
            organization_name: "Trial Admin Fail",
            organization_description: "Trial checkout that should retry admin grant",
            organization_color: "#1e3a5f",
            alumni_bucket: "none",
            base_interval: "month",
            payment_attempt_id: "attempt_trial_admin_fail",
            is_trial: "true",
          },
        },
      },
    };

    const { response, body } = await postWebhook();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: "Organization admin grant failed - will retry" });

    const roles = supabase.getRows("user_organization_roles");
    assert.equal(roles.length, 0);

    const organizations = supabase.getRows("organizations");
    assert.equal(organizations.length, 1);
    assert.equal(organizations[0].id, "org_trial_admin_fail");

    const subscriptions = supabase.getRows("organization_subscriptions");
    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].organization_id, "org_trial_admin_fail");

    const eventRows = supabase.getRows("stripe_events");
    assert.equal(eventRows.length, 1);
    assert.equal(eventRows[0].event_id, "evt_trial_admin_grant_failure");
    assert.equal(eventRows[0].processed_at ?? null, null);
  });

  test("checkout.session.completed provisions orgs for no-payment-required trial checkouts", async () => {
    supabase.seed("payment_attempts", [
      {
        id: "attempt_trial_1",
        idempotency_key: "idem_trial_1",
        user_id: "user_trial_1",
        flow_type: "subscription_checkout",
        status: "processing",
        currency: "usd",
        amount_cents: 0,
        is_trial: true,
      },
    ]);

    event = {
      id: "evt_trial_checkout_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_trial_123",
          object: "checkout.session",
          mode: "subscription",
          payment_status: "no_payment_required",
          customer: "cus_trial_123",
          subscription: "sub_trial_123",
          metadata: {
            organization_id: "org_trial_123",
            organization_slug: "trial-org",
            organization_name: "Trial Org",
            organization_description: "A trial organization",
            organization_color: "#1e3a5f",
            alumni_bucket: "none",
            base_interval: "month",
            payment_attempt_id: "attempt_trial_1",
            is_trial: "true",
          },
        },
      },
    };

    const { response, body } = await postWebhook();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { received: true });

    const organizations = supabase.getRows("organizations");
    assert.equal(organizations.length, 1);
    assert.equal(organizations[0].slug, "trial-org");

    const roles = supabase.getRows("user_organization_roles");
    assert.equal(roles.length, 1);
    assert.equal(roles[0].user_id, "user_trial_1");
    assert.equal(roles[0].role, "admin");

    const subscriptions = supabase.getRows("organization_subscriptions");
    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].organization_id, "org_trial_123");
    assert.equal(subscriptions[0].status, "trialing");
    assert.equal(subscriptions[0].is_trial, true);
    assert.equal(subscriptions[0].stripe_subscription_id, "sub_trial_123");

    const attempts = supabase.getRows("payment_attempts");
    assert.equal(attempts[0].organization_id, "org_trial_123");
    assert.equal(attempts[0].status, "trialing");
  });

  test("customer.subscription.trial_will_end emails org admins", async () => {
    supabase.seed("organization_subscriptions", [
      {
        organization_id: "org_trial_email",
        stripe_subscription_id: "sub_trial_email",
        is_trial: true,
        status: "trialing",
        base_plan_interval: "month",
        alumni_bucket: "none",
      },
    ]);
    supabase.seed("organizations", [{ id: "org_trial_email", name: "Trial Email Org" }]);
    supabase.seed("user_organization_roles", [
      { user_id: "user_trial_email", organization_id: "org_trial_email", role: "admin", status: "active" },
    ]);
    supabase.seed("users", [{ id: "user_trial_email", email: "trial-admin@example.com" }]);

    event = {
      id: "evt_trial_will_end",
      type: "customer.subscription.trial_will_end",
      data: {
        object: {
          id: "sub_trial_email",
          object: "subscription",
          current_period_end: Date.UTC(2026, 2, 29, 12, 0, 0) / 1000,
          metadata: { is_trial: "true" },
        },
      },
    };

    const { response, body } = await postWebhook();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { received: true });
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "trial-admin@example.com");
    assert.match(sentEmails[0].subject, /Free Trial Ending Soon/);
    assert.match(sentEmails[0].body, /March 29, 2026/);
  });
});
